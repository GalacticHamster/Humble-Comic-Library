(async () => {
  const checks = [], check = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const activity = {models: 0, matchers: 0, scans: 0, lookups: 0};
  const model = libraryPurchaseModel, matcher = createBundleLibraryMatcher, scan = renderBundleComparison, lookup = queryGalacticLibrary;
  libraryPurchaseModel = function (...args) { activity.models++; return model.apply(this, args); };
  createBundleLibraryMatcher = function (...args) { activity.matchers++; return matcher.apply(this, args); };
  renderBundleComparison = function (...args) { activity.scans++; return scan.apply(this, args); };
  queryGalacticLibrary = function (...args) { activity.lookups++; return lookup.apply(this, args); };
  const badge = title => [...document.querySelectorAll('[data-testid="bundle-item-card"]')].find(card => card.querySelector('img')?.alt === title)?.closest('li')?.querySelector('.hcl-status-button')?.textContent;
  const settled = () => document.querySelectorAll('.hcl-status-button').length === 4 && !document.querySelector('.hcl-galactic-pending') && !/Checking|Updating/u.test(document.querySelector('#hcl-summary')?.textContent ?? 'Checking');
  const settle = async () => { await pause(400); for (let n = 0; n < 250 && !settled(); n++) await pause(20); await pause(200); };
  const counts = () => JSON.stringify(activity);
  // What another tab's write looks like: storage holds the new value and listeners receive both values.
  const write = (key, update) => { const oldValue = structuredClone(fixtureStored[key]), newValue = structuredClone(oldValue); update(newValue); fixtureStored[key] = newValue;
    fixtureStorageListeners.forEach(listener => listener({[key]: {oldValue, newValue}}, 'local')); };
  try {
    await settle();
    check(settled() && badge('Synthetic Newcomer') === 'Owned' && badge('Brand new book') === 'New', 'the bundle comparison completes with Library purchases loaded');
    let before = counts();
    const nodes = [...document.querySelectorAll('.hcl-status-button')];
    write('libraryEntitlements', e => { for (const r of e.scopes[0].observations) r.observedAt = '2026-11-17T12:00:00.000Z'; e.scopes[0].lastScan = null; });
    await settle();
    check(counts() === before && nodes.every((node, i) => node === document.querySelectorAll('.hcl-status-button')[i]), 'a sync batch that only refreshes saved purchases rebuilds nothing, rescans nothing and asks Galactic Library nothing');
    window.dispatchEvent(new Event('hcl-refresh-central'));
    await settle();
    check(activity.scans > JSON.parse(before).scans && activity.models === JSON.parse(before).models && activity.matchers === JSON.parse(before).matchers && badge('Synthetic Barbarian Vol. 1') === 'Owned ×2',
      'a page refresh (a tier change, remounted cards) reuses the saved library model and matcher with the same results');
    before = counts();
    await chrome.storage.local.set({catalogueFilters: {hidePurchased: true}});
    await settle();
    check(counts() === before, 'catalogue filter changes do not recheck a bundle page');
    write('libraryEntitlements', e => { const r = e.scopes[0].observations.find(o => o.title === 'Synthetic Newcomer'); r.eligibility.giftStatus = 'gifted'; r.purchaseStatus = 'excluded'; r.admission = 'observation-only'; });
    await settle();
    check(activity.models > JSON.parse(before).models && activity.matchers > JSON.parse(before).matchers && badge('Synthetic Newcomer') === 'New', 'a gifted-away purchase rebuilds the library and is no longer Owned');
    write('libraryEntitlements', e => { const r = structuredClone(e.scopes[0].observations[0]); Object.assign(r, {nativeId: '00000000-0000-4000-8000-000000000099', parentId: '00000000-0000-4000-8000-000000000098', parentTitle: 'Synthetic Later Bundle', title: 'Brand new book', observedAt: '2026-11-17T12:00:00.000Z'}); e.scopes[0].observations.push(r); });
    await settle();
    check(badge('Brand new book') === 'Owned', 'a newly synced purchase is recognised without reloading the page');
    before = counts();
    // A change without its previous value cannot be compared, so it rebuilds.
    await chrome.storage.local.set({libraryEntitlements: structuredClone(fixtureStored.libraryEntitlements)});
    await settle();
    check(activity.models > JSON.parse(before).models, 'a library change that cannot be compared rebuilds');
    await fetch('/test-result', {method: 'POST', body: JSON.stringify({checks})});
  } catch (error) {
    await fetch('/test-result', {method: 'POST', body: JSON.stringify({checks, error: error.message + ' ' + JSON.stringify({activity, badges: [...document.querySelectorAll('.hcl-status-button')].map(b => b.textContent)})})});
  }
})();
