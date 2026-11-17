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
  const visible = element => getComputedStyle(element).visibility === 'visible';
  const yielded = () => document.documentElement.hasAttribute('data-hcl-provider-modal');
  const states = () => JSON.stringify(badges().map(b => [b.dataset.state, b.textContent]));
  // Humble's cart drawer as Radix renders it: an open role=dialog portal; the rest of the page stops taking pointer input.
  const openDrawer = () => {
    const drawer = Object.assign(document.createElement('div'), {id: 'synthetic-cart', textContent: 'Your cart'});
    drawer.setAttribute('role', 'dialog'); drawer.dataset.state = 'open';
    drawer.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:60vw;z-index:50;background:#222;pointer-events:auto';
    document.body.append(drawer); document.body.style.pointerEvents = 'none';
    return () => { drawer.dataset.state = 'closed'; document.body.style.pointerEvents = ''; drawer.remove(); };
  };
  try {
    await wait(() => badges().length === 4 && !document.querySelector('.hcl-galactic-pending') && !/Checking|Updating/u.test(document.querySelector('#hcl-summary')?.textContent ?? 'Checking'), 'Initial comparison');
    await pause(300);
    check(!yielded() && visible(document.querySelector('#hcl-summary')) && badges().every(visible), 'HB panel and badges show normally without a Humble modal');
    const panel = document.querySelector('#hcl-summary'), nodes = badges(), before = states();
    for (const mode of ['expanded', 'minimized']) {
      if (mode === 'minimized') { panel.querySelector('.hcl-summary-minimize').click(); await pause(50); }
      const counts = JSON.stringify(activity), minimized = panel.classList.contains('hcl-summary-minimized'), position = panel.dataset.position;
      let hbMutations = 0;
      const observer = new MutationObserver(records => { for (const r of records) for (const node of [...r.addedNodes, ...r.removedNodes]) if (node.nodeType === 1 && (node.matches('.hcl-status-button, #hcl-summary, #hcl-progress') || node.querySelector('.hcl-status-button'))) hbMutations++; });
      observer.observe(document.body, {subtree: true, childList: true});
      const close = openDrawer();
      await wait(yielded, 'Yielding to the drawer');
      const rect = panel.getBoundingClientRect();
      document.body.style.pointerEvents = '';
      const atPanel = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      document.body.style.pointerEvents = 'none';
      check(!visible(panel) && badges().every(badge => !visible(badge)), `${mode}: an open cart drawer hides the HB panel and badges`);
      check(!atPanel?.closest('#hcl-summary'), `${mode}: nothing of HB's panel is above the drawer`);
      close();
      await wait(() => !yielded(), 'Returning after the drawer');
      await pause(400);
      observer.disconnect();
      check(visible(panel) && badges().every(visible), `${mode}: the panel and badges return when the drawer closes`);
      check(panel === document.querySelector('#hcl-summary') && nodes.every((node, i) => node === badges()[i]) && hbMutations === 0 && states() === before, `${mode}: the same panel and badge nodes keep their results`);
      check(panel.classList.contains('hcl-summary-minimized') === minimized && panel.dataset.position === position, `${mode}: minimized state and position are unchanged`);
      check(JSON.stringify(activity) === counts, `${mode}: opening and closing the drawer performs no scan, match or Galactic Library request`);
    }
    panel.querySelector('.hcl-summary-expand').click(); await pause(50);
    // A page <dialog> opened as a modal also takes precedence.
    const dialog = document.createElement('dialog'); dialog.textContent = 'Sign in'; document.body.append(dialog); dialog.showModal();
    await wait(yielded, 'Yielding to a modal dialog');
    check(!visible(panel), 'a modal <dialog> from the page hides the panel');
    dialog.close(); dialog.remove();
    await wait(() => !yielded() && visible(panel), 'Returning after a modal dialog');
    // A non-modal open dialog (a popover or menu) does not block the page, so HB stays.
    const popover = document.createElement('div'); popover.setAttribute('role', 'dialog'); popover.dataset.state = 'open'; popover.textContent = 'Menu'; document.body.append(popover);
    await pause(300);
    check(!yielded() && visible(panel), 'a non-modal open dialog leaves the panel visible');
    popover.remove();
    // HB's own evidence dialog is not a Humble modal.
    badges()[0].click();
    await wait(() => document.querySelector('#hcl-match-inspector')?.open, 'Opening the evidence dialog');
    await pause(300);
    check(!yielded() && visible(panel), 'HB\'s own evidence dialog does not hide HB');
    document.querySelector('#hcl-match-inspector').close();
    await fetch('/test-result', {method: 'POST', body: JSON.stringify({checks})});
  } catch (error) {
    await fetch('/test-result', {method: 'POST', body: JSON.stringify({checks, error: error.message + ' ' + JSON.stringify({activity, yielded: yielded(), badges: badges().length})})});
  }
})();
