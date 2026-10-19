import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = {};
    this.style = {
      _styles: new Map(),
      setProperty(k, v) { this._styles.set(k, v); },
      removeProperty(k) { this._styles.delete(k); },
      getPropertyValue(k) { return this._styles.get(k) || ''; }
    };
    this.open = false;
    this.disabled = false;
    this._classes = new Set();
    this._textContent = '';
  }

  get id() {
    return this.attributes.get('id') ?? '';
  }

  set id(val) {
    this.setAttribute('id', val);
  }

  get className() {
    return [...this._classes].join(' ');
  }

  set className(val) {
    this._classes.clear();
    if (val) {
      val.split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c));
    }
  }

  get classList() {
    return {
      add: (...cls) => cls.forEach(c => this._classes.add(c)),
      remove: (...cls) => cls.forEach(c => this._classes.delete(c)),
      contains: (c) => this._classes.has(c),
      toggle: (c, force) => {
        if (force === true) this._classes.add(c);
        else if (force === false) this._classes.delete(c);
        else if (this._classes.has(c)) this._classes.delete(c);
        else this._classes.add(c);
      }
    };
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map(c => typeof c === 'string' ? c : c.textContent).join('');
  }

  set textContent(val) {
    this.children = [];
    this._textContent = String(val);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, handler) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  contains(other) {
    let curr = other;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentElement;
    }
    return false;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === 'string') {
        const textNode = new MockElement('#text');
        textNode._textContent = node;
        textNode.parentElement = this;
        this.children.push(textNode);
      } else if (node instanceof MockElement) {
        if (node.parentElement) {
          node.remove();
        }
        node.parentElement = this;
        this.children.push(node);
      }
    }
  }

  prepend(...nodes) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (typeof node === 'string') {
        const textNode = new MockElement('#text');
        textNode._textContent = node;
        textNode.parentElement = this;
        this.children.unshift(textNode);
      } else if (node instanceof MockElement) {
        if (node.parentElement) {
          node.remove();
        }
        node.parentElement = this;
        this.children.unshift(node);
      }
    }
  }

  replaceChildren(...nodes) {
    for (const child of this.children) {
      if (child instanceof MockElement) child.parentElement = null;
    }
    this.children = [];
    this._textContent = '';
    this.append(...nodes);
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  get isConnected() {
    let curr = this;
    while (curr) {
      if (curr.tagName === 'BODY') return true;
      curr = curr.parentElement;
    }
    return false;
  }

  replaceWith(newEl) {
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx !== -1) {
      if (newEl.parentElement) newEl.remove();
      newEl.parentElement = this.parentElement;
      this.parentElement.children.splice(idx, 1, newEl);
      this.parentElement = null;
    }
  }

  after(newEl) {
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx !== -1) {
      if (newEl.parentElement) newEl.remove();
      newEl.parentElement = this.parentElement;
      this.parentElement.children.splice(idx + 1, 0, newEl);
    }
  }

  before(newEl) {
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx !== -1) {
      if (newEl.parentElement) newEl.remove();
      newEl.parentElement = this.parentElement;
      this.parentElement.children.splice(idx, 0, newEl);
    }
  }

  matches(selector) {
    return this._matchesSingle(this, selector);
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (!(child instanceof MockElement)) continue;
      if (this._matchesComplex(child, selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    for (const child of this.children) {
      if (!(child instanceof MockElement)) continue;
      if (this._matchesComplex(child, selector)) results.push(child);
      results.push(...child.querySelectorAll(selector));
    }
    return results;
  }

  _matchesComplex(el, selector) {
    const parts = selector.split(/\s+/);
    if (parts.length === 1) {
      return this._matchesSingle(el, parts[0]);
    }
    let current = el;
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (!current || !this._matchesSingle(current, part)) return false;
      current = current.parentElement;
    }
    return true;
  }

  _matchesSingle(el, sel) {
    let s = sel;
    const attrMatch = s.match(/\[([^=\]]+)(?:="([^"]*)")?\]/);
    if (attrMatch) {
      const attrName = attrMatch[1];
      const attrVal = attrMatch[2];
      if (attrName.startsWith('data-')) {
        const key = attrName.slice(5);
        if (attrVal !== undefined) {
          if (el.dataset[key] !== attrVal) return false;
        } else if (!(key in el.dataset)) {
          return false;
        }
      } else {
        if (attrVal !== undefined) {
          if (el.getAttribute(attrName) !== attrVal) return false;
        } else if (!el.attributes.has(attrName)) {
          return false;
        }
      }
      s = s.replace(attrMatch[0], '');
    }
    if (!s) return true;
    if (s.startsWith('#')) return el.id === s.slice(1);
    if (s.startsWith('.')) {
      const classes = s.split('.').filter(Boolean);
      return classes.every(c => el._classes.has(c));
    }
    if (s.includes('.')) {
      const [tag, ...classes] = s.split('.');
      if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
      return classes.every(c => el._classes.has(c));
    }
    return el.tagName.toLowerCase() === s.toLowerCase();
  }
}

function createHarness() {
  const root = new MockElement('body');
  const doc = {
    title: '',
    body: root,
    createElement: (tag) => new MockElement(tag),
    querySelector: (sel) => root.querySelector(sel),
    querySelectorAll: (sel) => root.querySelectorAll(sel)
  };

  const context = {
    Blob, URL, clearTimeout, console, document: doc,
    location: { pathname: '/books/test-bundle' },
    performance: { now: () => 100 },
    Promise, setTimeout,
    chrome: {
      runtime: {
        id: 'mock-ext-id',
        sendMessage: async () => ({ ok: true, apiVersion: 1, results: [] })
      },
      storage: {
        local: {
          get: async (d) => ({ ...d }),
          set: async () => {}
        }
      }
    }
  };
  context.globalThis = context;
  vm.createContext(context);

  for (const file of ['shared.js', 'collection-mappings.js', 'ownership.js', 'content.js']) {
    vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context, { filename: file });
  }

  return { context, doc, root };
}

test('two-phase rendering: Phase 1 renders preliminary summary with static pending bullet', () => {
  const { context, doc } = createHarness();

  const counts = { owned: 1, elsewhere: 0, partial: 0, possible: 0, new: 2, unchecked: 0 };
  const tiers = new Map([
    ['Tier 1', { label: '$5.00 tier', price: 5, total: 3, owned: 1, elsewhere: 0, partial: 0, possible: 0, new: 2, unchecked: 0 }]
  ]);
  const titlesByState = {
    owned: [{ title: 'Owned Book 1', match: { state: 'owned' } }],
    elsewhere: [],
    partial: [],
    possible: [],
    new: [{ title: 'Book 2', match: { state: 'new' } }, { title: 'Book 3', match: { state: 'new' } }],
    unchecked: []
  };
  const comparison = {
    galactic: { enabled: true, resultsByKey: new Map(), failuresByKey: new Map() }
  };

  context.renderComparisonSummary(counts, tiers, titlesByState, 'book', [], comparison, { pendingGalactic: true });

  const summary = doc.querySelector('#hcl-summary');
  assert.ok(summary, 'Summary overlay is mounted in Phase 1');

  // 1. Preliminary headline wording
  const headline = summary.querySelector('.hcl-summary-counts');
  assert.ok(headline, 'Headline counts exist');
  assert.match(headline.textContent, /^Preliminary:/, 'Headline starts with Preliminary:');
  assert.match(headline.textContent, /Owned 1/, 'Headline reports Owned count');
  assert.match(headline.textContent, /Not owned locally 2/, 'Headline reports Not owned locally instead of New');

  // 2. Static nonintrusive Galactic Library indicator
  const galacticStatus = summary.querySelector('.hcl-galactic-status');
  assert.ok(galacticStatus, 'Galactic status line exists');
  assert.ok(galacticStatus.classList.contains('hcl-galactic-pending'), 'Status has hcl-galactic-pending class');
  assert.match(galacticStatus.textContent, /Checking Galactic Library…/, 'Status indicates GL check in progress');
  const bullet = galacticStatus.querySelector('.hcl-pending-bullet');
  assert.ok(bullet, 'Static bullet indicator is rendered');
  assert.equal(bullet.textContent, '●', 'Static bullet is ●');

  // 3. Tier breakdown uses preliminary wording
  const tierLi = summary.querySelector('ul li');
  assert.ok(tierLi, 'Tier row is rendered');
  assert.match(tierLi.textContent, /2 not owned locally \/ 3/, 'Tier row displays not owned locally count');

  // 4. Title breakdown uses preliminary wording
  const newDetails = summary.querySelector('.hcl-title-list[data-section="new"] summary');
  assert.ok(newDetails, 'New items title list disclosure exists');
  assert.match(newDetails.textContent, /Not owned locally \(2\)/, 'Title list heading says Not owned locally');
});

test('two-phase rendering: Phase 2 in-place update seamlessly updates counts, status and preserves open details', () => {
  const { context, doc } = createHarness();

  // Phase 1 setup
  const localCounts = { owned: 1, elsewhere: 0, partial: 0, possible: 0, new: 2, unchecked: 0 };
  const tiers = new Map([
    ['Tier 1', { label: '$5.00 tier', price: 5, total: 3, owned: 1, elsewhere: 0, partial: 0, possible: 0, new: 2, unchecked: 0 }]
  ]);
  const localTitles = {
    owned: [{ title: 'Owned Book 1', match: { state: 'owned' } }],
    elsewhere: [],
    partial: [],
    possible: [],
    new: [{ title: 'Book 2', match: { state: 'new' } }, { title: 'Book 3', match: { state: 'new' } }],
    unchecked: []
  };
  const comparison = {
    galactic: { enabled: true, resultsByKey: new Map(), failuresByKey: new Map() }
  };

  context.renderComparisonSummary(localCounts, tiers, localTitles, 'book', [], comparison, { pendingGalactic: true });
  const summaryEl = doc.querySelector('#hcl-summary');
  assert.ok(summaryEl);

  // User opens the new section and advanced section
  const newSection = summaryEl.querySelector('.hcl-title-list[data-section="new"]');
  assert.ok(newSection);
  newSection.open = true;

  const advancedSection = summaryEl.querySelector('.hcl-advanced');
  if (advancedSection) advancedSection.open = true;

  // Phase 2: GL returns finding Book 2 is owned elsewhere!
  const finalCounts = { owned: 1, elsewhere: 1, partial: 0, possible: 0, new: 1, unchecked: 0 };
  const finalTiers = new Map([
    ['Tier 1', { label: '$5.00 tier', price: 5, total: 3, owned: 1, elsewhere: 1, partial: 0, possible: 0, new: 1, unchecked: 0 }]
  ]);
  const finalTitles = {
    owned: [{ title: 'Owned Book 1', match: { state: 'owned' } }],
    elsewhere: [{ title: 'Book 2', match: { state: 'elsewhere' } }],
    partial: [],
    possible: [],
    new: [{ title: 'Book 3', match: { state: 'new' } }],
    unchecked: []
  };
  comparison.galactic.resultsByKey.set('book:book 2', { matches: [{ title: 'Book 2', provider: 'steam', ownership: 'owned' }] });

  context.updateComparisonSummary(summaryEl, finalCounts, finalTiers, finalTitles, 'book', [], comparison);

  // Verify same root element was updated in-place
  assert.equal(doc.querySelector('#hcl-summary'), summaryEl, 'Root summary element was preserved in-place');

  // Verify settled headline
  const headline = summaryEl.querySelector('.hcl-summary-counts');
  assert.doesNotMatch(headline.textContent, /Preliminary:/, 'Preliminary prefix removed');
  assert.match(headline.textContent, /Owned 1 · Owned elsewhere 1 · New 1/, 'Final combined counts rendered');

  // Verify GL status is complete
  const status = summaryEl.querySelector('.hcl-galactic-status');
  assert.ok(!status.classList.contains('hcl-galactic-pending'), 'Pending class removed');
  assert.match(status.textContent, /Galactic Library: checked linked libraries\./, 'Status reflects complete merge');

  // Verify tier list updated
  const tierLi = summaryEl.querySelector('ul li');
  assert.match(tierLi.textContent, /1 new \/ 3/, 'Tier row displays final confirmed-new count');

  // Verify open state preserved on title sections
  const updatedNewSection = summaryEl.querySelector('.hcl-title-list[data-section="new"]');
  assert.ok(updatedNewSection, 'New section still present');
  assert.equal(updatedNewSection.open, true, 'User open state was preserved across in-place update');

  const elsewhereSection = summaryEl.querySelector('.hcl-title-list[data-section="elsewhere"]');
  assert.ok(elsewhereSection, 'Elsewhere section newly populated');
});

test('two-phase rendering: incomplete GL state preserves local evidence with retry button', () => {
  const { context, doc } = createHarness();

  const counts = { owned: 1, elsewhere: 0, partial: 0, possible: 0, new: 1, unchecked: 0 };
  const tiers = new Map([
    ['Tier 1', { label: '$5.00 tier', price: 5, total: 2, owned: 1, elsewhere: 0, partial: 0, possible: 0, new: 1, unchecked: 0 }]
  ]);
  const titles = {
    owned: [{ title: 'Book 1', match: { state: 'owned' } }],
    elsewhere: [], partial: [], possible: [],
    new: [{ title: 'Book 2', match: { state: 'new' } }],
    unchecked: []
  };
  const comparison = {
    galactic: { enabled: true, resultsByKey: new Map(), failuresByKey: new Map() }
  };

  context.renderComparisonSummary(counts, tiers, titles, 'book', [], comparison, { pendingGalactic: true });
  const summaryEl = doc.querySelector('#hcl-summary');
  assert.ok(summaryEl);

  // GL fails / times out
  const failedCounts = { owned: 1, elsewhere: 0, partial: 0, possible: 0, new: 0, unchecked: 1 };
  const failedTiers = new Map([
    ['Tier 1', { label: '$5.00 tier', price: 5, total: 2, owned: 1, elsewhere: 0, partial: 0, possible: 0, new: 0, unchecked: 1 }]
  ]);
  const failedTitles = {
    owned: [{ title: 'Book 1', match: { state: 'owned' } }],
    elsewhere: [], partial: [], possible: [], new: [],
    unchecked: [{ title: 'Book 2', match: { state: 'unchecked', lookupIncomplete: true } }]
  };
  comparison.retryGalactic = () => {};
  comparison.galactic.error = 'Central lookup timed out after 30 seconds.';
  comparison.galactic.failuresByKey.set('book:book 2', 'timeout');

  context.updateComparisonSummary(summaryEl, failedCounts, failedTiers, failedTitles, 'book', [], comparison);

  const galacticStatus = summaryEl.querySelector('.hcl-galactic-status');
  assert.match(galacticStatus.textContent, /Galactic Library: check incomplete\./, 'Status notes incomplete check');
  const retryBtn = summaryEl.querySelector('.hcl-retry-galactic');
  assert.ok(retryBtn, 'Retry button rendered');
  assert.equal(retryBtn.disabled, false, 'Retry button is enabled');

  const uncheckedSection = summaryEl.querySelector('.hcl-title-list[data-section="unchecked"]');
  assert.ok(uncheckedSection, 'Check incomplete section present in breakdown');
  assert.match(uncheckedSection.querySelector('summary').textContent, /Check incomplete \(1\)/);
});

test('two-phase rendering: stale GL response after job change is rejected without updating UI', async () => {
  const { context, doc, root } = createHarness();

  let finishGlLookup;
  context.chrome.runtime.sendMessage = async (_id, request) => {
    if (request.type === 'MATCH_ITEMS') {
      return new Promise(resolve => { finishGlLookup = resolve; });
    }
    return { ok: true, apiVersion: 1, results: [] };
  };

  const comparison = {
    job: 1,
    emptyChecks: 0,
    startedAt: 100,
    galactic: context.createGalacticLookup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  };

  const items = [{
    title: 'Test Novel',
    lookupTitle: 'Test Novel',
    kind: 'book',
    tier: { label: '$1.00 tier', price: 1 }
  }];

  const matcher = context.createLibraryMatcher([], 'book');

  // Stub collectBundleItems and bundleMediaContext
  context.collectBundleItems = () => items;
  context.sortBundleItems = () => ({});
  context.bundleMediaContext = () => ({
    productsByTitle: new Map(),
    tierByTitle: new Map()
  });
  context.showComparisonProgress = () => {};
  context.removeComparisonProgress = () => {};
  context.applyBundleNewItemsOnlyFilter = () => {};
  context.annotateAllCoverCopies = () => {};

  // Start job 1
  const renderPromise = context.renderBundleComparison(matcher, 'book', [], [], comparison, 1);

  // Phase 1 has run synchronously up to GL query:
  const summaryEl = doc.querySelector('#hcl-summary');
  assert.ok(summaryEl, 'Phase 1 summary mounted');
  const headline = summaryEl.querySelector('.hcl-summary-counts');
  assert.match(headline.textContent, /^Preliminary:/, 'Preliminary headline in Phase 1');

  // User navigates or newer job starts:
  comparison.job = 2;

  // Now job 1's GL response arrives late:
  finishGlLookup({
    ok: true,
    apiVersion: 1,
    results: [{
      requestId: 'book:test novel',
      matches: [{ title: 'Test Novel', provider: 'steam', ownership: 'owned' }]
    }]
  });

  await renderPromise;

  // Verify that headline was NOT updated by the stale job 1!
  assert.match(headline.textContent, /^Preliminary:/, 'Stale job 1 does not overwrite UI with settled results');
});

