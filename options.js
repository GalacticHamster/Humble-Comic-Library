(function initOptions() {
  'use strict';
  const fileInput = document.querySelector('#import-file');
  const status = document.querySelector('#import-status');
  const count = document.querySelector('#library-count');
  const preview = document.querySelector('#library-preview');
  const lastImport = document.querySelector('#last-import');

  async function library() {
    return (await chrome.storage.local.get({ libraryItems: [] })).libraryItems;
  }

  async function render() {
    const { lastImport: summary, purchaseSummaries = [] } = await chrome.storage.local.get({ lastImport: null, purchaseSummaries: [] });
    const items = await library();
    const pricedPurchases = purchaseSummaries.filter((purchase) => purchase.pricePaid !== null).length;
    const games = items.filter((item) => item.kind === 'game').length;
    count.textContent = `${items.length} unique item${items.length === 1 ? '' : 's'} stored locally${games ? ` (${games} game${games === 1 ? '' : 's'})` : ''}. ${purchaseSummaries.length} purchase records (${pricedPurchases} with a captured price).`;
    lastImport.textContent = summary
      ? `Last import: ${summary.addedTitles} item${summary.addedTitles === 1 ? '' : 's'} added${summary.addedGames ? ` (${summary.addedGames} game${summary.addedGames === 1 ? '' : 's'})` : ''}${summary.datesBackfilled ? ` and ${summary.datesBackfilled} purchase date${summary.datesBackfilled === 1 ? '' : 's'} backfilled` : ''}; ${summary.scannedPurchases} purchase${summary.scannedPurchases === 1 ? '' : 's'} scanned${summary.skippedKnown ? ` and ${summary.skippedKnown} already-scanned purchase${summary.skippedKnown === 1 ? '' : 's'} skipped` : ''} on ${new Date(summary.importedAt).toLocaleString()}.`
      : 'No Humble import has run yet.';
    preview.replaceChildren(...items.slice(0, 50).map((item) => {
      const row = document.createElement('li');
      row.textContent = item.sourceBundle ? `${item.title} — ${item.sourceBundle}` : item.title;
      return row;
    }));
  }

  fileInput.addEventListener('change', async () => {
    const [file] = fileInput.files;
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const rows = Array.isArray(parsed) ? parsed : parsed.items;
      if (!Array.isArray(rows)) throw new Error('Expected a JSON array or an object with an items array.');
      const items = rows.map((row) => typeof row === 'string' ? { title: row } : row)
        .filter((row) => typeof row?.title === 'string' && row.title.trim())
        .map((row) => ({ title: row.title.trim(), sourceBundle: String(row.sourceBundle ?? '').trim() }));
      const unique = new Map(items.map((item) => [HumbleComicLibrary.titleKey(item.title), item]));
      await chrome.storage.local.set({ libraryItems: [...unique.values()] });
      // A manual library replaces Humble-derived entries, so retaining their
      // purchase summaries would be misleading and would break later
      // incremental Humble imports.
      await chrome.storage.local.remove(['purchaseSummaries', 'lastImport']);
      status.textContent = `Imported ${unique.size} unique titles.`;
      await render();
    } catch (error) {
      status.textContent = `Import failed: ${error.message}`;
    } finally {
      fileInput.value = '';
    }
  });

  document.querySelector('#open-purchases').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.humblebundle.com/home/purchases' });
  });

  document.querySelector('#export-library').addEventListener('click', async () => {
    const { purchaseSummaries = [] } = await chrome.storage.local.get({ purchaseSummaries: [] });
    const contents = JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), items: await library(), purchases: purchaseSummaries }, null, 2);
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'humble-comic-library-export.json' });
    link.click();
    URL.revokeObjectURL(url);
  });

  document.querySelector('#clear-library').addEventListener('click', async () => {
    if (!confirm('Clear every locally stored title, purchase record, and import history?')) return;
    await chrome.storage.local.remove(['libraryItems', 'purchaseSummaries', 'lastImport']);
    status.textContent = 'Library and purchase history cleared.';
    await render();
  });
  render();
}());
