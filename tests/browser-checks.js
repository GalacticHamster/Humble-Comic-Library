(async () => {
  const checks = [];
  const check = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const waitFor = async predicate => { for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(done => setTimeout(done, 30)); } throw new Error('Timed out waiting for storefront'); };
  let error;
  try {
    await waitFor(() => document.querySelector('#hcl-summary'));
    check(document.querySelectorAll('.hcl-status-button').length === 5, 'Every card has an accessible ownership explanation button');
    const partial = [...document.querySelectorAll('.hcl-status-button')].find(button => button.dataset.state === 'partial');
    check(partial?.textContent === '3/4 Owned', 'Reviewed local and GL contents combine into Partial coverage');
    partial.click();
    const dialog = document.querySelector('#hcl-match-inspector');
    check(dialog?.open && dialog.textContent.includes('GL collection') && dialog.textContent.includes('Owned collection'), 'Inspector opens and names both ownership sources');
    check(dialog.textContent.includes('Manga (2000) volume 3') && dialog.textContent.includes('Publisher') && dialog.textContent.includes('2026-10-01'), 'Inspector explains missing units and dated source evidence');
    [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Review in Galactic Library').click();
    await waitFor(() => fixtureReviewCalls.length);
    check(fixtureReviewCalls[0].type === 'HCL_OPEN_GALACTIC_REVIEW', 'Central review uses the internal navigation action');
    [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Close').click();
    await waitFor(() => !document.querySelector('#hcl-match-inspector'));
    check(!document.querySelector('#hcl-match-inspector'), 'Closing removes the evidence dialog');
    const possible = [...document.querySelectorAll('.hcl-status-button')].find(button => button.dataset.state === 'possible');
    possible.click();
    check(document.querySelector('#hcl-match-inspector').textContent.includes('Dune, 1st Edition'), 'Possible explains the actual different owned edition');
    document.querySelector('#hcl-match-inspector button').click();
    await waitFor(() => !document.querySelector('#hcl-match-inspector'));
    const minimize = [...document.querySelectorAll('.hcl-summary-controls button')].find(button => button.textContent === 'Minimize');
    minimize.click();
    check(document.querySelector('#hcl-summary').classList.contains('hcl-summary-minimized'), 'Summary still minimizes with the new controls');
    document.querySelector('.hcl-summary-expand').click();
    check(!document.querySelector('#hcl-summary').classList.contains('hcl-summary-minimized'), 'Summary still expands');
    check(fixtureCalls.every(call => call.items.every(item => item.excludeProviders.includes('humble'))), 'GL requests consistently exclude stale Humble records');
  } catch (failure) { error = failure.stack || failure.message; }
  await fetch('/test-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checks, ...(error ? { error } : {}) }) });
})().catch(error => console.error(error));
