(function initOptions() {
  'use strict';
  const fileInput = document.querySelector('#import-file');
  const backupFileInput = document.querySelector('#restore-file');
  const restoreStatus = document.querySelector('#restore-status');
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
  const openDirectPurchaseLinks = document.querySelector('#open-direct-purchase-links');
  const humbleExtensionId = document.querySelector('#humble-extension-id');
  const galacticLibraryExtensionId = document.querySelector('#galactic-library-extension-id');
  const galacticLibraryLinkStatus = document.querySelector('#galactic-library-link-status');
  const wishlistStatus = document.querySelector('#wishlist-status');

  async function editWishlist(action,items) {
    try {
      const wishlistItems=await HumbleComicLibrary.storageRequest('wishlist',action,items);
      renderWishlist(wishlistItems);
      wishlistStatus.textContent = `Saved ${wishlistItems.length} wishlist items.`;
    } catch (error) { wishlistStatus.textContent = `Wishlist update failed: ${error.message}`; }
  }

  function renderWishlist(value) {
    const list = document.querySelector('#wishlist-list');
    let items;
    try { items = HumbleComicLibrary.normalizeWishlist(value); }
    catch (error) { list.replaceChildren(); wishlistStatus.textContent = `Could not read wishlist: ${error.message}`; return; }
    list.replaceChildren(...items.map(item => {
      const row = document.createElement('li');
      row.textContent = `${item.title} (${item.kind}) `;
      const priority = document.createElement('input');
      priority.type = 'number'; priority.min = '1'; priority.max = '100'; priority.step = '1'; priority.value = String(item.weight);
      priority.title = `Priority for ${item.title}`;
      priority.addEventListener('change', () => editWishlist('add',[{...item,weight:Number(priority.value)}]));
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove';
      remove.addEventListener('click', () => editWishlist('remove',HumbleComicLibrary.catalogItemKey(item)));
      row.append(priority, ' ', remove); return row;
    }));
  }

  for(const selector of ['#summary-minimized','#summary-position'])document.querySelector(selector).addEventListener('change',async()=>{try{await HumbleComicLibrary.storageSet({bundleSummaryPreferences:{minimized:document.querySelector('#summary-minimized').checked,position:document.querySelector('#summary-position').value}});document.querySelector('#summary-preferences-status').textContent='Panel preferences saved.';}catch(error){document.querySelector('#summary-preferences-status').textContent=error.message;}});
  document.querySelector('#add-wishlist').addEventListener('click', () => editWishlist('add',[{
    title: document.querySelector('#wishlist-title').value,
    kind: document.querySelector('#wishlist-kind').value,
    weight: Number(document.querySelector('#wishlist-weight').value)
  }]));
  document.querySelector('#wishlist-file').addEventListener('change', async () => {
    const input = document.querySelector('#wishlist-file'); const [file] = input.files;
    if (!file) return;
    try {
      const value = JSON.parse(await file.text());
      const wishlistItems = HumbleComicLibrary.normalizeWishlist(Array.isArray(value) ? value : value.wishlist);
      await HumbleComicLibrary.storageRequest('wishlist','replace',wishlistItems); renderWishlist(wishlistItems);
      wishlistStatus.textContent = `Restored ${wishlistItems.length} wishlist items.`;
    } catch (error) { wishlistStatus.textContent = `Wishlist restore failed: ${error.message}`; }
    finally { input.value = ''; }
  });
  document.querySelector('#export-wishlist').addEventListener('click', async () => {
    try {
      const saved = await chrome.storage.local.get({ wishlistItems: [] });
      const wishlist = HumbleComicLibrary.normalizeWishlist(saved.wishlistItems);
      const url = URL.createObjectURL(new Blob([JSON.stringify({ wishlist }, null, 2)], { type: 'application/json' }));
      Object.assign(document.createElement('a'), { href: url, download: 'humble-wishlist.json' }).click(); URL.revokeObjectURL(url);
    } catch (error) { wishlistStatus.textContent = `Wishlist export failed: ${error.message}`; }
  });

  function isExtensionId(value) {
    return HumbleComicLibrary.isExtensionId(value);
  }

  async function testGalacticLibraryLink(id = galacticLibraryExtensionId.value.trim()) {
    if (!isExtensionId(id)) throw new Error('Enter a valid Chrome extension ID or Firefox add-on ID for Galactic Library.');
    const response = await chrome.runtime.sendMessage(id, { type: 'PING' });
    if (!response?.ok || response.apiVersion !== 1) throw new Error(response?.error ?? 'Galactic Library did not return a compatible response.');
    return response;
  }

  async function library() {
    return (await chrome.storage.local.get({ libraryItems: [] })).libraryItems;
  }

  async function render() {
    const { lastImport: summary, purchaseSummaries = [], customCollectionMappings = [], showDiagnostics: diagnosticsEnabled = false, keyReminders = [], keyReminderScan = null, openDirectPurchaseLinks: directPurchaseLinksEnabled = false, galacticLibraryExtensionId: savedGalacticLibraryExtensionId = '' } = await chrome.storage.local.get({ lastImport: null, purchaseSummaries: [], customCollectionMappings: [], showDiagnostics: false, keyReminders: [], keyReminderScan: null, openDirectPurchaseLinks: false, galacticLibraryExtensionId: '' });
    const items = await library();
    renderWishlist((await chrome.storage.local.get({ wishlistItems: [] })).wishlistItems);
    const display=await chrome.storage.local.get({bundleSummaryPreferences:{}}),prefs=HumbleComicLibrary.normalizeSummaryPreferences(display.bundleSummaryPreferences);document.querySelector('#summary-minimized').checked=prefs.minimized;document.querySelector('#summary-position').value=prefs.position;
    const pricedPurchases = purchaseSummaries.filter((purchase) => purchase.pricePaid !== null).length;
    const games = items.filter((item) => item.kind === 'game').length;
    const software = items.filter((item) => item.kind === 'software').length;
    const audiobooks = items.filter((item) => item.kind === 'audiobook').length;
    const mediaCounts = [games ? `${games} game${games === 1 ? '' : 's'}` : '', software ? `${software} software item${software === 1 ? '' : 's'}` : '', audiobooks ? `${audiobooks} audiobook${audiobooks === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
    count.textContent = `${items.length} unique item${items.length === 1 ? '' : 's'} stored locally${mediaCounts ? ` (${mediaCounts})` : ''}. ${purchaseSummaries.length} purchase records (${pricedPurchases} with a captured price).`;
    lastImport.textContent = summary
      ? `Last import: ${summary.addedTitles} item${summary.addedTitles === 1 ? '' : 's'} added${summary.addedGames || summary.addedSoftware || summary.addedAudiobooks ? ` (${[summary.addedGames ? `${summary.addedGames} game${summary.addedGames === 1 ? '' : 's'}` : '', summary.addedSoftware ? `${summary.addedSoftware} software item${summary.addedSoftware === 1 ? '' : 's'}` : '', summary.addedAudiobooks ? `${summary.addedAudiobooks} audiobook${summary.addedAudiobooks === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')})` : ''}${summary.datesBackfilled ? ` and ${summary.datesBackfilled} purchase date${summary.datesBackfilled === 1 ? '' : 's'} backfilled` : ''}; ${summary.scannedPurchases} purchase${summary.scannedPurchases === 1 ? '' : 's'} scanned${summary.skippedKnown ? ` and ${summary.skippedKnown} already-scanned purchase${summary.skippedKnown === 1 ? '' : 's'} skipped` : ''} on ${new Date(summary.importedAt).toLocaleString()}.`
      : 'No Humble import has run yet.';
    if (summary?.fullRescan) {
      lastImport.textContent += summary.reconciled
        ? ' Current Humble snapshot reconciled; historical evidence archived.'
        : ' Scan incomplete; previous entries retained. Repeat a full rescan to reconcile.';
    }
    const history = await chrome.storage.local.get({ historicalLibraryItems: [], historicalPurchaseSummaries: [], humbleProfileLabel:'', profileArchives:[] });
    document.querySelector('#share-hb-profile').textContent=history.humbleProfileLabel||'unassigned';
    document.querySelector('#share-hb-profile').dataset.profileLabel=history.humbleProfileLabel;
    document.querySelector('#confirm-reminder-sharing').checked=false;
    count.textContent += ` Active profile: ${history.humbleProfileLabel||'unassigned'}. ${history.profileArchives.length} other profile archives (backup only; excluded from matching). History archive: ${history.historicalLibraryItems.length} titles and ${history.historicalPurchaseSummaries.length} purchase observations (excluded from matching).`;
    preview.replaceChildren(...items.slice(0, 50).map((item) => {
      const row = document.createElement('li');
      row.textContent = item.sourceBundle ? `${item.title} — ${item.sourceBundle}` : item.title;
      return row;
    }));
    mappingCount.textContent = `${HumbleCollectionMappings.builtIn.length} built-in verified collection mapping${HumbleCollectionMappings.builtIn.length === 1 ? '' : 's'} and ${customCollectionMappings.length} custom mapping${customCollectionMappings.length === 1 ? '' : 's'} stored locally.`;
    showDiagnostics.checked = diagnosticsEnabled;
    openDirectPurchaseLinks.checked = directPurchaseLinksEnabled;
    humbleExtensionId.textContent = chrome.runtime.id;
    galacticLibraryExtensionId.value = isExtensionId(savedGalacticLibraryExtensionId) ? savedGalacticLibraryExtensionId : '';
    galacticLibraryLinkStatus.textContent = galacticLibraryExtensionId.value
      ? 'Link saved. In Galactic Library, allow the Humble Comic Library extension ID shown above.'
      : 'No Galactic Library link configured.';
    renderKeyReminders(keyReminders, keyReminderScan);
  }

  function renderKeyReminders(reminders, scan) {
    if (!scan) {
      keyReminderSummary.textContent = 'No key-reminder scan yet. Open Humble Purchases and select Rescan every purchase to establish complete reminders.';
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
    const baseline = scan.complete
      ? ''
      : ' Older purchases have not been checked yet; use Rescan every purchase to establish complete reminders.';
    keyReminderSummary.textContent = `${sorted.length} pending entitlement${sorted.length === 1 ? '' : 's'}${needsReview ? `; ${needsReview} needs review` : ''}${expiringSoon ? `; ${expiringSoon} expiring within 30 days` : ''}. Last checked ${new Date(scan.checkedAt).toLocaleString()}.${baseline}`;
    const groups = [
      ['Expiring or dated', sorted.filter((record) => {
        const days = keyReminderDaysRemaining(record, now);
        return !record.isExpired && days !== null && days >= 0;
      })],
      ['No expiry reported', sorted.filter((record) => !record.isExpired && keyReminderDaysRemaining(record, now) === null)],
      ['Expired or may be expired', sorted.filter((record) => record.isExpired || keyReminderDaysRemaining(record, now) < 0)]
    ];
    const rows = [];
    for (const [label, records] of groups) {
      if (!records.length) continue;
      const heading = document.createElement('li');
      heading.className = 'key-reminder-group';
      heading.textContent = label;
      rows.push(heading, ...records.map((record) => keyReminderRow(record, now)));
    }
    keyReminderList.replaceChildren(...rows);
  }

  function keyReminderRow(record, now) {
    const row = document.createElement('li');
    const days = keyReminderDaysRemaining(record, now);
    const state = record.isExpired || days < 0 ? 'expired' : days !== null && days <= 30 ? 'soon' : 'normal';
    row.className = 'key-reminder-card';
    row.dataset.keyReminderState = state;

    const heading = document.createElement('div');
    heading.className = 'key-reminder-heading';
    const title = document.createElement('span');
    title.textContent = record.title;
    const expiry = document.createElement('span');
    expiry.className = 'key-reminder-status';
    expiry.textContent = keyReminderExpiryLabel(record, now);
    heading.append(title, expiry);

    const detail = document.createElement('div');
    detail.className = 'key-reminder-meta';
    detail.textContent = [record.keyType, record.directRedeem ? 'direct redemption' : '', record.status === 'needs-review' ? 'needs review' : ''].filter(Boolean).join(' · ');

    const source = document.createElement('div');
    source.className = 'key-reminder-source';
    source.textContent = [record.sourceBundle || 'Humble purchase', record.purchasedAt ? `purchased ${new Date(record.purchasedAt).toLocaleDateString()}` : ''].filter(Boolean).join(' — ');

    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Open purchase';
    open.addEventListener('click', async () => {
      open.disabled = true;
      try {
        const { openDirectPurchaseLinks: directPurchaseLinksEnabled = false } = await chrome.storage.local.get({ openDirectPurchaseLinks: false });
        if (directPurchaseLinksEnabled) {
          await chrome.tabs.create({ url: directHumblePurchaseUrl(record.purchaseKey) });
        } else {
          await HumbleComicLibrary.storageSet({
            hclPurchaseFocus: {
              purchaseKey: record.purchaseKey,
              sourceBundle: record.sourceBundle ?? '',
              purchasedAt: record.purchasedAt ?? '',
              requestedAt: Date.now()
            }
          });
          await chrome.tabs.create({ url: 'https://www.humblebundle.com/home/purchases' });
        }
      } finally {
        open.disabled = false;
      }
    });
    row.append(heading, detail, source, open);
    return row;
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

  function directHumblePurchaseUrl(purchaseKey) {
    return 'https://www.humblebundle.com/downloads?key=' + encodeURIComponent(purchaseKey);
  }

  fileInput.addEventListener('change', async () => {
    const [file] = fileInput.files;
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const replacement = HumbleComicLibrary.manualTitleImportState(parsed);
      if (!confirm('Replace your library with this manual title list? This clears purchase records, provenance, reminders, scan history, the history archive, and custom mappings.')) return;
      await HumbleComicLibrary.storageSet(replacement);
      status.textContent = `Imported ${replacement.libraryItems.length} unique titles. Previous purchase data, reminders, scan history, and custom mappings cleared.`;
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
      await HumbleComicLibrary.storageSet({ customCollectionMappings: mappings });
      mappingStatus.textContent = `Imported ${mappings.length} custom collection mapping${mappings.length === 1 ? '' : 's'}, replacing your previous custom mappings.`;
      await render();
    } catch (error) {
      mappingStatus.textContent = `Mapping import failed: ${error.message}`;
    } finally {
      mappingFileInput.value = '';
    }
  });

  showDiagnostics.addEventListener('change', async () => {
    await HumbleComicLibrary.storageSet({ showDiagnostics: showDiagnostics.checked });
  });

  backupFileInput.addEventListener('change', async () => {
    const [file] = backupFileInput.files;
    if (!file) return;
    try {
      const replacement = HumbleComicLibrary.restoreBackupState(JSON.parse(await file.text()));
      if (!confirm('Restore this backup and replace all current library items, purchases, reminders, scan history, the history archive, and custom mappings?')) return;
      await HumbleComicLibrary.storageSet({ ...replacement, hclPurchaseFocus: null });
      restoreStatus.textContent = `Restored ${replacement.libraryItems.length} items, ${replacement.purchaseSummaries.length} purchases, and ${replacement.keyReminders.length} reminders. Previous library data replaced.`;
      await render();
    } catch (error) {
      restoreStatus.textContent = `Restore failed: ${error.message}`;
    } finally {
      backupFileInput.value = '';
    }
  });

  openDirectPurchaseLinks.addEventListener('change', async () => {
    await HumbleComicLibrary.storageSet({ openDirectPurchaseLinks: openDirectPurchaseLinks.checked });
  });

  for(const [id,type]of [['share-entitlements','HCL_SHARE_ENTITLEMENTS'],['remove-shared-entitlements','HCL_REMOVE_SHARED_ENTITLEMENTS']])document.querySelector('#'+id).addEventListener('click',async()=>{
    const status=document.querySelector('#entitlement-share-status'),button=document.querySelector('#'+id);if(!document.querySelector('#confirm-reminder-sharing').checked){status.textContent='Confirm the same Humble account before sending or removing reminders.';return;}
    button.disabled=true;try{const response=await chrome.runtime.sendMessage({type,confirmed:true,profileLabel:document.querySelector('#share-hb-profile').dataset.profileLabel,targetProfileLabel:document.querySelector('#share-gl-profile').value});if(!response?.ok)throw new Error(response?.error??'Reminder sharing unavailable.');status.textContent=type==='HCL_SHARE_ENTITLEMENTS'?`Shared ${response.count} entitlements (${response.coverage} baseline). Ownership and activation were not changed.`:'Shared reminders removed from Galactic Library.';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}
  });
  document.querySelector('#save-galactic-library-link').addEventListener('click', async () => {
    const id = galacticLibraryExtensionId.value.trim();
    if (!isExtensionId(id)) {
      galacticLibraryLinkStatus.textContent = 'Enter a valid Chrome extension ID or Firefox add-on ID for Galactic Library.';
      return;
    }
    await HumbleComicLibrary.storageSet({ galacticLibraryExtensionId: id });
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
    await HumbleComicLibrary.storageRemove('galacticLibraryExtensionId');
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
    const saved = await chrome.storage.local.get(HumbleComicLibrary.LIBRARY_STATE_DEFAULTS);
    const contents = JSON.stringify(HumbleComicLibrary.createLibraryBackup(saved), null, 2);
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'humble-comic-library-export.json' });
    link.click();
    URL.revokeObjectURL(url);
  });

  document.querySelector('#clear-library').addEventListener('click', async () => {
    if (!confirm('Clear every locally stored title, purchase record, key reminder, import history, historical purchase archive, and custom collection mapping? Your wishlist, display preferences and Galactic Library link will be kept.')) return;
    await HumbleComicLibrary.storageRemove([...Object.keys(HumbleComicLibrary.LIBRARY_STATE_DEFAULTS), 'hclPurchaseFocus']);
    status.textContent = 'Library, purchase history, key reminders, and custom mappings cleared.';
    await render();
  });
  render();
}());
