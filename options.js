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
  const librarySearch = document.querySelector('#library-search');
  const libraryFilterMedia = document.querySelector('#library-filter-media');
  const libraryFilterMetadata = document.querySelector('#library-filter-metadata');
  const librarySort = document.querySelector('#library-sort');
  const libraryPageSize = document.querySelector('#library-page-size');
  const libraryPrevious = document.querySelector('#library-previous');
  const libraryNext = document.querySelector('#library-next');

  async function editWishlist(action,items) {
    try {
      const wishlistItems=await HumbleComicLibrary.storageRequest('wishlist',action,items);
      renderWishlist(wishlistItems);
      wishlistStatus.textContent = `Saved ${wishlistItems.length} wishlist items. Ownership was not changed.`;
      return true;
    } catch (error) { wishlistStatus.textContent = `Wishlist update failed: ${error.message}`; renderWishlist(); return false; }
  }

  let wishlist = [], wishlistPage = 0;
  function renderWishlist(value = wishlist) {
    const list = document.querySelector('#wishlist-list');
    let items;
    try { items = HumbleComicLibrary.normalizeWishlist(value); }
    catch (error) { list.replaceChildren(); wishlistStatus.textContent = `Could not read wishlist: ${error.message}`; return; }
    wishlist = items;
    const filtered = items.filter(item => item.title.toLowerCase().includes(document.querySelector('#wishlist-search').value.toLowerCase())).sort((a,b) => b.weight-a.weight || globalThis.LibraryTitleSort.compare(a.title,b.title));
    const pages = Math.max(1, Math.ceil(filtered.length/50));
    wishlistPage = Math.max(0, Math.min(wishlistPage, pages-1));
    document.querySelector('#wishlist-count').textContent = `${filtered.length} wishes; page ${wishlistPage+1} of ${pages}.`;
    document.querySelector('#wishlist-previous').disabled = wishlistPage === 0;
    document.querySelector('#wishlist-next').disabled = (wishlistPage+1)*50 >= filtered.length;
    list.replaceChildren(...filtered.slice(wishlistPage*50,wishlistPage*50+50).map(item => {
      const row = document.createElement('li');
      const title=document.createElement('span');title.className='wish-title';title.textContent=`${item.title} (${item.kind})`;row.append(title);
      const priority = document.createElement('input');
      priority.type = 'number'; priority.min = '1'; priority.max = '100'; priority.step = '1'; priority.value = String(item.weight);
      priority.title = `Priority for ${item.title}`; priority.setAttribute("aria-label",priority.title);
      priority.addEventListener('change', () => editWishlist('add',[{...item,weight:Number(priority.value)}]));
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove';
      remove.addEventListener('click', () => editWishlist('remove',HumbleComicLibrary.catalogItemKey(item)));
      row.append(priority, ' ', remove); return row;
    }));
  }

  for(const selector of ['#summary-minimized','#summary-position'])document.querySelector(selector).addEventListener('change',async()=>{try{await HumbleComicLibrary.storageSet({bundleSummaryPreferences:{minimized:document.querySelector('#summary-minimized').checked,position:document.querySelector('#summary-position').value}});document.querySelector('#summary-preferences-status').textContent='Panel preferences saved.';}catch(error){document.querySelector('#summary-preferences-status').textContent=error.message;}});
  document.querySelector('#add-wishlist').addEventListener('click', async () => {const saved=await editWishlist('add',[{
    title: document.querySelector('#wishlist-title').value,
    kind: document.querySelector('#wishlist-kind').value,
    weight: Number(document.querySelector('#wishlist-weight').value)
  }]); if(saved)document.querySelector('#wishlist-title').value='';});
  document.querySelector('#wishlist-file').addEventListener('change', async () => {
    const input = document.querySelector('#wishlist-file'); const [file] = input.files;
    if (!file) return;
    try {
      if(file.size > 50*1024*1024) throw new Error("Choose a wishlist smaller than 50 MB.");
      const value = JSON.parse(await file.text());
      const wishlistItems = HumbleComicLibrary.normalizeWishlist(Array.isArray(value) ? value : value.wishlist);
      if(!confirm(`Replace your wishlist with ${wishlistItems.length} items? Ownership will not change.`)) { wishlistStatus.textContent='Wishlist restore cancelled.'; return; }
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

  document.querySelector('#clear-wishlist').addEventListener('click',()=>{if(confirm('Clear your local wishlist? Ownership will not change.'))editWishlist('replace',[]);});
  document.querySelector('#wishlist-search').addEventListener('input',()=>{wishlistPage=0;renderWishlist();});
  document.querySelector('#wishlist-previous').addEventListener('click',()=>{wishlistPage--;renderWishlist();});
  document.querySelector('#wishlist-next').addEventListener('click',()=>{wishlistPage++;renderWishlist();});

  function isExtensionId(value) {
    return HumbleComicLibrary.isExtensionId(value);
  }

  async function testGalacticLibraryLink(id = HumbleComicLibrary.resolveGalacticId(galacticLibraryExtensionId.value,chrome.runtime)) {
    if (!isExtensionId(id)) throw new Error('Enter a valid Chrome extension ID or Firefox add-on ID for Galactic Library.');
    const problem=HumbleComicLibrary.companionTargetProblem(id,chrome.runtime);if(problem)throw Error(problem);
    const response=await HumbleComicLibrary.testGalacticLink(message=>chrome.runtime.sendMessage(id,message));return response;
  }

  const STORAGE_KEY = 'hb_library_browser_state';
  const defaultLibraryState = {
    search: '',
    media: '',
    metadata: '',
    sort: 'title-asc',
    pageSize: 50,
    page: 0
  };

  function loadLibraryState() {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (raw) return { ...defaultLibraryState, ...JSON.parse(raw) };
      }
    } catch {}
    return { ...defaultLibraryState };
  }

  function saveLibraryState(state) {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    } catch {}
  }

  const libraryBrowserState = loadLibraryState();

  function getItemPurchaseDate(item) {
    if (!item || typeof item !== 'object') return null;
    let latest = null;
    const directRaw = item.purchasedAt || item.purchaseDate;
    if (directRaw) {
      const time = Date.parse(directRaw);
      if (Number.isFinite(time)) latest = time;
    }
    const list = Array.isArray(item.provenance) ? item.provenance : (Array.isArray(item.purchaseOrigins) ? item.purchaseOrigins : []);
    for (const rec of list) {
      const raw = rec?.purchasedAt || rec?.purchaseDate;
      if (raw) {
        const time = Date.parse(raw);
        if (Number.isFinite(time) && (latest === null || time > latest)) {
          latest = time;
        }
      }
    }
    return latest;
  }

  function formatPurchaseDate(timestamp) {
    if (!timestamp) return '';
    try {
      return new Date(timestamp).toISOString().slice(0, 10);
    } catch {
      return '';
    }
  }

  function itemsMatchExactly(a, b) {
    if (a === b) return true;
    const titleA = (typeof a === 'string' ? a : (a?.title || '')).trim().toLowerCase();
    const titleB = (typeof b === 'string' ? b : (b?.title || '')).trim().toLowerCase();
    if (!titleA || titleA !== titleB) return false;

    const kindA = (typeof a === 'string' ? 'book' : (a?.kind || a?.mediaType || 'book')).toLowerCase();
    const kindB = (typeof b === 'string' ? 'book' : (b?.kind || b?.mediaType || 'book')).toLowerCase();
    if (kindA !== kindB) return false;

    if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
      const idA = (a.providerItemId || '').trim();
      const idB = (b.providerItemId || '').trim();
      if (idA && idB && idA !== idB) return false;

      const edA = (a.edition || a.editionId || '').trim().toLowerCase();
      const edB = (b.edition || b.editionId || '').trim().toLowerCase();
      if (edA !== edB) return false;

      const volA = (a.volume || '').trim().toLowerCase();
      const volB = (b.volume || '').trim().toLowerCase();
      if (volA !== volB) return false;

      const issA = (a.issue || '').trim().toLowerCase();
      const issB = (b.issue || '').trim().toLowerCase();
      if (issA !== issB) return false;

      const isbnA = Array.isArray(a.isbn) ? a.isbn.join(',').toLowerCase() : (a.isbn || '').trim().toLowerCase();
      const isbnB = Array.isArray(b.isbn) ? b.isbn.join(',').toLowerCase() : (b.isbn || '').trim().toLowerCase();
      if (isbnA && isbnB && isbnA !== isbnB) return false;
    }

    return true;
  }

  function parseRecordTimestamp(record) {
    if (!record || typeof record !== 'object') return null;
    const raw = record.purchasedAt || record.purchaseDate;
    if (!raw) return null;
    const time = Date.parse(raw);
    return Number.isFinite(time) ? time : null;
  }

  function sortProvenanceRecords(records) {
    return [...records].sort((a, b) => {
      const timeA = parseRecordTimestamp(a);
      const timeB = parseRecordTimestamp(b);
      if (timeA !== null && timeB !== null) {
        if (timeB !== timeA) return timeB - timeA;
        const bundleA = (a.sourceBundle || a.bundle?.title || '').trim();
        const bundleB = (b.sourceBundle || b.bundle?.title || '').trim();
        return bundleA.localeCompare(bundleB);
      }
      if (timeA !== null) return -1;
      if (timeB !== null) return 1;
      const bundleA = (a.sourceBundle || a.bundle?.title || '').trim();
      const bundleB = (b.sourceBundle || b.bundle?.title || '').trim();
      return bundleA.localeCompare(bundleB);
    });
  }

  function extractItemProvenance(item) {
    if (!item || typeof item !== 'object') return [];
    if (Array.isArray(item.provenance) && item.provenance.length > 0) {
      return sortProvenanceRecords(item.provenance.map((p) => ({
        title: p?.title || item.title || '',
        sourceBundle: p?.sourceBundle || item.sourceBundle || (item.bundle?.title || ''),
        purchaseKey: p?.purchaseKey || item.purchaseKey || '',
        purchasedAt: p?.purchasedAt || item.purchasedAt || null,
        providerItemId: p?.providerItemId || item.providerItemId || '',
        entitlement: p?.entitlement || item.entitlement || '',
        entitlementId: p?.entitlementId || item.entitlementId || '',
        keyType: p?.keyType || item.keyType || '',
        keyStatus: p?.keyStatus || item.keyStatus || '',
        expiresAt: p?.expiresAt || item.expiresAt || null
      })));
    }
    const sourceBundle = item.sourceBundle || (item.bundle?.title || '');
    const purchaseKey = item.purchaseKey || '';
    const purchasedAt = item.purchasedAt || null;
    if (sourceBundle || purchaseKey || purchasedAt || item.entitlement || item.keyType || item.keyStatus) {
      return [{
        title: item.title || '',
        sourceBundle,
        purchaseKey,
        purchasedAt,
        providerItemId: item.providerItemId || '',
        entitlement: item.entitlement || '',
        entitlementId: item.entitlementId || '',
        keyType: item.keyType || '',
        keyStatus: item.keyStatus || '',
        expiresAt: item.expiresAt || null
      }];
    }
    return [];
  }

  function mergeProvenanceRecords(existingList, incomingList) {
    const merged = new Map();
    function recordKey(rec) {
      if (rec.purchaseKey) {
        return `key:${rec.purchaseKey}:${rec.entitlementId || rec.providerItemId || ''}`;
      }
      return `bundle:${(rec.sourceBundle || '').toLowerCase()}:${rec.purchasedAt || ''}:${rec.keyStatus || ''}`;
    }
    for (const rec of [...existingList, ...incomingList]) {
      const key = recordKey(rec);
      if (!merged.has(key)) {
        merged.set(key, rec);
      } else {
        const prev = merged.get(key);
        merged.set(key, {
          ...prev,
          ...rec,
          sourceBundle: prev.sourceBundle || rec.sourceBundle,
          purchaseKey: prev.purchaseKey || rec.purchaseKey,
          purchasedAt: prev.purchasedAt || rec.purchasedAt,
          keyStatus: rec.keyStatus || prev.keyStatus,
          expiresAt: rec.expiresAt || prev.expiresAt
        });
      }
    }
    return sortProvenanceRecords([...merged.values()]);
  }

  function consolidateItemInto(target, incoming) {
    const targetObj = typeof target === 'string' ? { title: target, kind: 'book' } : { ...target };
    const incomingObj = typeof incoming === 'string' ? { title: incoming, kind: 'book' } : incoming;

    const targetProv = extractItemProvenance(targetObj);
    const incomingProv = extractItemProvenance(incomingObj);
    const allProv = mergeProvenanceRecords(targetProv, incomingProv);

    const latestProv = allProv[0];
    const targetDate = getItemPurchaseDate(targetObj);
    const incomingDate = getItemPurchaseDate(incomingObj);
    const useIncomingDate = incomingDate !== null && (targetDate === null || incomingDate > targetDate);

    return {
      ...targetObj,
      ...(useIncomingDate ? incomingObj : {}),
      providerItemId: targetObj.providerItemId || incomingObj.providerItemId,
      sourceBundle: latestProv?.sourceBundle || targetObj.sourceBundle || incomingObj.sourceBundle || '',
      purchasedAt: latestProv?.purchasedAt || (useIncomingDate ? incomingObj.purchasedAt : targetObj.purchasedAt) || null,
      purchaseKey: latestProv?.purchaseKey || targetObj.purchaseKey || incomingObj.purchaseKey || '',
      entitlement: latestProv?.entitlement || targetObj.entitlement || incomingObj.entitlement,
      keyType: latestProv?.keyType || targetObj.keyType || incomingObj.keyType,
      keyStatus: latestProv?.keyStatus || targetObj.keyStatus || incomingObj.keyStatus,
      expiresAt: latestProv?.expiresAt || targetObj.expiresAt || incomingObj.expiresAt,
      provenance: allProv
    };
  }

  function consolidateLibrary(items) {
    if (!Array.isArray(items)) return [];
    const buckets = new Map();
    for (const item of items) {
      const title = (typeof item === 'string' ? item : (item?.title || '')).trim().toLowerCase();
      const kind = (typeof item === 'string' ? 'book' : (item?.kind || item?.mediaType || 'book')).toLowerCase();
      const bucketKey = `${kind}:::${title}`;
      let group = buckets.get(bucketKey);
      if (!group) {
        group = [];
        buckets.set(bucketKey, group);
      }
      const existingIndex = group.findIndex((candidate) => itemsMatchExactly(candidate, item));
      if (existingIndex >= 0) {
        group[existingIndex] = consolidateItemInto(group[existingIndex], item);
      } else {
        const itemObj = typeof item === 'string' ? { title: item, kind } : { ...item };
        const prov = extractItemProvenance(itemObj);
        group.push({ ...itemObj, provenance: prov });
      }
    }
    const consolidated = [];
    for (const group of buckets.values()) {
      consolidated.push(...group);
    }
    return consolidated;
  }

  function filterAndSortLibrary(items, { search = '', media = '', metadata = '', sort = 'title-asc' } = {}) {
    const collator = globalThis.LibraryTitleSort || new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    let result = Array.isArray(items) ? consolidateLibrary(items) : [];

    const query = String(search || '').trim().toLowerCase();
    if (query) {
      result = result.filter((item) => {
        const title = (typeof item === 'string' ? item : (item.title || '')).toLowerCase();
        return title.includes(query);
      });
    }

    if (media) {
      const targetMedia = media.toLowerCase();
      result = result.filter((item) => {
        const kind = typeof item === 'string' ? 'book' : (item.kind || item.mediaType || 'book');
        return kind.toLowerCase() === targetMedia;
      });
    }

    if (metadata) {
      result = result.filter((item) => {
        if (metadata === 'dated') return getItemPurchaseDate(item) !== null;
        if (metadata === 'bundle') return Boolean(typeof item === 'object' && (item.sourceBundle || item.bundle?.title));
        if (metadata === 'humble') return typeof item === 'object' && (item.source === 'humble' || Boolean(item.purchaseKey) || Boolean(item.provenance?.length));
        if (metadata === 'manual') return typeof item === 'string' || !(item.source === 'humble' || Boolean(item.purchaseKey) || Boolean(item.provenance?.length));
        if (metadata === 'key') return typeof item === 'object' && (item.entitlement === 'third-party-key' || item.provenance?.some((p) => p.entitlement === 'third-party-key') || Boolean(item.keyType) || (Array.isArray(item.keys) && item.keys.length > 0));
        if (metadata === 'download') return typeof item === 'object' && (item.entitlement === 'direct-download' || item.provenance?.some((p) => p.entitlement === 'direct-download') || (Array.isArray(item.downloads) && item.downloads.length > 0) || (Array.isArray(item.downloadPlatforms) && item.downloadPlatforms.length > 0) || Boolean(item.downloadUrl));
        return true;
      });
    }

    result.sort((a, b) => {
      const titleA = typeof a === 'string' ? a : (a.title || '');
      const titleB = typeof b === 'string' ? b : (b.title || '');

      if (sort === 'title-desc') {
        return collator.compare(titleB, titleA);
      }
      if (sort === 'date-desc') {
        const dateA = getItemPurchaseDate(a);
        const dateB = getItemPurchaseDate(b);
        if (dateA !== null && dateB !== null) {
          if (dateB !== dateA) return dateB - dateA;
          return collator.compare(titleA, titleB);
        }
        if (dateA !== null) return -1;
        if (dateB !== null) return 1;
        return collator.compare(titleA, titleB);
      }
      if (sort === 'date-asc') {
        const dateA = getItemPurchaseDate(a);
        const dateB = getItemPurchaseDate(b);
        if (dateA !== null && dateB !== null) {
          if (dateA !== dateB) return dateA - dateB;
          return collator.compare(titleA, titleB);
        }
        if (dateA !== null) return -1;
        if (dateB !== null) return 1;
        return collator.compare(titleA, titleB);
      }
      return collator.compare(titleA, titleB);
    });

    return result;
  }

  function renderLibraryRow(item) {
    const row = document.createElement('li');
    row.className = 'library-item';

    const title = typeof item === 'string' ? item : (item.title || '');
    const records = sortProvenanceRecords(extractItemProvenance(item));

    const distinctBundles = new Set();
    for (const rec of records) {
      const bTitle = (rec.sourceBundle || rec.bundle?.title || '').trim();
      if (bTitle) distinctBundles.add(bTitle);
    }

    let summarySuffix = '';
    if (distinctBundles.size === 1) {
      summarySuffix = ' — in 1 bundle';
    } else if (distinctBundles.size > 1) {
      summarySuffix = ` — in ${distinctBundles.size} bundles`;
    } else if (records.length === 1) {
      summarySuffix = ' — single purchase';
    } else if (records.length > 1) {
      summarySuffix = ` — ${records.length} purchases`;
    } else {
      summarySuffix = ' — manual entry';
    }

    const headerText = `${title}${summarySuffix}`;

    const details = document.createElement('details');
    details.className = 'library-item-details';

    const summary = document.createElement('summary');
    summary.className = 'library-item-summary';
    summary.textContent = headerText;
    details.append(summary);

    if (records.length > 0) {
      const list = document.createElement('ul');
      list.className = 'library-provenance-list';
      for (const rec of records) {
        const li = document.createElement('li');
        const parts = [];
        if (rec.sourceBundle) parts.push(`Bundle: ${rec.sourceBundle}`);
        const pDate = formatPurchaseDate(rec.purchasedAt);
        if (pDate) parts.push(`Purchased: ${pDate}`);
        if (rec.purchaseKey) parts.push(`Order: ${rec.purchaseKey}`);
        if (rec.entitlement === 'third-party-key' || rec.keyType) {
          const status = rec.keyStatus ? ` (${rec.keyStatus})` : '';
          parts.push(`Key: ${rec.keyType || 'Key'}${status}`);
          if (rec.expiresAt) {
            const exp = formatPurchaseDate(rec.expiresAt);
            if (exp) parts.push(`Expires: ${exp}`);
          }
        } else if (rec.entitlement === 'direct-download') {
          parts.push('Direct download');
        }
        li.textContent = parts.join(' · ') || 'Purchase record stored without bundle details';
        list.append(li);
      }
      details.append(list);
    } else {
      const empty = document.createElement('p');
      empty.className = 'library-provenance-empty';
      empty.textContent = 'No bundle or purchase record stored.';
      details.append(empty);
    }

    row.append(details);

    try {
      Object.defineProperty(row, 'textContent', {
        get() { return summary.textContent; },
        set(val) { summary.textContent = val; },
        configurable: true
      });
    } catch {
      row.textContent = headerText;
    }

    return row;
  }

  let latestLibraryItems = [];

  function renderLibraryBrowser(items = latestLibraryItems) {
    latestLibraryItems = Array.isArray(items) ? items : [];
    if (!preview) return;

    if (librarySearch && librarySearch.value !== libraryBrowserState.search) librarySearch.value = libraryBrowserState.search;
    if (libraryFilterMedia && libraryFilterMedia.value !== libraryBrowserState.media) libraryFilterMedia.value = libraryBrowserState.media;
    if (libraryFilterMetadata && libraryFilterMetadata.value !== libraryBrowserState.metadata) libraryFilterMetadata.value = libraryBrowserState.metadata;
    if (librarySort && librarySort.value !== libraryBrowserState.sort) librarySort.value = libraryBrowserState.sort;
    if (libraryPageSize && Number(libraryPageSize.value) !== libraryBrowserState.pageSize) libraryPageSize.value = String(libraryBrowserState.pageSize);

    const uniqueItems = consolidateLibrary(latestLibraryItems);
    const processed = filterAndSortLibrary(uniqueItems, {
      search: libraryBrowserState.search,
      media: libraryBrowserState.media,
      metadata: libraryBrowserState.metadata,
      sort: libraryBrowserState.sort
    });

    const pageSize = libraryBrowserState.pageSize || 50;
    const totalPages = Math.max(1, Math.ceil(processed.length / pageSize));
    libraryBrowserState.page = Math.max(0, Math.min(libraryBrowserState.page, totalPages - 1));
    saveLibraryState(libraryBrowserState);

    const start = libraryBrowserState.page * pageSize;
    const pageItems = processed.slice(start, start + pageSize);

    preview.start = start + 1;
    preview.replaceChildren(...pageItems.map(renderLibraryRow));

    if (libraryPrevious) libraryPrevious.disabled = libraryBrowserState.page === 0;
    if (libraryNext) libraryNext.disabled = (libraryBrowserState.page + 1) * pageSize >= processed.length;

    const note = document.querySelector('#preview-note');
    if (note) {
      if (!latestLibraryItems.length) {
        note.textContent = 'Your library is empty. Import purchases or restore a backup to see a preview.';
      } else if (!processed.length) {
        note.textContent = `No items match your search or filter criteria (0 of ${uniqueItems.length} items).`;
      } else {
        const pageInfo = totalPages > 1 ? ` (page ${libraryBrowserState.page + 1} of ${totalPages})` : '';
        const filterInfo = processed.length !== uniqueItems.length ? ` (filtered from ${uniqueItems.length})` : '';
        const sortLabel = libraryBrowserState.sort === 'date-desc' ? 'by purchase date (newest)'
          : libraryBrowserState.sort === 'date-asc' ? 'by purchase date (oldest)'
          : libraryBrowserState.sort === 'title-desc' ? 'reverse alphabetically'
          : 'alphabetically';
        note.textContent = `Showing ${pageItems.length} of ${processed.length} items${filterInfo}${pageInfo}, ${sortLabel}.`;
      }
    }
  }

  librarySearch?.addEventListener('input', () => {
    libraryBrowserState.page = 0;
    libraryBrowserState.search = librarySearch.value;
    saveLibraryState(libraryBrowserState);
    renderLibraryBrowser();
  });
  libraryFilterMedia?.addEventListener('change', () => {
    libraryBrowserState.page = 0;
    libraryBrowserState.media = libraryFilterMedia.value;
    saveLibraryState(libraryBrowserState);
    renderLibraryBrowser();
  });
  libraryFilterMetadata?.addEventListener('change', () => {
    libraryBrowserState.page = 0;
    libraryBrowserState.metadata = libraryFilterMetadata.value;
    saveLibraryState(libraryBrowserState);
    renderLibraryBrowser();
  });
  librarySort?.addEventListener('change', () => {
    libraryBrowserState.page = 0;
    libraryBrowserState.sort = librarySort.value;
    saveLibraryState(libraryBrowserState);
    renderLibraryBrowser();
  });
  libraryPageSize?.addEventListener('change', () => {
    libraryBrowserState.page = 0;
    libraryBrowserState.pageSize = Number(libraryPageSize.value) || 50;
    saveLibraryState(libraryBrowserState);
    renderLibraryBrowser();
  });
  libraryPrevious?.addEventListener('click', () => {
    libraryBrowserState.page--;
    saveLibraryState(libraryBrowserState);
    renderLibraryBrowser();
  });
  libraryNext?.addEventListener('click', () => {
    libraryBrowserState.page++;
    saveLibraryState(libraryBrowserState);
    renderLibraryBrowser();
  });

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
    document.querySelector('#share-hb-profile').textContent=history.humbleProfileLabel||'Not yet named';
    document.querySelector('#share-hb-profile').dataset.profileLabel=history.humbleProfileLabel;
    document.querySelector('#confirm-reminder-sharing').checked=false;
    count.textContent += ` Active account nickname: ${history.humbleProfileLabel||'Not yet named'}. ${history.profileArchives.length} other saved accounts (selectable above; excluded from active matching). History archive: ${history.historicalLibraryItems.length} titles and ${history.historicalPurchaseSummaries.length} purchase observations (current-account titles may appear as Check ownership; never Owned).`;
    renderLibraryBrowser(items);
    mappingCount.textContent = `${HumbleCollectionMappings.builtIn.length} built-in verified collection mapping${HumbleCollectionMappings.builtIn.length === 1 ? '' : 's'} and ${customCollectionMappings.length} custom mapping${customCollectionMappings.length === 1 ? '' : 's'} stored locally.`;
    showDiagnostics.checked = diagnosticsEnabled;
    openDirectPurchaseLinks.checked = directPurchaseLinksEnabled;
    humbleExtensionId.textContent = chrome.runtime.id;
    galacticLibraryExtensionId.value = savedGalacticLibraryExtensionId;
    document.querySelector('#builtin-galactic-id').textContent=HumbleComicLibrary.builtinGalacticId(chrome.runtime);
    galacticLibraryLinkStatus.textContent = galacticLibraryExtensionId.value
      ? 'Saved override retained. Connection not yet verified; check the connection.'
      : 'Automatic Galactic Library pairing ready. Connection not yet verified; check the connection.';
    renderKeyReminders(keyReminders, keyReminderScan);
  }

  function renderKeyReminders(reminders, scan) {
    if (!scan) {
      keyReminderSummary.textContent = 'No key-reminder scan yet. Open Humble Purchases and select Rescan all purchases to establish complete reminders.';
      keyReminderList.replaceChildren();
      return;
    }
    const now = Date.now();
    const sorted = [...reminders].sort((left, right) => keyReminderSortValue(left, now) - keyReminderSortValue(right, now) || globalThis.LibraryTitleSort.compare(left.title,right.title));
    const expiringSoon = sorted.filter((record) => {
      const days = keyReminderDaysRemaining(record, now);
      return days !== null && days >= 0 && days <= 30;
    }).length;
    const needsReview = sorted.filter((record) => record.status === 'needs-review').length;
    const baseline = scan.complete
      ? ''
      : ' Older purchases have not been checked yet; use Rescan all purchases to establish complete reminders.';
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
      if (!confirm('Replace your library with this manual title list? This removes all saved accounts, purchase records, provenance, reminders, scan history, the history archive, and custom mappings.')) return;
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
    galacticLibraryLinkStatus.textContent = 'Override saved. For development builds, allow this extension in Galactic Library Advanced settings, then check the connection.';
  });

  document.querySelector('#test-galactic-library-link').addEventListener('click', async () => {
    try {
      const response = await testGalacticLibraryLink();
      galacticLibraryLinkStatus.textContent = `Connected to Galactic Library ${response.appVersion}. ${response.advertised?'Supported media: '+response.mediaTypes.join(', ')+'.':'Capabilities not advertised; newer features remain unconfirmed.'}`;
    } catch (error) {
      galacticLibraryLinkStatus.textContent = `Could not connect: ${error.message}`;
    }
  });

  document.querySelector('#clear-galactic-library-link').addEventListener('click', async () => {
    await HumbleComicLibrary.storageRemove('galacticLibraryExtensionId');
    galacticLibraryExtensionId.value = '';
    galacticLibraryLinkStatus.textContent = 'Override removed. Automatic Galactic Library pairing remains available; check the connection.';
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

  document.querySelector('#export-catalog').addEventListener('click',async()=>{
    const status=document.querySelector('#local-status');
    try {
      const catalog=HumbleComicLibrary.createTitleCatalog(await library());
      const url=URL.createObjectURL(new Blob([JSON.stringify(catalog,null,2)],{type:'application/json'}));
      Object.assign(document.createElement('a'),{href:url,download:'humble-title-catalog.json'}).click();setTimeout(()=>URL.revokeObjectURL(url),0);
      status.textContent='Exported catalog titles and identity metadata only; this is not a recoverable ownership backup.';
    }catch(error){status.textContent='Could not export the title catalog: '+error.message;}
  });

  document.querySelector('#clear-library').addEventListener('click', async () => {
    if (!confirm('Clear all saved accounts and every locally stored title, purchase record, key reminder, import history, historical purchase archive, and custom collection mapping? Your wishlist, display preferences and Galactic Library link will be kept.')) return;
    await HumbleComicLibrary.storageRemove([...Object.keys(HumbleComicLibrary.LIBRARY_STATE_DEFAULTS), 'hclPurchaseFocus']);
    status.textContent = 'Library, purchase history, key reminders, and custom mappings cleared.';
    await render();
  });
  LibraryAccountProfiles.mount(document.querySelector('#account-profiles'),{request:HumbleComicLibrary.storageRequest,keys:['humbleProfileLabel','profileArchives'],onActiveChange:()=>render()});
  globalThis.LibraryBrowser = {
    filterAndSortLibrary,
    getItemPurchaseDate,
    getState: () => ({ ...libraryBrowserState }),
    setState: (next) => { Object.assign(libraryBrowserState, next); saveLibraryState(libraryBrowserState); renderLibraryBrowser(); },
    render: () => renderLibraryBrowser()
  };
  render();
}());
