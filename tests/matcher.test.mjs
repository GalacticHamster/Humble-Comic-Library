import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadMatcher() {
  const context = {
    Blob,
    URL,
    clearTimeout,
    console,
    document: { title: '' },
    location: { pathname: '/' },
    performance: { now: () => 0 },
    Promise,
    setTimeout
  };
  context.globalThis = context;
  vm.createContext(context);
  for (const file of ['shared.js', 'collection-mappings.js', 'ownership.js', 'content.js']) {
    vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context, { filename: file });
  }
  return context;
}

const matcher = loadMatcher();

function library(titles) {
  return new Map(titles.map((title) => [matcher.HumbleComicLibrary.titleKey(title), { title }]));
}

function classify(title, ownedTitles, itemKind = 'book', mappings = matcher.HumbleCollectionMappings.builtIn) {
  const libraryByKey = library(ownedTitles);
  matcher.__values = { libraryByKey, itemKind, mappings, title };
  const result = vm.runInContext(`(() => {
    const { libraryByKey, itemKind, mappings, title } = __values;
    const records = [...libraryByKey.values()].map(item => ({ ...item, kind: itemKind }));
    const libraryMatcher = createBundleLibraryMatcher(records, itemKind);
    const match = classifyLocalBundleItem({ title, lookupTitle: title, kind: itemKind }, libraryMatcher, mappings);
    if (match.state === 'partial') return { state: 'partial', owned: match.range.owned, total: match.range.total };
    const record = Array.isArray(match.item) ? match.item[0] : match.item;
    return { state: match.state, ...(record ? { item: record.title } : {}), ...(match.possibleReason ? { reason: match.possibleReason } : {}) };
  })()`, matcher);
  return JSON.parse(JSON.stringify(result));
}

function classifyCurrentBundleVariant(title, ownedTitles, currentBundleTitle) {
  const previousTitle = matcher.document.title;
  matcher.document.title = currentBundleTitle;
  try {
    const libraryByKey = new Map(ownedTitles.map((ownedTitle) => [
      matcher.HumbleComicLibrary.titleKey(ownedTitle),
      { title: ownedTitle, provenance: [{ title: ownedTitle, sourceBundle: currentBundleTitle, purchaseKey: 'current-order' }] }
    ]));
    matcher.__values = { libraryByKey, title };
    const result = vm.runInContext(`(() => {
      const { libraryByKey, title } = __values;
      const libraryMatcher = createBundleLibraryMatcher([...libraryByKey.values()], 'book');
      const match = classifyLocalBundleItem({ title, lookupTitle: title, kind: 'book' }, libraryMatcher);
      return { state: match.state, ...(match.item ? { item: (Array.isArray(match.item) ? match.item[0] : match.item).title } : {}) };
    })()`, matcher);
    return JSON.parse(JSON.stringify(result));
  } finally {
    matcher.document.title = previousTitle;
  }
}

test('literal Maggie the Mechanic and Heartbreak Soup remain exact owned matches', () => {
  assert.equal(classify('Maggie the Mechanic', ['Maggie the Mechanic']).state, 'owned');
  assert.equal(classify('Heartbreak Soup', ['Heartbreak Soup']).state, 'owned');
});

test('Maggie the Mechanic parenthetical Love & Rockets qualifier is possible, not silently owned', () => {
  const result = classify('Maggie the Mechanic', ['Maggie the Mechanic (Love & Rockets)']);
  assert.equal(result.state, 'possible');
  assert.match(result.reason, /shortened or qualified/u);
});

test('a general parenthetical qualifier is surfaced as possible, not silently owned', () => {
  const result = classify('The Practical Systems Design Manual', ['The Practical Systems Design Manual (Computing Series)']);
  assert.equal(result.state, 'possible');
  assert.match(result.reason, /shortened or qualified/u);
});

test('a shortened Think Like a Programmer title is possible', () => {
  const result = classify('Think Like a Programmer', ['Think Like a Programmer: An Introduction to Creative Problem Solving']);
  assert.equal(result.state, 'possible');
  assert.match(result.reason, /shortened or qualified/u);
});

test('book edition markers are possible relationships, never automatic ownership', () => {
  const owned = ['Algorithmic Thinking: A Problem-Based Introduction'];
  for (const title of [
    'Algorithmic Thinking, 2nd Edition',
    'Algorithmic Thinking, Second Edition',
    'Algorithmic Thinking: Revised Edition',
    'Algorithmic Thinking — Updated Edition',
    'Algorithmic Thinking, Expanded Edition',
    'Algorithmic Thinking, 3rd Revised Ed.',
    'Algorithmic Thinking (Updated Edition)'
  ]) {
    const result = classify(title, owned);
    assert.equal(result.state, 'possible', title);
    assert.match(result.reason, /edition/u, title);
  }
});

test('explicit editions are possible in either direction without edition-distance limits', () => {
  const cases = [
    ['Long Book Title', 'Long Book Title, 2nd Edition'],
    ['Long Book Title, 2nd Edition', 'Long Book Title'],
    ['Long Book Title, 2nd Edition', 'Long Book Title, 3rd Edition'],
    ['Long Book Title, 1st Edition', 'Long Book Title, 5th Edition'],
    ['Long Book Title, Revised Edition', 'Long Book Title, 3rd Edition']
  ];
  for (const [owned, bundle] of cases) {
    const result = classify(bundle, [owned]);
    assert.equal(result.state, 'possible', `${owned} -> ${bundle}`);
    assert.match(result.reason, /edition/u, `${owned} -> ${bundle}`);
  }
});

test('an exact edition still wins over related subtitle and edition candidates', () => {
  const result = classify('Algorithmic Thinking, 2nd Edition', [
    'Algorithmic Thinking: A Problem-Based Introduction',
    'Algorithmic Thinking, 3rd Edition',
    'Algorithmic Thinking, 2nd Edition'
  ]);
  assert.deepEqual(result, { state: 'owned', item: 'Algorithmic Thinking, 2nd Edition' });
});

test('two distinct subtitle-bearing books with the same main title remain new', () => {
  const result = classify('The Complete History of Computing: A Cultural Guide', [
    'The Complete History of Computing: A Technical Survey'
  ]);
  assert.deepEqual(result, { state: 'new' });
});

test('punctuation remains normalization-only and exact matches still win', () => {
  const result = classify("Hello, World!: A Programmer's Guide", ["Hello World A Programmers Guide"]);
  assert.equal(result.state, 'owned');
});

test('TPB is a book-format suffix rather than a distinct owned work', () => {
  assert.deepEqual(classify('4001 A.D.: Beyond New Japan TPB', ['4001 A.D.: Beyond New Japan']), {
    state: 'owned', item: '4001 A.D.: Beyond New Japan'
  });
});

test('same purchased bundle bridges volume subtitles and entitlement qualifiers', () => {
  const bundle = 'Humble Comics Bundle: Masters of the Craft: A Megabundle by Valiant Entertainment';
  for (const [listing, imported] of [
    ['Archer & Armstrong Vol 3 Far Faraway', 'Archer & Armstrong, Vol. 3:Far Faraway (plus extra content)'],
    ['X-O Manowar, Vol. 3: Planet Death', 'X-O Manowar, Vol. 3:Planet Death (plus extra content)'],
    ['X-O Manowar, Vol. 4: Homecoming', 'X-O Manowar Vol 4']
  ]) {
    assert.deepEqual(classifyCurrentBundleVariant(listing, [imported], bundle), { state: 'owned', item: imported }, listing);
  }
});

test('same-bundle volume matching still requires the same series and volume', () => {
  const bundle = 'Humble Comics Bundle: Masters of the Craft: A Megabundle by Valiant Entertainment';
  assert.deepEqual(classifyCurrentBundleVariant('X-O Manowar, Vol. 3: Planet Death', ['X-O Manowar Vol 4'], bundle), { state: 'new' });
  assert.deepEqual(classifyCurrentBundleVariant('X-O Manowar, Vol. 3: Planet Death', ['Ninjak Vol 3'], bundle), { state: 'new' });
});

test('current-bundle inference cannot match a longer bundle sharing a title prefix', () => {
  matcher.document.title = 'Humble Comics Bundle: A Remarkable Collection - Humble Bundle';
  assert.equal(vm.runInContext("isCurrentBundleName('Humble Comics Bundle: A Remarkable Collection')", matcher), true);
  assert.equal(vm.runInContext("isCurrentBundleName('Humble Comics Bundle: A Remarkable Collection: Part Two')", matcher), false);
  matcher.document.title = '';
});

test('short generic subtitles stay new; explicit editions of meaningful short titles are possible', () => {
  assert.deepEqual(classify('It', ['It: A Novel']), { state: 'new' });
  assert.equal(classify('Dune', ['Dune, Second Edition']).state, 'possible');
});

test('title-derived ranges remain Partial even when every numbered title is present', () => {
  assert.deepEqual(classify('Aftermath Vol. 1-3', ['Aftermath Vol. 1', 'Aftermath Vol. 2']), { state: 'partial', owned: 2, total: 3 });
  assert.equal(classify('Aftermath Vol. 1-3', ['Aftermath Vol. 1', 'Aftermath Vol. 2', 'Aftermath Vol. 3']).state, 'partial');
});

test('curated collection issue mapping without language remains Possible', () => {
  const result = classify('Rai (1992) #3', ['Valiant Masters Rai: From Honor To Strength']);
  assert.equal(result.state, 'possible');
  assert.equal(result.item, 'Valiant Masters Rai: From Honor To Strength');
});

test('legacy collection coverage needs known matching language on both sides', () => {
  matcher.__scope = {
    offered: {title:'Rai (1992) #3',language:'en'},
    library: new Map([['collection',{title:'Valiant Masters Rai: From Honor To Strength'}]]),
    mappings: [{...matcher.HumbleCollectionMappings.builtIn[0],language:'en'}]
  };
  assert.ok(vm.runInContext('findOwnedCollectionIssue(__scope.offered.title,__scope.library,__scope.mappings,__scope.offered)',matcher));
  matcher.__scope.offered.language = '';
  assert.equal(vm.runInContext('findOwnedCollectionIssue(__scope.offered.title,__scope.library,__scope.mappings,__scope.offered)',matcher),null);
});

test('structured possible matching chooses the same candidate regardless of library order', () => {
  const first = classify('Think Like a Programmer', [
    'Think Like a Programmer: An Introduction to Creative Problem Solving',
    'Think Like a Programmer: Advanced Techniques'
  ]);
  const second = classify('Think Like a Programmer', [
    'Think Like a Programmer: Advanced Techniques',
    'Think Like a Programmer: An Introduction to Creative Problem Solving'
  ]);
  assert.equal(first.item, second.item);
});
