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
    const libraryMatcher = createLibraryMatcher(libraryByKey, itemKind);
    const exact = libraryByKey.get(HumbleComicLibrary.titleKey(title));
    const volumeRange = exact ? null : findOwnedVolumeRange(title, libraryByKey);
    const bookVariant = exact || volumeRange || itemKind !== 'book' ? null : findOwnedBookVariant(title, libraryMatcher);
    const collectionIssue = exact || volumeRange || bookVariant || itemKind !== 'book' ? null : findOwnedCollectionIssue(title, libraryByKey, mappings);
    const possible = exact || volumeRange || bookVariant || collectionIssue ? null : findPossibleMatch(title, libraryMatcher, itemKind);
    if (exact || volumeRange?.complete || bookVariant || collectionIssue) return { state: 'owned', item: (exact ?? volumeRange?.items[0] ?? bookVariant?.item ?? collectionIssue?.item).title };
    if (volumeRange) return { state: 'partial', owned: volumeRange.owned, total: volumeRange.total };
    return possible ? { state: 'possible', item: possible.items.title, reason: possible.reason } : { state: 'new' };
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
      const libraryMatcher = createLibraryMatcher(libraryByKey, 'book');
      const exact = libraryByKey.get(HumbleComicLibrary.titleKey(title));
      const variant = exact ? null : findOwnedBookVariant(title, libraryMatcher);
      return exact || variant ? { state: 'owned', item: (exact ?? variant.item).title } : { state: 'new' };
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

test('short generic subtitles stay new; explicit editions of meaningful short titles are possible', () => {
  assert.deepEqual(classify('It', ['It: A Novel']), { state: 'new' });
  assert.equal(classify('Dune', ['Dune, Second Edition']).state, 'possible');
});

test('volume-range partial and complete ownership behavior is unchanged', () => {
  assert.deepEqual(classify('Aftermath Vol. 1-3', ['Aftermath Vol. 1', 'Aftermath Vol. 2']), { state: 'partial', owned: 2, total: 3 });
  assert.equal(classify('Aftermath Vol. 1-3', ['Aftermath Vol. 1', 'Aftermath Vol. 2', 'Aftermath Vol. 3']).state, 'owned');
});

test('curated collection issue mapping behavior is unchanged', () => {
  const result = classify('Rai (1992) #3', ['Valiant Masters Rai: From Honor To Strength']);
  assert.deepEqual(result, { state: 'owned', item: 'Valiant Masters Rai: From Honor To Strength' });
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
