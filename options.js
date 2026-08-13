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
    count.textContent = `${items.length} unique title${items.length === 1 ? '' : 's'} stored locally. ${purchaseSummaries.length} purchase records (${pricedPurchases} with a captured price).`;
    lastImport.textContent = summary
      ? `Last import: ${summary.addedTitles} title${summary.addedTitles === 1 ? '' : 's'} added${summary.datesBackfilled ? ` and ${summary.datesBackfilled} purchase date${summary.datesBackfilled === 1 ? '' : 's'} backfilled` : ''}; ${summary.pricedPurchases ?? 0} purchase price${summary.pricedPurchases === 1 ? '' : 's'} captured from ${summary.scannedPurchases} purchases on ${new Date(summary.importedAt).toLocaleString()}.`
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
    if (!confirm('Clear every locally stored library title?')) return;
    await chrome.storage.local.set({ libraryItems: [] });
    status.textContent = 'Library cleared.';
    await render();
  });
  render();
}());
