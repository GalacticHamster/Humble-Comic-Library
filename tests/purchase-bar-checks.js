(async () => {
  const checks = [], check = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (predicate, what) => { for (let n = 0; n < 250; n++) { if (predicate()) return; await pause(20); } throw Error(what + ' did not settle'); };
  const activity = {scans: 0, matches: 0, lookups: 0};
  const scan = renderBundleComparison, match = classifyLocalBundleItem, lookup = queryGalacticLibrary;
  renderBundleComparison = function (...args) { activity.scans++; return scan.apply(this, args); };
  classifyLocalBundleItem = function (...args) { activity.matches++; return match.apply(this, args); };
  queryGalacticLibrary = function (...args) { activity.lookups++; return lookup.apply(this, args); };
  const badges = () => [...document.querySelectorAll('.hcl-status-button')];
  const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  // Humble's narrow-window purchase bar: tier choice, subtotal and Add to Cart pinned to the bottom of the viewport.
  const addBar = () => {
    const bar = document.createElement('div'); bar.dataset.testid = 'bundle-mobile-footer';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:190px;background:#123;z-index:40';
    const cart = Object.assign(document.createElement('button'), {textContent: 'Add to Cart'}); cart.style.cssText = 'position:absolute;left:12px;right:12px;bottom:24px;height:50px';
    bar.append(cart); document.body.append(bar);
    return {bar, cart};
  };
  try {
    await wait(() => badges().length === 4 && !document.querySelector('.hcl-galactic-pending') && !/Checking|Updating/u.test(document.querySelector('#hcl-summary')?.textContent ?? 'Checking'), 'Initial comparison');
    await pause(300);
    const panel = document.querySelector('#hcl-summary'), nodes = badges(), position = panel.dataset.position;
    const restingBottom = innerHeight - panel.getBoundingClientRect().bottom;
    check(position === 'bottom-right' && panel.getBoundingClientRect().right > innerWidth / 2, 'with no saved corner the panel starts bottom right');
    check(Math.abs(restingBottom - 16) < 1, 'without a pinned purchase bar the panel keeps its usual bottom margin');
    check(panel.getBoundingClientRect().height <= Math.max(innerHeight / 2, 288) + 1, 'the expanded panel leaves at least half of a short window clear');
    const counts = JSON.stringify(activity);
    const {bar, cart} = addBar();
    await wait(() => overlap(panel.getBoundingClientRect(), bar.getBoundingClientRect()) === 0, 'Lifting the panel above the purchase bar');
    check(document.elementFromPoint(cart.getBoundingClientRect().left + cart.getBoundingClientRect().width - 8, cart.getBoundingClientRect().top + 25) === cart, 'expanded: Add to Cart is reachable, including the end under the panel\'s corner');
    panel.querySelector('.hcl-summary-minimize').click(); await pause(100);
    check(panel.classList.contains('hcl-summary-minimized') && overlap(panel.getBoundingClientRect(), bar.getBoundingClientRect()) === 0, 'minimized: the panel also stays above the purchase bar');
    // Scrolling does not move the panel.
    const before = panel.getBoundingClientRect().top;
    scrollTo(0, 400); await pause(150); scrollTo(0, 0); await pause(150);
    check(panel.getBoundingClientRect().top === before, 'scrolling does not move the panel');
    panel.querySelector('.hcl-summary-expand').click(); await pause(100);
    bar.remove();
    await wait(() => Math.abs(innerHeight - panel.getBoundingClientRect().bottom - 16) < 1, 'Returning to the usual margin');
    check(!document.documentElement.style.getPropertyValue('--hcl-page-bottom-inset'), 'the panel returns to its usual margin when the purchase bar goes away');
    // A hidden bar (Humble's wide layout keeps it in the page, not displayed) does not lift the panel.
    const hidden = addBar(); hidden.bar.style.display = 'none'; await pause(200);
    check(Math.abs(innerHeight - panel.getBoundingClientRect().bottom - 16) < 1, 'a purchase bar that is not displayed does not move the panel');
    hidden.bar.remove();
    // A chosen bottom-left corner is kept and also sits above the bar.
    panel.querySelector('select').value = 'bottom-left'; panel.querySelector('select').dispatchEvent(new Event('change', {bubbles: true}));
    await wait(() => panel.dataset.position === 'bottom-left', 'Moving the panel to the bottom left');
    const left = addBar();
    await wait(() => overlap(panel.getBoundingClientRect(), left.bar.getBoundingClientRect()) === 0, 'Lifting a bottom-left panel');
    check(panel.dataset.position === 'bottom-left' && panel.getBoundingClientRect().left < innerWidth / 2, 'a chosen bottom-left corner is kept and sits above the purchase bar');
    left.bar.remove();
    // A top position is never moved.
    panel.querySelector('select').value = 'top-left'; panel.querySelector('select').dispatchEvent(new Event('change', {bubbles: true}));
    await wait(() => panel.dataset.position === 'top-left', 'Moving the panel to the top');
    const top = panel.getBoundingClientRect().top, shown = addBar(); await pause(200);
    check(panel.getBoundingClientRect().top === top && Math.abs(top - 16) < 1, 'a top-positioned panel is not moved by the purchase bar');
    shown.bar.remove();
    check(panel === document.querySelector('#hcl-summary') && nodes.every((node, i) => node === badges()[i]), 'the same panel and badge nodes remain');
    check(JSON.stringify(activity) === counts, 'the purchase bar, minimizing and scrolling perform no scan, match or Galactic Library request');
    await fetch('/test-result', {method: 'POST', body: JSON.stringify({checks})});
  } catch (error) {
    await fetch('/test-result', {method: 'POST', body: JSON.stringify({checks, error: error.message + ' ' + JSON.stringify({activity, inset: document.documentElement.style.getPropertyValue('--hcl-page-bottom-inset')})})});
  }
})();
