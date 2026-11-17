(async () => {
  const checks = [], check = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const badge = title => [...document.querySelectorAll('[data-testid="bundle-item-card"]')].find(card => card.querySelector('img')?.alt === title)?.closest('li')?.querySelector('.hcl-status-button')?.textContent;
  const settled = () => document.querySelectorAll('.hcl-status-button').length === 4 && !document.querySelector('.hcl-galactic-pending') && !/Checking|Updating/u.test(document.querySelector('#hcl-summary')?.textContent ?? 'Checking');
  try {
    for (let n = 0; n < 250 && !settled(); n++) await pause(20);
    check(settled(), 'the bundle comparison completes with Library purchases loaded');
    check(badge('Synthetic Barbarian Vol. 1') === 'Owned ×2', 'an imported title bought again in this bundle shows Owned ×2');
    check(badge('Synthetic Remains') === 'Owned ×2', 'a card without the Library subtitle is owned through this bundle\'s purchase and counts both purchases');
    check(badge('Synthetic Newcomer') === 'Owned', 'a first-time Library purchase is Owned once');
    check(badge('Brand new book') === 'New', 'an item without any purchase stays New');
    check(/Already purchased: in your Humble Library \(Humble lists no purchase date\)/u.test(document.querySelector('.hcl-purchased-bundle')?.textContent ?? ''), 'the summary records the Library purchase of this bundle without inventing a date');
    check(/Recorded purchases: 2 Humble purchases\./u.test(document.querySelector('[data-testid="bundle-item-card"] img[alt="Synthetic Remains"]')?.closest('li')?.querySelector('.hcl-status-button')?.parentElement?.title ?? ''), 'the explanation states the purchase count');
    await fetch('/test-result', {method: 'POST', body: JSON.stringify({checks})});
  } catch (error) {
    await fetch('/test-result', {method: 'POST', body: JSON.stringify({checks, error: error.message + ' ' + JSON.stringify([...document.querySelectorAll('.hcl-status-button')].map(b => b.textContent))})});
  }
})();
