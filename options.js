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
  const showDiagnostics = document.querySelector('#show-diagnostics');
  const keyReminderSummary = document.querySelector('#key-reminder-summary');
  const keyReminderList = document.querySelector('#key-reminder-list');
  const humbleExtensionId = document.querySelector('#humble-extension-id');
  const galacticLibraryExtensionId = document.querySelector('#galactic-library-extension-id');
  const galacticLibraryLinkStatus = document.querySelector('#galactic-library-link-status');

  function isExtensionId(value) {
    return /^[a-p]{32}$/u.test(String(value ?? '').trim());
  }

  async function testGalacticLibraryLink(id = galacticLibraryExtensionId.value.trim()) {
    if (!isExtensionId(id)) throw new Error('Enter a valid 32-character Galactic Library extension ID.');
    const response = await chrome.runtime.sendMessage(id, { type: 'PING' });
    if (!response?.ok || response.apiVersion !== 1) throw new Error(response?.error ?? 'Galactic Library did not return a compatible response.');
    return response;
  }

  async function library() {
    return (await chrome.storage.local.get({ libraryItems: [] })).libraryItems;
  }

  async function render() {
    const { lastImport: summary, purchaseSummaries = [], customCollectionMappings = [], showDiagnostics: diagnosticsEnabled = false, keyReminders = [], keyReminderScan = null, galacticLibraryExtensionId: savedGalacticLibraryExtensionId = '' } = await chrome.storage.local.get({ lastImport: null, purchaseSummaries: [], customCollectionMappings: [], showDiagnostics: false, keyReminders: [], keyReminderScan: null, galacticLibraryExtensionId: '' });
    const items = await library();
    const pricedPurchases = purchaseSummaries.filter((purchase) => purchase.pricePaid !== null).length;
    const games = items.filter((item) => item.kind === 'game').length;
    const audiobooks = items.filter((item) => item.kind === 'audiobook').length;
    const mediaCounts = [games ? `${games} game${games === 1 ? '' : 's'}` : '', audiobooks ? `${audiobooks} audiobook${audiobooks === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
    count.textContent = `${items.length} unique item${items.length === 1 ? '' : 's'} stored locally${mediaCounts ? ` (${mediaCounts})` : ''}. ${purchaseSummaries.length} purchase records (${pricedPurchases} with a captured price).`;
    lastImport.textContent = summary
      ? `Last import: ${summary.addedTitles} item${summary.addedTitles === 1 ? '' : 's'} added${summary.addedGames || summary.addedAudiobooks ? ` (${[summary.addedGames ? `${summary.addedGames} game${summary.addedGames === 1 ? '' : 's'}` : '', summary.addedAudiobooks ? `${summary.addedAudiobooks} audiobook${summary.addedAudiobooks === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')})` : ''}${summary.datesBackfilled ? ` and ${summary.datesBackfilled} purchase date${summary.datesBackfilled === 1 ? '' : 's'} backfilled` : ''}; ${summary.scannedPurchases} purchase${summary.scannedPurchases === 1 ? '' : 's'} scanned${summary.skippedKnown ? ` and ${summary.skippedKnown} already-scanned purchase${summary.skippedKnown === 1 ? '' : 's'} skipped` : ''} on ${new Date(summary.importedAt).toLocaleString()}.`
      : 'No Humble import has run yet.';
    preview.replaceChildren(...items.slice(0, 50).map((item) => {
      const row = document.createElement('li');
      row.textContent = item.sourceBundle ? `${item.title} — ${item.sourceBundle}` : item.title;
      return row;
    }));
    mappingCount.textContent = `${HumbleCollectionMappings.builtIn.length} built-in verified collection mapping${HumbleCollectionMappings.builtIn.length === 1 ? '' : 's'} and ${customCollectionMappings.length} custom mapping${customCollectionMappings.length === 1 ? '' : 's'} stored locally.`;
    showDiagnostics.checked = diagnosticsEnabled;
    humbleExtensionId.textContent = chrome.runtime.id;
    galacticLibraryExtensionId.value = isExtensionId(savedGalacticLibraryExtensionId) ? savedGalacticLibraryExtensionId : '';
    galacticLibraryLinkStatus.textContent = galacticLibraryExtensionId.value
      ? 'Link saved. In Galactic Library, allow the Humble Comic Library extension ID shown above.'
      : 'No Galactic Library link configured.';
    renderKeyReminders(keyReminders, keyReminderScan);
  }

  function renderKeyReminders(reminders, scan) {
    if (!scan?.complete) {
      keyReminderSummary.textContent = 'No complete key-reminder scan yet. Open Humble Purchases and select Scan / refresh key reminders.';
      keyReminderList.replaceChildren();
      return;
    }
    const now = Date.now();
    const sorted = [...reminders].sort((left, right) => keyReminderSortValue(left, now) - keyReminderSortValue(right, now) || left.title.localeCompare(right.title));
    const expiringSoon = sorted.filter((record) => {
      const days = keyReminderDaysRemaining(record, now);
      return days !== null && days >= 0 && days <= 30;
    }).length;
    const needsReview = sorted.filter((record) => record.status === 'needs-review').length;
    keyReminderSummary.textContent = `${sorted.length} pending entitlement${sorted.length === 1 ? '' : 's'}${needsReview ? `; ${needsReview} needs review` : ''}${expiringSoon ? `; ${expiringSoon} expiring within 30 days` : ''}. Last checked ${new Date(scan.checkedAt).toLocaleString()}.`;
    keyReminderList.replaceChildren(...sorted.map((record) => {
      const row = document.createElement('li');
      const source = [record.sourceBundle, record.purchasedAt ? `purchased ${new Date(record.purchasedAt).toLocaleDateString()}` : ''].filter(Boolean).join(' — ');
      const detail = [record.keyType, keyReminderExpiryLabel(record, now), record.directRedeem ? 'direct redemption' : '', record.status === 'needs-review' ? 'needs review' : ''].filter(Boolean).join(' · ');
      row.textContent = `${record.title} — ${detail}${source ? ` (${source})` : ''}`;
      return row;
    }));
  }

  function keyReminderDaysRemaining(record, now) {
    if (record.isExpired) return -1;
    const expiry = record.expiresAt ? Date.parse(record.expiresAt) : NaN;
    if (!Number.isNaN(expiry)) return Math.ceil((expiry - now) / 86400000);
    if (!Number.isFinite(record.daysUntilExpiry) || record.daysUntilExpiry < 0) return null;
    const checkedAt = Date.parse(record.checkedAt);
    return Number.isNaN(checkedAt) ? record.daysUntilExpiry : Math.max(-1, Math.ceil(record.daysUntilExpiry - ((now - checkedAt) / 86400000)));
  }

  function keyReminderSortValue(record, now) {
    if (record.isExpired) return Number.MAX_SAFE_INTEGER;
    const days = keyReminderDaysRemaining(record, now);
    if (days === null) return Number.MAX_SAFE_INTEGER - 1;
    return days < 0 ? Number.MAX_SAFE_INTEGER : days;
  }

  function keyReminderExpiryLabel(record, now) {
    if (record.isExpired) return 'expired';
    const days = keyReminderDaysRemaining(record, now);
    if (days === null) return 'no expiry reported';
    if (days < 0) return 'may be expired; refresh to confirm';
    if (days <= 0) return 'expires today';
    return `expires in ${days} day${days === 1 ? '' : 's'}`;
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

  showDiagnostics.addEventListener('change', async () => {
    await chrome.storage.local.set({ showDiagnostics: showDiagnostics.checked });
  });

  document.querySelector('#save-galactic-library-link').addEventListener('click', async () => {
    const id = galacticLibraryExtensionId.value.trim();
    if (!isExtensionId(id)) {
      galacticLibraryLinkStatus.textContent = 'Enter a valid 32-character Galactic Library extension ID.';
      return;
    }
    await chrome.storage.local.set({ galacticLibraryExtensionId: id });
    galacticLibraryLinkStatus.textContent = 'Link saved. In Galactic Library, allow the Humble Comic Library extension ID shown above.';
  });

  document.querySelector('#test-galactic-library-link').addEventListener('click', async () => {
    try {
      const response = await testGalacticLibraryLink();
      galacticLibraryLinkStatus.textContent = `Connected to Galactic Library ${response.appVersion}.`;
    } catch (error) {
      galacticLibraryLinkStatus.textContent = `Could not connect: ${error.message}`;
    }
  });

  document.querySelector('#clear-galactic-library-link').addEventListener('click', async () => {
    await chrome.storage.local.remove('galacticLibraryExtensionId');
    galacticLibraryExtensionId.value = '';
    galacticLibraryLinkStatus.textContent = 'Galactic Library link removed.';
  });

  document.querySelector('#open-purchases').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.humblebundle.com/home/purchases' });
  });

  document.querySelector('#open-key-reminders').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.humblebundle.com/home/purchases' });
  });

  document.querySelector('#export-library').addEventListener('click', async () => {
    const { purchaseSummaries = [], customCollectionMappings = [], keyReminders = [], keyReminderScan = null } = await chrome.storage.local.get({ purchaseSummaries: [], customCollectionMappings: [], keyReminders: [], keyReminderScan: null });
    const contents = JSON.stringify({ version: 4, exportedAt: new Date().toISOString(), items: await library(), purchases: purchaseSummaries, collectionMappings: customCollectionMappings, keyReminders, keyReminderScan }, null, 2);
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'humble-comic-library-export.json' });
    link.click();
    URL.revokeObjectURL(url);
  });

  document.querySelector('#clear-library').addEventListener('click', async () => {
    if (!confirm('Clear every locally stored title, purchase record, key reminder, import history, and custom collection mapping?')) return;
    await chrome.storage.local.remove(['libraryItems', 'purchaseSummaries', 'keyReminders', 'keyReminderScan', 'lastImport', 'customCollectionMappings']);
    status.textContent = 'Library, purchase history, key reminders, and custom mappings cleared.';
    await render();
  });
  render();
}());
