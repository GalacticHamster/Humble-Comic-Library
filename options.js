(function initOptions() {
  'use strict';
  const fileInput = document.querySelector('#import-file');
  const status = document.querySelector('#import-status');
  const count = document.querySelector('#library-count');
  const preview = document.querySelector('#library-preview');
  const lastImport = document.querySelector('#last-import');
  const mappingFileInput = document.querySelector('#collection-mapping-file');
  const mappingStatus = document.querySelector('#collection-mapping-status');
  const mappingCount = document.querySelector('#collection-mapping-count');

  async function library() {
    return (await chrome.storage.local.get({ libraryItems: [] })).libraryItems;
  }

  async function render() {
    const { lastImport: summary, purchaseSummaries = [], customCollectionMappings = [] } = await chrome.storage.local.get({ lastImport: null, purchaseSummaries: [], customCollectionMappings: [] });
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
    mappingCount.textContent = `${HumbleCollectionMappings.builtIn.length} built-in verified collection mapping${HumbleCollectionMappings.builtIn.length === 1 ? '' : 's'} and ${customCollectionMappings.length} custom mapping${customCollectionMappings.length === 1 ? '' : 's'} stored locally.`;
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
      const restoredMappings = parsed?.collectionMappings === undefined
        ? undefined
        : HumbleCollectionMappings.validateCustomMappings(parsed.collectionMappings);
      await chrome.storage.local.set({
        libraryItems: [...unique.values()],
        ...(restoredMappings === undefined ? {} : { customCollectionMappings: restoredMappings })
      });
      // A manual library replaces Humble-derived entries, so retaining their
      // purchase summaries would be misleading and would break later
      // incremental Humble imports.
      await chrome.storage.local.remove(['purchaseSummaries', 'lastImport']);
      status.textContent = `Imported ${unique.size} unique titles.${restoredMappings === undefined ? '' : ` Restored ${restoredMappings.length} custom collection mapping${restoredMappings.length === 1 ? '' : 's'}.`}`;
      await render();
    } catch (error) {
      status.textContent = `Import failed: ${error.message}`;
    } finally {
      fileInput.value = '';
    }
  });

  mappingFileInput.addEventListener('change', async () => {
    const [file] = mappingFileInput.files;
    if (!file) return;
    try {
      const mappings = HumbleCollectionMappings.validateCustomMappings(JSON.parse(await file.text()));
      await chrome.storage.local.set({ customCollectionMappings: mappings });
      mappingStatus.textContent = `Imported ${mappings.length} custom collection mapping${mappings.length === 1 ? '' : 's'}, replacing your previous custom mappings.`;
      await render();
    } catch (error) {
      mappingStatus.textContent = `Mapping import failed: ${error.message}`;
    } finally {
      mappingFileInput.value = '';
    }
  });

  document.querySelector('#open-purchases').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.humblebundle.com/home/purchases' });
  });

  document.querySelector('#export-library').addEventListener('click', async () => {
    const { purchaseSummaries = [], customCollectionMappings = [] } = await chrome.storage.local.get({ purchaseSummaries: [], customCollectionMappings: [] });
    const contents = JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), items: await library(), purchases: purchaseSummaries, collectionMappings: customCollectionMappings }, null, 2);
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'humble-comic-library-export.json' });
    link.click();
    URL.revokeObjectURL(url);
  });

  document.querySelector('#clear-library').addEventListener('click', async () => {
    if (!confirm('Clear every locally stored title, purchase record, import history, and custom collection mapping?')) return;
    await chrome.storage.local.remove(['libraryItems', 'purchaseSummaries', 'lastImport', 'customCollectionMappings']);
    status.textContent = 'Library, purchase history, and custom mappings cleared.';
    await render();
  });
  render();
}());
