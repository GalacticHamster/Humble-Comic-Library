// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Galactic Hamster
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
  const libraryViewTitles = document.querySelector('#library-view-titles');
  const libraryViewGroups = document.querySelector('#library-view-groups');
  const librarySearchLabel = document.querySelector('#library-search-label');
  const librarySearchScope = document.querySelector('#library-search-scope');
  const libraryGroupMedia = document.querySelector('#library-group-media');
  const libraryGroupFilter = document.querySelector('#library-group-filter');
  const libraryGroupType = document.querySelector('#library-group-type');
  const libraryGroupSort = document.querySelector('#library-group-sort');
  const libraryGroupMode = document.querySelector('#library-group-mode');

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
    page: 0,
    // Titles stays the default view; its search matches titles unless another scope is chosen.
    view: 'titles',
    scope: 'title',
    groupScope: 'both',
    groupMedia: '',
    groupFilter: '',
    groupType: '',
    groupSort: 'name-asc',
    groupPage: 0,
    // Likely historical/native matches are combined unless the user asks for separate sources.
    groupMode: 'grouped'
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

  // The earliest known purchase date of a title (its first purchase), for oldest-first sorting.
  function getItemEarliestPurchaseDate(item) {
    if (!item || typeof item !== 'object') return null;
    const list = Array.isArray(item.provenance) ? item.provenance : (Array.isArray(item.purchaseOrigins) ? item.purchaseOrigins : []);
    let earliest = null;
    for (const raw of [item.purchasedAt || item.purchaseDate, ...list.map((rec) => rec?.purchasedAt || rec?.purchaseDate)]) {
      const time = raw ? Date.parse(raw) : NaN;
      if (Number.isFinite(time) && (earliest === null || time < earliest)) earliest = time;
    }
    return earliest;
  }

  // Date coverage across the rows of Titles (imported titles and titles only in the synced Humble Library). A title
  // counts as dated when any of its purchases has a known date.
  function renderDateCoverage(items) {
    const element = document.querySelector('#library-date-coverage');
    if (!element) return;
    const titles = [...titleRows(items), ...latestNativeTitles];
    if (!titles.length) { element.textContent = ''; return; }
    const dated = titles.filter((item) => getItemPurchaseDate(item) !== null).length, undated = titles.length - dated;
    const percent = Math.floor((dated / titles.length) * 1000) / 10;
    element.textContent = `Purchase dates known for ${dated.toLocaleString()} of ${titles.length.toLocaleString()} title${titles.length === 1 ? '' : 's'} (${percent}%).`
      + (undated ? ` ${undated.toLocaleString()} ${undated === 1 ? 'title has' : 'titles have'} no known purchase date yet; some older purchases may get dates as Humble restores its order history. Choose “No known purchase date” under Metadata in Titles to list them.` : '');
  }

  // The calendar date in this browser's time zone, as the bundle page shows it: a purchase made late in the
  // evening is shown on that day, not on the next day in UTC.
  function formatPurchaseDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (Number.isNaN(date.valueOf())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
        expiresAt: p?.expiresAt || item.expiresAt || null,
        formats: Array.isArray(p?.formats) ? p.formats : (Array.isArray(item.formats) ? item.formats : undefined),
        delivery: p?.delivery || item.delivery || '',
        streaming: Boolean(p?.streaming || item.streaming)
      })));
    }
    const sourceBundle = item.sourceBundle || (item.bundle?.title || '');
    const purchaseKey = item.purchaseKey || '';
    const purchasedAt = item.purchasedAt || null;
    if (sourceBundle || purchaseKey || purchasedAt || item.entitlement || item.keyType || item.keyStatus || item.formats !== undefined) {
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
        expiresAt: item.expiresAt || null,
        formats: Array.isArray(item.formats) ? item.formats : undefined,
        delivery: item.delivery || '',
        streaming: Boolean(item.streaming)
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
        const combinedFormats = Array.isArray(prev.formats) || Array.isArray(rec.formats)
          ? [...new Set([...(prev.formats || []), ...(rec.formats || [])])].sort()
          : undefined;
        merged.set(key, {
          ...prev,
          ...rec,
          sourceBundle: prev.sourceBundle || rec.sourceBundle,
          purchaseKey: prev.purchaseKey || rec.purchaseKey,
          purchasedAt: prev.purchasedAt || rec.purchasedAt,
          keyStatus: rec.keyStatus || prev.keyStatus,
          expiresAt: rec.expiresAt || prev.expiresAt,
          delivery: rec.delivery || prev.delivery || '',
          streaming: Boolean(rec.streaming || prev.streaming),
          ...(combinedFormats !== undefined ? { formats: combinedFormats } : {})
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
    const combinedFormats = [...new Set([...(targetObj.formats || []), ...(incomingObj.formats || [])])].sort();

    const latestProv = allProv[0];
    const targetDate = getItemPurchaseDate(targetObj);
    const incomingDate = getItemPurchaseDate(incomingObj);
    const useIncomingDate = incomingDate !== null && (targetDate === null || incomingDate > targetDate);

    return {
      ...targetObj,
      ...(useIncomingDate ? incomingObj : {}),
      ...(combinedFormats.length ? { formats: combinedFormats } : {}),
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

  // Imported titles as Titles lists them: consolidated, without Humble's "No Content" placeholders (contentPlaceholder).
  function titleRows(items) {
    const rows = consolidateLibrary(items);
    return globalThis.HumbleLibraryBrowser?.contentPlaceholder ? rows.filter((item) => typeof item !== 'object' || !HumbleLibraryBrowser.contentPlaceholder(item)) : rows;
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

  function bundleNamesOf(item) {
    if (!item || typeof item !== 'object') return [];
    return [...extractItemProvenance(item).map((rec) => rec.sourceBundle), item.sourceBundle, item.bundle?.title]
      .filter((name) => typeof name === 'string' && name.trim()).map((name) => name.toLowerCase());
  }

  function filterAndSortLibrary(items, optionsOrSearch = {}, maybeMedia = '', maybeMetadata = '', maybeSort = 'title-asc') {
    const collator = globalThis.LibraryTitleSort || new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    let result = Array.isArray(items) ? consolidateLibrary(items) : [];

    let search = '';
    let media = '';
    let metadata = '';
    let sort = 'title-asc';
    let scope = 'title';
    let addedAt = () => null;

    if (optionsOrSearch && typeof optionsOrSearch === 'object') {
      if (typeof optionsOrSearch.addedAt === 'function') addedAt = optionsOrSearch.addedAt;
      search = typeof optionsOrSearch.search === 'string' ? optionsOrSearch.search : '';
      media = typeof optionsOrSearch.media === 'string' ? optionsOrSearch.media : '';
      metadata = typeof optionsOrSearch.metadata === 'string' ? optionsOrSearch.metadata : '';
      sort = typeof optionsOrSearch.sort === 'string' ? optionsOrSearch.sort : 'title-asc';
      scope = ['bundle', 'both'].includes(optionsOrSearch.scope) ? optionsOrSearch.scope : 'title';
    } else {
      search = typeof optionsOrSearch === 'string' ? optionsOrSearch : '';
      media = typeof maybeMedia === 'string' ? maybeMedia : '';
      metadata = typeof maybeMetadata === 'string' ? maybeMetadata : '';
      sort = typeof maybeSort === 'string' ? maybeSort : 'title-asc';
    }

    const query = search.trim().toLowerCase();
    if (query) {
      result = result.filter((item) => {
        const title = (typeof item === 'string' ? item : (item.title || '')).toLowerCase();
        if (scope !== 'bundle' && title.includes(query)) return true;
        return scope !== 'title' && bundleNamesOf(item).some((name) => name.includes(query));
      });
    }

    if (media) {
      const targetMedia = media.toLowerCase();
      result = result.filter((item) => {
        const kind = (typeof item === 'string' ? 'book' : (item.kind || item.mediaType || 'book')).toLowerCase();
        if (targetMedia === 'book') {
          return kind === 'book' || kind === 'comic';
        }
        if (targetMedia === 'comic') {
          return kind === 'comic' || HumbleComicLibrary.isComicItem(item);
        }
        return kind === targetMedia;
      });
    }

    if (metadata) {
      result = result.filter((item) => {
        if (metadata === 'dated') return getItemPurchaseDate(item) !== null;
        // No purchase of the title has a known date; one dated purchase makes it dated.
        if (metadata === 'undated') return typeof item === 'string' || getItemPurchaseDate(item) === null;
        // The same count as the title's heading, so the filter and the row always agree.
        if (metadata === 'repeat') return typeof item === 'object' && titlePurchaseTotals(item.title || '', sortProvenanceRecords(extractItemProvenance(item))).counted.count > 1;
        if (metadata === 'bundle') return Boolean(typeof item === 'object' && (item.sourceBundle || item.bundle?.title));
        if (metadata === 'humble') return typeof item === 'object' && (item.source === 'humble' || Boolean(item.purchaseKey) || Boolean(item.provenance?.length));
        if (metadata === 'manual') return typeof item === 'string' || !(item.source === 'humble' || Boolean(item.purchaseKey) || Boolean(item.provenance?.length));
        if (metadata === 'key') return typeof item === 'object' && (item.entitlement === 'third-party-key' || item.provenance?.some((p) => p.entitlement === 'third-party-key') || Boolean(item.keyType) || (Array.isArray(item.keys) && item.keys.length > 0));
        if (metadata === 'download') return typeof item === 'object' && (item.entitlement === 'direct-download' || item.provenance?.some((p) => p.entitlement === 'direct-download') || (Array.isArray(item.downloads) && item.downloads.length > 0) || (Array.isArray(item.downloadPlatforms) && item.downloadPlatforms.length > 0) || Boolean(item.downloadUrl));
        return true;
      });
    }

    // Recently added: titles with a recently added Humble Library purchase first, then newest purchase date.
    const added = sort === 'added-desc' ? new Map(result.map((item) => [item, typeof item === 'object' ? addedAt(item) : null])) : null;
    result.sort((a, b) => {
      const titleA = typeof a === 'string' ? a : (a.title || '');
      const titleB = typeof b === 'string' ? b : (b.title || '');

      if (added) {
        const addedA = added.get(a), addedB = added.get(b);
        if (addedA !== null || addedB !== null) {
          if (addedA === null) return 1;
          if (addedB === null) return -1;
          return addedB - addedA || collator.compare(titleA, titleB);
        }
      }
      if (sort === 'title-desc') {
        return collator.compare(titleB, titleA);
      }
      if (sort === 'date-desc' || added) {
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
      // Oldest first: by each title's first known purchase; titles without a known date lead, so they are not
      // mistaken for the oldest purchases. Newest first (above) uses the latest purchase and lists them last.
      if (sort === 'date-asc') {
        const dateA = getItemEarliestPurchaseDate(a);
        const dateB = getItemEarliestPurchaseDate(b);
        if (dateA !== null && dateB !== null) {
          if (dateA !== dateB) return dateA - dateB;
          return collator.compare(titleA, titleB);
        }
        if (dateA !== null) return 1;
        if (dateB !== null) return -1;
        return collator.compare(titleA, titleB);
      }
      return collator.compare(titleA, titleB);
    });

    return result;
  }

  function mediaTypeLabel(kind) {
    switch (kind) {
      case 'book': return 'Book / eBook';
      case 'comic': return 'Comic';
      case 'game': return 'Game';
      case 'software': return 'Software';
      case 'audiobook': return 'Audiobook';
      case 'video': return 'Video';
      case 'unclassified': return 'Unclassified';
      default: return kind || 'Unknown';
    }
  }

  // The purchases of an imported title, as its Titles row lists them: imported orders and this account's Humble
  // Library copies, counted together without counting a combined order twice (HumbleLibraryBrowser.titlePurchaseCount).
  function titlePurchaseTotals(title, records, links = latestTitleLinks) {
    const copies = links ? links.links.get(links.key(title)) ?? [] : [];
    const orders = records.map(rec => ({ ...rec, sourceBundle: rec.sourceBundle || rec.bundle?.title || '' }));
    // Without the presentation model there are no Library copies: distinct imported orders, by the same rule.
    const counted = globalThis.HumbleLibraryBrowser ? HumbleLibraryBrowser.titlePurchaseCount(orders, copies)
      : { count: new Set(orders.map((rec, i) => rec.purchaseKey ? 'h:' + rec.purchaseKey : rec.sourceBundle.trim() ? 'hn:' + rec.sourceBundle.trim().toLowerCase() : 'record:' + i)).size, exact: true };
    return { copies, counted };
  }

  // One CSV row's purchase details for a Titles row: the same count, purchase names and dates Titles shows.
  // Its purchases, one entry each: imported orders by order key (else bundle name), Humble Library purchases by
  // purchase ID, and a Library purchase combined with an imported order as that order. Two purchases on one day stay two.
  function catalogPurchases(item, links) {
    const purchases = new Map(), add = (id, name, date) => {
      const known = purchases.get(id);
      if (!known) purchases.set(id, { name: name || '', date: date ?? null });
      else { known.name ||= name || ''; known.date ??= date ?? null; }
    };
    if (item.nativeOnly) {
      for (const copy of item.nativeCopies) add('n:' + copy.parentId, copy.purchase, copy.purchasedAt);
      return { count: new Set(item.nativeCopies.map(copy => copy.parentId)).size, exact: true, imported: false, library: true, purchases: [...purchases.values()] };
    }
    const title = typeof item === 'string' ? item : (item.title || ''), records = typeof item === 'string' ? [] : extractItemProvenance(item);
    const { copies, counted } = titlePurchaseTotals(title, records, links);
    for (const rec of records) {
      const bundle = String(rec.sourceBundle || '').trim();
      if (rec.purchaseKey || bundle) add(rec.purchaseKey ? 'h:' + rec.purchaseKey : 'hn:' + bundle.toLowerCase(), bundle, rec.purchasedAt);
    }
    for (const copy of copies) add(copy.historicalKey ?? 'n:' + copy.parentId, copy.purchase, copy.purchasedAt);
    return { count: counted.count, exact: counted.exact, imported: counted.count > 0 && records.some(rec => rec.purchaseKey || String(rec.sourceBundle || '').trim()), library: copies.length > 0, purchases: [...purchases.values()] };
  }

  function renderLibraryRow(item) {
    const row = document.createElement('li');
    row.className = 'library-item';

    const title = typeof item === 'string' ? item : (item.title || '');
    row.dataset.rowKeys = titleRowKey(title);
    const records = sortProvenanceRecords(extractItemProvenance(item));
    const { copies, counted } = titlePurchaseTotals(title, records);
    const summarySuffix = counted.count ? ` — ${purchaseCountText(counted)}` : ' — manual entry';

    const headerText = `${title}${summarySuffix}`;

    const details = document.createElement('details');
    details.className = 'library-item-details';

    const summary = document.createElement('summary');
    summary.className = 'library-item-summary';
    summary.textContent = headerText;
    details.append(summary);

    // One list of purchases: each imported order, sharing its row with a Humble Library copy only when
    // the two are safely associated (see HumbleLibraryBrowser.titlePurchases), then any other copies.
    const { rows: purchases, rest } = copies.length ? HumbleLibraryBrowser.titlePurchases(records, copies) : { rows: records.map(record => ({ record, copy: null })), rest: [] };
    if (records.length > 0 || rest.length > 0) {
      const list = document.createElement('ul');
      list.className = copies.length ? 'library-provenance-list library-title-purchases' : 'library-provenance-list';
      for (const { record: rec, copy } of purchases) {
        const li = document.createElement('li');
        li.className = 'library-provenance-item';

        const primary = document.createElement('div');
        primary.className = 'library-provenance-primary';
        const primaryText = rec.sourceBundle
          ? `Bundle: ${rec.sourceBundle}`
          : (rec.purchaseKey ? `Order: ${rec.purchaseKey}` : 'Purchase record stored without bundle details');
        primary.textContent = primaryText;
        li.append(primary);

        const secondaryParts = [];
        const pDate = formatPurchaseDate(rec.purchasedAt);
        if (pDate) secondaryParts.push(`Purchased: ${pDate}`);
        if (rec.sourceBundle && rec.purchaseKey) {
          secondaryParts.push(`Order: ${rec.purchaseKey}`);
        }
        if (rec.entitlement === 'third-party-key' || rec.keyType) {
          const status = rec.keyStatus ? ` (${rec.keyStatus})` : '';
          secondaryParts.push(`Key: ${rec.keyType || 'Key'}${status}`);
          if (rec.expiresAt) {
            const exp = formatPurchaseDate(rec.expiresAt);
            if (exp) secondaryParts.push(`Expires: ${exp}`);
          }
        } else if (rec.entitlement === 'direct-download' || rec.streaming || rec.delivery) {
          const deliveryLabel = rec.streaming || rec.delivery === 'streaming' ? 'Streaming' : 'Direct download';
          secondaryParts.push(deliveryLabel);
        }
        const formats = Array.isArray(rec.formats)
          ? rec.formats
          : (Array.isArray(item.formats) ? item.formats : null);
        if (formats && formats.length > 0) {
          secondaryParts.push(`Formats: ${formats.map(f => f.startsWith('.') ? f : (/^[a-z0-9]{2,10}$/iu.test(f) ? '.' + f.toLowerCase() : f)).join(', ')}`);
        } else if (formats && formats.length === 0) {
          if (rec.entitlement !== 'third-party-key' && !rec.keyType && !rec.streaming && rec.delivery !== 'streaming') {
            secondaryParts.push('No file formats in purchase metadata');
          }
        } else if (formats === null) {
          if (rec.entitlement !== 'third-party-key' && !rec.keyType && !rec.streaming && rec.delivery !== 'streaming') {
            secondaryParts.push('Format details require library rescan');
          }
        }
        // A combined Library copy is a verified purchase; how it was paired with this order is diagnostic detail.
        if (copy && !pDate) secondaryParts.unshift('Purchased on Humble');
        if (copy && showMatchDetails) secondaryParts.push(`Likely the same purchase as “${copy.purchase || 'a Humble Library purchase'}” in your Humble Library`);

        if (secondaryParts.length > 0) {
          const secondary = document.createElement('div');
          secondary.className = 'library-provenance-secondary';
          secondary.textContent = secondaryParts.join(' · ');
          li.append(secondary);
        }
        // With Library copies, every purchase row uses the Bundles & Orders row layout.
        if (copies.length) li.className = 'library-provenance-item library-group-item';
        if (copy) li.append(humbleButton(copy.route, `Open ${title} on Humble`));

        const legacyParts = [];
        if (rec.sourceBundle) legacyParts.push(`Bundle: ${rec.sourceBundle}`);
        if (pDate) legacyParts.push(`Purchased: ${pDate}`);
        if (rec.purchaseKey) legacyParts.push(`Order: ${rec.purchaseKey}`);
        if (rec.entitlement === 'third-party-key' || rec.keyType) {
          const status = rec.keyStatus ? ` (${rec.keyStatus})` : '';
          legacyParts.push(`Key: ${rec.keyType || 'Key'}${status}`);
          if (rec.expiresAt) {
            const exp = formatPurchaseDate(rec.expiresAt);
            if (exp) legacyParts.push(`Expires: ${exp}`);
          }
        } else if (rec.entitlement === 'direct-download') {
          legacyParts.push('Direct download');
        }
        const fullLegacyText = legacyParts.join(' · ') || 'Purchase record stored without bundle details';

        try {
          Object.defineProperty(li, 'textContent', {
            get() { return fullLegacyText; },
            set(v) { primary.textContent = v; },
            configurable: true
          });
        } catch {
          li.textContent = fullLegacyText;
        }

        list.append(li);
      }
      list.append(...rest.map(copy => titleCopyRow(copy, title)));
      details.append(list);
      // When rows outnumber purchases (or the number is uncertain), one plain sentence says why.
      const shown = purchases.length + rest.length;
      if (!counted.exact || shown > counted.count) {
        const note = document.createElement('p');
        note.className = 'library-provenance-empty library-title-note';
        note.textContent = counted.exact ? 'Some imported orders listed here are the same purchases as Humble Library items.' : 'Some imported orders may be the same purchases as Humble Library items listed here.';
        details.append(note);
      }
    } else {
      const empty = document.createElement('p');
      empty.className = 'library-provenance-empty';
      empty.textContent = 'No bundle or purchase record stored.';
      details.append(empty);
    }

    const itemKind = typeof item === 'string' ? 'book' : (item.kind || item.mediaType || 'unclassified');
    const automaticKind = typeof item === 'string' ? 'book' : (item.automaticKind || item.kind || 'unclassified');
    const isOverridden = Boolean(typeof item === 'object' && (item.manualKind || (item.automaticKind && item.kind !== item.automaticKind)));
    details.append(classificationControls({ title, kind: itemKind, automaticKind, overridden: isOverridden,
      change: kind => HumbleComicLibrary.storageRequest('setMediaOverride', item, kind),
      reset: () => HumbleComicLibrary.storageRequest('resetMediaOverride', item) }));

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

  const GROUP_TYPE_LABELS = { bundle: 'Bundle', store: 'Store purchase', widget: 'Widget purchase' };
  const CATEGORY_LABELS = { game: ['game', 'games'], book: ['book / comic', 'books / comics'], software: ['software item', 'software items'], audiobook: ['audiobook', 'audiobooks'], video: ['video', 'videos'], unknown: ['unknown media', 'unknown media'] };
  const NAMESPACE_LABELS = { steam: 'Steam key', download_drm_free: 'DRM-free download', gog: 'GOG key', nintendo: 'Nintendo key', playstation: 'PlayStation key', epic_keyless: 'Epic Games', rockstar_social: 'Rockstar key', external_key: 'External key', generic: 'Other entitlement' };
  const GROUP_CONTENT_BATCH = 100;
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  let latestGroupModel = { groups: [], native: { enabled: false, present: false, error: false, unresolved: 0, coverage: null } };
  let latestReconciliation = null;

  // Opens only routes built by HumbleLibraryBrowser from native IDs; the URL is never shown.
  function openOnHumble(url) {
    if (typeof url === 'string' && url.startsWith('https://www.humblebundle.com/home/library/')) chrome.tabs.create({ url });
  }

  function humbleButton(url, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary library-open-humble';
    button.textContent = 'Open on Humble';
    button.setAttribute('aria-label', label);
    button.addEventListener('click', (event) => { event?.stopPropagation?.(); openOnHumble(url); });
    return button;
  }

  function groupName(group) {
    if (group.name) return group.name;
    return group.source === 'native' ? 'Humble purchase (name appears after the next full sync)' : 'Order without a recorded name';
  }

  function groupContentRow(entry, matched) {
    const li = document.createElement('li');
    li.className = matched ? 'library-group-item library-group-match' : 'library-group-item';
    const primary = document.createElement('div');
    primary.className = 'library-provenance-primary';
    primary.textContent = (matched ? 'Match: ' : '') + (entry.title || 'Untitled item');
    const parts = [entry.source === 'native' ? (entry.category === 'game' ? 'Game' : 'Media unknown') : mediaTypeLabel(entry.kind)];
    if (entry.source !== 'historical') {
      parts.push(NAMESPACE_LABELS[entry.namespace] || 'Entitlement');
      if (entry.namespace === 'steam') parts.push('Activation unknown');
      parts.push(entry.excluded ? (entry.gifted ? 'Excluded: gifted' : 'Excluded') : 'Purchased');
    }
    if (entry.unified) {
      if (entry.source === 'native') parts.push('Humble Library only');
      if (entry.source === 'historical') parts.push('Historical import only');
      if (entry.historicalTitle) parts.push(`Historical title: ${entry.historicalTitle}`);
      if (entry.historicalRecords > 1) parts.push(`${entry.historicalRecords} historical records`);
    }
    const secondary = document.createElement('div');
    secondary.className = 'library-provenance-secondary';
    secondary.textContent = parts.join(' · ');
    li.append(primary, secondary);
    if (entry.route) li.append(humbleButton(entry.route, `Open ${entry.title || 'this item'} on Humble`));
    return li;
  }

  // Contents render only when a group is expanded, in batches, so 200 groups stay light.
  function renderGroupContents(container, group, matches) {
    const matched = new Set(matches);
    const order = [...matches, ...group.items.map((_, i) => i).filter((i) => !matched.has(i))];
    let shown = 0;
    const list = document.createElement('ul');
    list.className = 'library-provenance-list library-group-contents';
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'secondary library-group-more';
    const step = () => {
      const next = order.slice(shown, shown + GROUP_CONTENT_BATCH);
      list.append(...next.map((i) => groupContentRow(group.source === 'unified' ? { ...group.items[i], unified: true } : group.items[i], matched.has(i))));
      shown += next.length;
      more.hidden = shown >= order.length;
      more.textContent = `Show ${Math.min(GROUP_CONTENT_BATCH, order.length - shown)} more of ${order.length - shown} remaining titles`;
    };
    more.addEventListener('click', step);
    step();
    if (!order.length) {
      const empty = document.createElement('p');
      empty.className = 'library-provenance-empty';
      empty.textContent = 'No media titles were imported from this purchase.';
      container.append(empty);
      return;
    }
    container.append(list, more);
  }

  function groupFacts(group) {
    const facts = [];
    const media = Object.entries(group.categories).map(([key, n]) => plural(n, ...CATEGORY_LABELS[key]));
    if (media.length) facts.push(`Contains ${media.join(', ')}${group.media === 'mixed' ? ' (mixed media)' : ''}.`);
    if (group.source === 'unified') {
      const e = group.evidence;
      facts.push(`Likely the same purchase in your historical import and Humble Library: ${e.sameName ? 'the same name' : 'similar names'}, and ${e.shared === e.smaller ? 'all' : e.shared + ' of'} ${plural(e.smaller, 'title')} of the smaller record appear in the other.`);
      if (e.interchangeable) facts.push(`One of ${e.interchangeable} identical purchases with this name; which order date belongs to which Humble Library purchase cannot be told apart.`);
      if (group.historicalName) facts.push(`Historical name: ${group.historicalName}`);
      const split = [group.onlyNative ? `${plural(group.onlyNative, 'title')} only in the Humble Library` : '', group.onlyHistorical ? `${plural(group.onlyHistorical, 'title')} only in the historical import` : ''].filter(Boolean);
      if (split.length) facts.push(split.join('; ') + '.');
      if (group.listedCount !== null && group.listedCount !== group.historical.items.length) facts.push(`Humble listed ${plural(group.listedCount, 'item')} in this order; ${plural(group.historical.items.length, 'media title')} were imported.`);
      facts.push('Humble Library purchase verified against the signed-in account.');
      if (group.dateSource === 'order-history') facts.push('Purchase date from your Humble order history, matched to this purchase by its name.');
      if (group.firstSeenAt) facts.push(`First found by Library sync on ${formatPurchaseDate(group.firstSeenAt)}.${group.dateSource === 'order-history' ? '' : ' The purchase date comes from the historical import.'}`);
      if (group.items.some((entry) => entry.namespace === 'steam')) facts.push('Steam activation is unknown for every key.');
      if (group.excluded) facts.push(`${plural(group.excluded, 'item')} excluded (gifted, revoked or temporary).`);
      if (group.sameNamePurchases > 1) facts.push(`One of ${group.sameNamePurchases} separate purchases with this name.`);
      return facts;
    }
    if (group.source === 'native') {
      facts.push('Native Library purchase, verified against the signed-in account.');
      // A first-found date is when the extension first saw the purchase, never when it was bought.
      if (group.dateSource === 'order-history') facts.push('Purchase date from your Humble order history, matched to this purchase by its name.');
      else facts.push(group.firstSeenAt
        ? `First found by Library sync on ${formatPurchaseDate(group.firstSeenAt)}. Humble's Library lists no purchase date, so this is when the extension first saw it, not when it was bought.`
        : 'Humble\'s Library lists no purchase date. This purchase was saved before first-found dates were recorded.');
      if (group.items.some((entry) => entry.namespace === 'steam')) facts.push('Steam activation is unknown for every key.');
    } else {
      facts.push(group.orderRecorded ? 'Historical import from the original purchase importer.' : 'Historical import without an order key: purchases with this bundle name are grouped together.');
      if (group.listedCount !== null && group.listedCount !== group.items.length) facts.push(`Humble listed ${plural(group.listedCount, 'item')} in this order; ${plural(group.items.length, 'media title')} were imported.`);
    }
    if (group.excluded) facts.push(`${plural(group.excluded, 'item')} excluded (gifted, revoked or temporary).`);
    if (group.sameNamePurchases > 1) facts.push(`One of ${group.sameNamePurchases} separate purchases with this name.`);
    if (group.matchState === 'matched' && libraryBrowserState.groupMode === 'separate') facts.push('Shown combined with its likely match in the Grouped view.');
    if (group.matchState === 'ambiguous') facts.push('Not combined: more than one purchase in the other source fits equally well.');
    if (group.matchState === 'conflicting') facts.push('Not combined: the other source has a purchase with this name but different contents.');
    if (!group.route) facts.push(group.source === 'native' ? 'No verified Humble page for this purchase.' : 'Humble has no verified page for orders from the original importer, so there is no direct link.');
    return facts;
  }

  function renderGroupRow({ group, nameMatch, matches }) {
    const row = document.createElement('li');
    row.className = 'library-item library-group';
    // A purchase that becomes combined during a sync keeps its expanded state.
    row.dataset.rowKeys = ['g:' + group.key, ...(group.source === 'unified' ? ['g:' + group.historical.key, 'g:' + group.native.key] : [])].join('\n');
    const details = document.createElement('details');
    details.className = 'library-item-details';
    const summary = document.createElement('summary');
    summary.className = 'library-item-summary';
    const date = formatPurchaseDate(group.purchasedAt);
    const parts = [
      GROUP_TYPE_LABELS[group.type] || (group.source === 'historical' ? 'Order' : 'Purchase'),
      plural(group.items.length, 'title'),
      date ? `Purchased ${date}` : group.firstSeenAt ? `Purchase date not recorded · First synced ${formatPurchaseDate(group.firstSeenAt)}` : 'Purchase date not recorded',
      group.source === 'unified' ? 'Historical + Native · Likely match' : group.source === 'native' ? 'Native Library' : 'Historical import'
    ];
    if (matches.length && !nameMatch) parts.push(`${plural(matches.length, 'matching title')}`);
    summary.textContent = `${groupName(group)} — ${parts.join(' · ')}`;
    details.append(summary);
    let rendered = false;
    details.addEventListener('toggle', () => {
      if (rendered || details.open === false) return;
      rendered = true;
      const facts = document.createElement('ul');
      facts.className = 'library-group-facts';
      facts.append(...groupFacts(group).map((text) => { const li = document.createElement('li'); li.textContent = text; return li; }));
      details.append(facts);
      if (group.route) details.append(humbleButton(group.route, `Open ${groupName(group)} on Humble`));
      renderGroupContents(details, group, matches);
    });
    row.append(details);
    return row;
  }

  function syncViewControls() {
    const groups = libraryBrowserState.view === 'groups';
    if (libraryViewTitles) libraryViewTitles.checked = !groups;
    if (libraryViewGroups) libraryViewGroups.checked = groups;
    for (const label of document.querySelectorAll?.('.library-title-only') ?? []) label.hidden = groups;
    for (const label of document.querySelectorAll?.('.library-group-only') ?? []) label.hidden = !groups;
    const scope = groups ? libraryBrowserState.groupScope : libraryBrowserState.scope;
    if (librarySearchScope && librarySearchScope.value !== scope) librarySearchScope.value = scope;
    if (librarySearchLabel) librarySearchLabel.textContent = groups ? 'Find bundles and orders' : 'Find titles';
    if (librarySearch) librarySearch.placeholder = groups ? 'Filter by bundle name or contained title…' : scope === 'title' ? 'Filter by title…' : 'Filter by title or bundle name…';
    for (const [select, key] of [[libraryGroupMedia, 'groupMedia'], [libraryGroupFilter, 'groupFilter'], [libraryGroupType, 'groupType'], [libraryGroupSort, 'groupSort'], [libraryGroupMode, 'groupMode']]) {
      if (select && select.value !== libraryBrowserState[key]) select.value = libraryBrowserState[key];
    }
  }

  function renderGroupBrowser() {
    const model = latestGroupModel;
    const grouped = Boolean(latestReconciliation) && libraryBrowserState.groupMode !== 'separate';
    const groups = grouped ? latestReconciliation.groups : model.groups;
    const results = globalThis.HumbleLibraryBrowser ? HumbleLibraryBrowser.filterGroups(groups, {
      search: libraryBrowserState.search, scope: libraryBrowserState.groupScope, media: libraryBrowserState.groupMedia,
      filter: libraryBrowserState.groupFilter, type: libraryBrowserState.groupType, sort: libraryBrowserState.groupSort
    }) : [];
    const pageSize = libraryBrowserState.pageSize || 50;
    const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
    libraryBrowserState.groupPage = Math.max(0, Math.min(libraryBrowserState.groupPage, totalPages - 1));
    saveLibraryState(libraryBrowserState);
    const start = libraryBrowserState.groupPage * pageSize;
    const pageGroups = results.slice(start, start + pageSize);
    preview.start = start + 1;
    preview.replaceChildren(...pageGroups.map(renderGroupRow));
    if (libraryPrevious) libraryPrevious.disabled = libraryBrowserState.groupPage === 0;
    if (libraryNext) libraryNext.disabled = (libraryBrowserState.groupPage + 1) * pageSize >= results.length;
    const note = document.querySelector('#preview-note');
    if (!note) return;
    const nativeNote = model.native.error ? ' Native Library records could not be read.'
      : model.native.present && model.native.unresolved ? ` ${plural(model.native.unresolved, 'native Library row')} could not be verified and ${model.native.unresolved === 1 ? 'is' : 'are'} not listed.` : '';
    const combined = grouped && latestReconciliation.stats.matched ? ` ${plural(latestReconciliation.stats.matched, 'purchase')} combined from historical and Humble Library records.` : '';
    if (!groups.length) {
      note.textContent = 'No bundles or orders are stored yet. Import purchases or restore a backup to browse them.' + nativeNote;
    } else if (!results.length) {
      note.textContent = `No bundles or orders match your search or filter criteria (0 of ${groups.length} purchase groups).` + nativeNote;
    } else {
      const pageInfo = totalPages > 1 ? ` (page ${libraryBrowserState.groupPage + 1} of ${totalPages})` : '';
      const filterInfo = results.length !== groups.length ? ` (filtered from ${groups.length})` : '';
      note.textContent = `Showing ${pageGroups.length} of ${results.length} purchase groups${filterInfo}${pageInfo}.` + combined + nativeNote;
    }
  }

  let latestLibraryItems = [];
  // Humble Library titles with no historical record of the same name, shown in Titles for
  // browsing only. They have no media override or order details, and are never stored.
  let latestNativeTitles = [];

  // Titles view links: verified Humble pages from native entitlement IDs only (see
  // HumbleLibraryBrowser.titleLinks). Rebuilt with the model; never stored.
  let latestTitleLinks = null;
  const titleRowKey = title => 't:' + String(title ?? '').normalize('NFKC').trim().toLowerCase();
  const purchaseCountText = ({ count, exact }) => `${exact ? '' : 'at least '}${count} purchase${count === 1 ? '' : 's'}`;
  // How imported orders and Library copies were paired is diagnostic detail, shown with diagnostics on.
  // Ownership (Purchased) never depends on it.
  let showMatchDetails = false;

  // A Humble Library copy with its own row in a title's purchases, laid out like Bundles & Orders contents.
  // With diagnostics on, copies not combined with an imported order say why; nothing is inferred from names.
  // The media badge, selector and Reset to automatic, shared by imported and Library-synced titles.
  function classificationControls({ title, kind, automaticKind, overridden, change, reset }) {
    const classificationRow = document.createElement('div');
    classificationRow.className = 'library-classification-row';
    const badge = document.createElement('span');
    badge.className = 'library-media-badge';
    badge.dataset.mediaType = kind;
    badge.textContent = mediaTypeLabel(kind);
    const note = document.createElement('span');
    note.className = 'library-classification-note';
    note.textContent = overridden ? `User override (automatic: ${mediaTypeLabel(automaticKind)})` : `Automatic: ${mediaTypeLabel(automaticKind)}`;
    const select = document.createElement('select');
    select.className = 'library-classification-select';
    select.setAttribute('aria-label', `Change media type for ${title}`);
    for (const opt of [
      { value: 'book', label: 'Book / eBook' }, { value: 'comic', label: 'Comic' }, { value: 'game', label: 'Game' }, { value: 'software', label: 'Software' },
      { value: 'audiobook', label: 'Audiobook' }, { value: 'video', label: 'Video' }, { value: 'unclassified', label: 'Unclassified' }
    ]) {
      const optionEl = document.createElement('option');
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      if (opt.value === kind) optionEl.selected = true;
      select.append(optionEl);
    }
    select.addEventListener('change', async (e) => {
      e.stopPropagation();
      const newKind = select.value;
      if (newKind === kind) return;
      try {
        await change(newKind);
        await render();
      } catch (err) {
        alert(`Failed to change media type: ${err.message}`);
      }
    });
    classificationRow.append(badge, note, select);
    if (overridden) {
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'library-reset-classification-btn secondary';
      resetBtn.textContent = 'Reset to automatic';
      resetBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await reset();
          await render();
        } catch (err) {
          alert(`Failed to reset media type: ${err.message}`);
        }
      });
      classificationRow.append(resetBtn);
    }
    return classificationRow;
  }

  function titleCopyRow(copy, title) {
    const li = document.createElement('li');
    li.className = 'library-provenance-item library-group-item';
    const primary = document.createElement('div');
    primary.className = 'library-provenance-primary';
    primary.textContent = copy.purchase ? `${GROUP_TYPE_LABELS[copy.type] || 'Purchase'}: ${copy.purchase}` : 'Humble Library purchase';
    const media = copy.media ?? (copy.kind && copy.kind !== 'unknown' ? copy.kind : null);
    const parts = [copy.purchasedAt ? `Purchased on Humble ${formatPurchaseDate(copy.purchasedAt)}` : 'Purchased on Humble', `Media: ${media ? mediaTypeLabel(media) : 'Unknown'}`];
    if (copy.steam) parts.push('Steam activation: Unknown');
    if (copy.firstSeenAt) parts.push(`First synced ${formatPurchaseDate(copy.firstSeenAt)}`);
    if (showMatchDetails && copy.interchangeable) parts.push(`One of ${copy.interchangeable} identical purchases`);
    else if (showMatchDetails && copy.matchState === 'ambiguous') parts.push('Not combined: ambiguous match');
    else if (showMatchDetails && copy.matchState === 'conflicting') parts.push('Not combined: contents differ');
    const secondary = document.createElement('div');
    secondary.className = 'library-provenance-secondary';
    secondary.textContent = parts.join(' · ');
    li.append(primary, secondary);
    if (copy.route) li.append(humbleButton(copy.route, `Open ${title}${copy.purchase ? ` from ${copy.purchase}` : ''} on Humble`));
    return li;
  }

  function renderNativeTitleRow(item) {
    const row = document.createElement('li');
    row.className = 'library-item';
    row.dataset.rowKeys = titleRowKey(item.title);
    const details = document.createElement('details');
    details.className = 'library-item-details';
    const summary = document.createElement('summary');
    summary.className = 'library-item-summary';
    // Purchases, not entitlements: two items from one Humble purchase are one purchase.
    summary.textContent = `${item.title} — ${purchaseCountText({ count: new Set(item.nativeCopies.map(copy => copy.parentId)).size, exact: true })}`;
    const list = document.createElement('ul');
    list.className = 'library-provenance-list library-title-purchases';
    list.append(...item.nativeCopies.map(copy => titleCopyRow(copy, item.title)));
    details.append(summary, list);
    // A correction applies to this title's Library items only, each by its own Library ID.
    const refs = item.nativeCopies.filter(copy => copy.nativeId).map(copy => ({ namespace: copy.namespace, nativeId: copy.nativeId }));
    if (refs.length) {
      const automatic = item.nativeCopies.find(copy => copy.automaticKind)?.automaticKind;
      details.append(classificationControls({ title: item.title, kind: item.kind, automaticKind: automatic && automatic !== 'unknown' ? automatic : 'unclassified',
        overridden: item.nativeCopies.some(copy => copy.manualKind),
        change: kind => HumbleComicLibrary.storageRequest('setNativeMediaOverride', refs, kind),
        reset: () => HumbleComicLibrary.storageRequest('setNativeMediaOverride', refs, null) }));
    }
    row.append(details);
    return row;
  }

  function renderLibraryBrowser(items = latestLibraryItems) {
    latestLibraryItems = Array.isArray(items) ? items : [];
    if (!preview) return;
    syncViewControls();
    if (libraryBrowserState.view === 'groups') return renderGroupBrowser();

    if (librarySearch && librarySearch.value !== libraryBrowserState.search) librarySearch.value = libraryBrowserState.search;
    if (libraryFilterMedia && libraryFilterMedia.value !== libraryBrowserState.media) libraryFilterMedia.value = libraryBrowserState.media;
    if (libraryFilterMetadata && libraryFilterMetadata.value !== libraryBrowserState.metadata) libraryFilterMetadata.value = libraryBrowserState.metadata;
    if (librarySort && librarySort.value !== libraryBrowserState.sort) librarySort.value = libraryBrowserState.sort;
    if (libraryPageSize && Number(libraryPageSize.value) !== libraryBrowserState.pageSize) libraryPageSize.value = String(libraryBrowserState.pageSize);

    const uniqueItems = [...titleRows(latestLibraryItems), ...latestNativeTitles];
    const processed = filterAndSortLibrary(uniqueItems, {
      search: libraryBrowserState.search,
      scope: libraryBrowserState.scope,
      media: libraryBrowserState.media,
      metadata: libraryBrowserState.metadata,
      sort: libraryBrowserState.sort,
      addedAt: (item) => latestTitleLinks && globalThis.HumbleLibraryBrowser ? HumbleLibraryBrowser.titleAddedAt(latestTitleLinks.links.get(latestTitleLinks.key(item.title))) : null
    });

    const pageSize = libraryBrowserState.pageSize || 50;
    const totalPages = Math.max(1, Math.ceil(processed.length / pageSize));
    libraryBrowserState.page = Math.max(0, Math.min(libraryBrowserState.page, totalPages - 1));
    saveLibraryState(libraryBrowserState);

    const start = libraryBrowserState.page * pageSize;
    const pageItems = processed.slice(start, start + pageSize);

    preview.start = start + 1;
    preview.replaceChildren(...pageItems.map(item => item.nativeOnly ? renderNativeTitleRow(item) : renderLibraryRow(item)));

    if (libraryPrevious) libraryPrevious.disabled = libraryBrowserState.page === 0;
    if (libraryNext) libraryNext.disabled = (libraryBrowserState.page + 1) * pageSize >= processed.length;

    const note = document.querySelector('#preview-note');
    if (note) {
      if (!uniqueItems.length) {
        note.textContent = 'Your library is empty. Sync your Humble Library or restore a backup to see your titles.';
      } else if (!processed.length) {
        note.textContent = `No items match your search or filter criteria (0 of ${uniqueItems.length} items).`;
      } else {
        const pageInfo = totalPages > 1 ? ` (page ${libraryBrowserState.page + 1} of ${totalPages})` : '';
        const filterInfo = processed.length !== uniqueItems.length ? ` (filtered from ${uniqueItems.length})` : '';
        const sortLabel = libraryBrowserState.sort === 'added-desc' ? 'recently added first'
          : libraryBrowserState.sort === 'date-desc' ? 'by latest purchase date (newest), titles without a known date last'
          : libraryBrowserState.sort === 'date-asc' ? 'by first purchase date (oldest), titles without a known date first'
          : libraryBrowserState.sort === 'title-desc' ? 'reverse alphabetically'
          : 'alphabetically';
        const nativeShown = processed.filter(item => item.nativeOnly).length;
        note.textContent = `Showing ${pageItems.length} of ${processed.length} items${filterInfo}${pageInfo}, ${sortLabel}.${nativeShown ? ` ${nativeShown.toLocaleString()} ${nativeShown === 1 ? 'is' : 'are'} only in your synced Humble Library.` : ''}`;
      }
    }
  }

  // View, scope and group controls keep each view's own page; switching views keeps both.
  for (const radio of [libraryViewTitles, libraryViewGroups]) {
    radio?.addEventListener('change', () => {
      if (!radio.checked) return;
      libraryBrowserState.view = radio.value === 'groups' ? 'groups' : 'titles';
      saveLibraryState(libraryBrowserState);
      renderLibraryBrowser();
    });
  }
  librarySearchScope?.addEventListener('change', () => {
    const value = ['title', 'bundle', 'both'].includes(librarySearchScope.value) ? librarySearchScope.value : 'title';
    if (libraryBrowserState.view === 'groups') { libraryBrowserState.groupScope = value; libraryBrowserState.groupPage = 0; }
    else { libraryBrowserState.scope = value; libraryBrowserState.page = 0; }
    saveLibraryState(libraryBrowserState);
    renderLibraryBrowser();
  });
  for (const [select, key] of [[libraryGroupMedia, 'groupMedia'], [libraryGroupFilter, 'groupFilter'], [libraryGroupType, 'groupType'], [libraryGroupSort, 'groupSort'], [libraryGroupMode, 'groupMode']]) {
    select?.addEventListener('change', () => {
      libraryBrowserState[key] = select.value;
      libraryBrowserState.groupPage = 0;
      saveLibraryState(libraryBrowserState);
      renderLibraryBrowser();
    });
  }
  librarySearch?.addEventListener('input', () => {
    libraryBrowserState.page = 0;
    libraryBrowserState.groupPage = 0;
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
    libraryBrowserState.groupPage = 0;
    saveLibraryState(libraryBrowserState);
    renderLibraryBrowser();
  });
  libraryPrevious?.addEventListener('click', () => {
    if (libraryBrowserState.view === 'groups') libraryBrowserState.groupPage--;
    else libraryBrowserState.page--;
    saveLibraryState(libraryBrowserState);
    renderLibraryBrowser();
  });
  libraryNext?.addEventListener('click', () => {
    if (libraryBrowserState.view === 'groups') libraryBrowserState.groupPage++;
    else libraryBrowserState.page++;
    saveLibraryState(libraryBrowserState);
    renderLibraryBrowser();
  });

  async function library() {
    return (await chrome.storage.local.get({ libraryItems: [] })).libraryItems;
  }

  // Renders run one at a time, so a storage change arriving mid-render is applied by the next one.
  let renderChain = Promise.resolve(), queuedRenders = 0;
  function render(options) {
    queuedRenders++;
    // A failed render (for example after the extension was reloaded) leaves the model to be rebuilt.
    const run = renderChain.then(() => renderNow(options)).catch((error) => { modelDirty = true; throw error; }).finally(() => { queuedRenders--; });
    renderChain = run.catch(() => {});
    return run;
  }
  const clock = () => globalThis.performance?.now?.() ?? Date.now();
  const refreshStats = { renders: 0, liveRenders: 0, modelBuilds: 0, progressOnly: 0, lastRenderMs: 0, lastModelMs: 0, maxModelMs: 0 };
  // Model inputs: anything else re-renders text without rebuilding groups or reconciliation.
  // knownSignature is the newest native data this page has been told about, rendered or still pending.
  let modelDirty = true, knownSignature = null, renderedAccountId = null;

  // A live refresh (storage changed elsewhere) updates data only: form fields, unsent choices and
  // connection results on this page are left as the user has them.
  async function renderNow({ live = false } = {}) {
    const started = clock();
    const rebuild = !live || modelDirty;
    modelDirty = false;
    // One read for every library key, so titles and Library records always come from the same account.
    const state = await chrome.storage.local.get({ lastImport: null, purchaseSummaries: [], customCollectionMappings: [], showDiagnostics: false, keyReminders: [], keyReminderScan: null, galacticLibraryExtensionId: '',
      libraryItems: [], wishlistItems: [], bundleSummaryPreferences: {}, rejectedPurchaseItems: [], mediaImportVersion: 1, mediaTypeOverrides: {},
      historicalLibraryItems: [], historicalPurchaseSummaries: [], humbleProfileLabel: '', profileArchives: [], libraryEntitlements: null, humbleAccountId: null, humbleKeyReviews: {} });
    const { lastImport: summary, purchaseSummaries = [], customCollectionMappings = [], showDiagnostics: diagnosticsEnabled = false, keyReminders = [], galacticLibraryExtensionId: savedGalacticLibraryExtensionId = '' } = state;
    const items = state.libraryItems;
    const { libraryEntitlements = null, humbleAccountId = null } = state;
    showMatchDetails = Boolean(diagnosticsEnabled);
    if (globalThis.HumbleLibraryBrowser) {
      if (knownSignature === null || renderedAccountId !== humbleAccountId) knownSignature = HumbleLibraryBrowser.nativeSignature(libraryEntitlements, humbleAccountId);
      renderedAccountId = humbleAccountId;
      if (rebuild) {
        const modelStarted = clock();
        latestGroupModel = HumbleLibraryBrowser.buildGroups({ items, purchaseSummaries, libraryEntitlements, humbleAccountId, mediaTypeOverrides: state.mediaTypeOverrides });
        // Reconciled once per data load; it is presentation only and never stored.
        latestReconciliation = latestGroupModel.native.present ? HumbleLibraryBrowser.reconcile(latestGroupModel.groups) : null;
        latestTitleLinks = latestGroupModel.native.present ? HumbleLibraryBrowser.titleLinks(latestGroupModel.groups, latestReconciliation) : null;
        latestNativeTitles = latestGroupModel.native.present ? HumbleLibraryBrowser.nativeOnlyTitles(latestGroupModel, items, latestTitleLinks) : [];
        renderDateCoverage(items);
        refreshStats.modelBuilds++;
        refreshStats.lastModelMs = clock() - modelStarted;
        refreshStats.maxModelMs = Math.max(refreshStats.maxModelMs, refreshStats.lastModelMs);
      }
      if (libraryGroupMode) libraryGroupMode.disabled = !latestReconciliation;
      // Native-only choices stay unavailable until this account has native Library records.
      for (const value of ['both', 'native', 'ambiguous']) { const option = libraryGroupFilter?.querySelector?.(`option[value="${value}"]`); if (option) option.disabled = !latestGroupModel.native.present; }
      for (const value of ['bundle', 'store', 'widget']) { const option = libraryGroupType?.querySelector?.(`option[value="${value}"]`); if (option) option.disabled = !latestGroupModel.native.present; }
    }
    const titles = [...titleRows(items), ...latestNativeTitles];
    renderWishlist(state.wishlistItems);
    if (!live) { const prefs = HumbleComicLibrary.normalizeSummaryPreferences(state.bundleSummaryPreferences); document.querySelector('#summary-minimized').checked = prefs.minimized; document.querySelector('#summary-position').value = prefs.position; }
    const pricedPurchases = purchaseSummaries.filter((purchase) => purchase.pricePaid !== null).length;
    const comics = titles.filter((item) => item.kind !== 'unclassified' && (item.kind === 'comic' || HumbleComicLibrary.isComicItem(item))).length;
    const books = titles.filter((item) => (item.kind === 'book' || !item.kind) && !HumbleComicLibrary.isComicItem(item)).length;
    const games = titles.filter((item) => item.kind === 'game').length;
    const software = titles.filter((item) => item.kind === 'software').length;
    const audiobooks = titles.filter((item) => item.kind === 'audiobook').length;
    const videos = titles.filter((item) => item.kind === 'video').length;
    const unclassified = titles.filter((item) => item.kind === 'unclassified').length;

    const mediaCounts = [
      comics ? `${comics} comic${comics === 1 ? '' : 's'}` : '',
      books ? `${books} book${books === 1 ? '' : 's'}` : '',
      games ? `${games} game${games === 1 ? '' : 's'}` : '',
      software ? `${software} software item${software === 1 ? '' : 's'}` : '',
      audiobooks ? `${audiobooks} audiobook${audiobooks === 1 ? '' : 's'}` : '',
      videos ? `${videos} video${videos === 1 ? '' : 's'}` : '',
      unclassified ? `${unclassified} unclassified` : ''
    ].filter(Boolean).join(', ');
    const nativeGroups = latestGroupModel.groups.filter(group => group.source === 'native').length;
    count.textContent = `${titles.length} unique item${titles.length === 1 ? '' : 's'} stored locally${mediaCounts ? ` (${mediaCounts})` : ''}. ${purchaseSummaries.length} ${latestGroupModel.native.present ? 'historical purchase records' : 'purchase records'} (${pricedPurchases} with a captured price).${latestGroupModel.native.present ? ` ${nativeGroups} synced Humble Library purchase groups.` : ''}`;
    lastImport.textContent = summary
      ? `Last purchase-page import (before Humble's 2026 redesign): ${summary.addedTitles} item${summary.addedTitles === 1 ? '' : 's'} added${summary.addedGames || summary.addedSoftware || summary.addedAudiobooks ? ` (${[summary.addedGames ? `${summary.addedGames} game${summary.addedGames === 1 ? '' : 's'}` : '', summary.addedSoftware ? `${summary.addedSoftware} software item${summary.addedSoftware === 1 ? '' : 's'}` : '', summary.addedAudiobooks ? `${summary.addedAudiobooks} audiobook${summary.addedAudiobooks === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')})` : ''}${summary.datesBackfilled ? ` and ${summary.datesBackfilled} purchase date${summary.datesBackfilled === 1 ? '' : 's'} backfilled` : ''}; ${summary.scannedPurchases} purchase${summary.scannedPurchases === 1 ? '' : 's'} scanned${summary.skippedKnown ? ` and ${summary.skippedKnown} already-scanned purchase${summary.skippedKnown === 1 ? '' : 's'} skipped` : ''} on ${new Date(summary.importedAt).toLocaleString()}.`
      : '';
    if (summary?.fullRescan) {
      lastImport.textContent += summary.reconciled
        ? ' Current Humble snapshot reconciled; historical evidence archived.'
        : ' Scan incomplete; previous entries retained. Repeat a full rescan to reconcile.';
    }

    const { rejectedPurchaseItems = [], mediaImportVersion = 1, mediaTypeOverrides = {} } = state;
    const overrideCount = Object.keys(mediaTypeOverrides).length;
    const diagnostics = document.querySelector('#library-classification-diagnostics');
    if (diagnostics) {
      diagnostics.replaceChildren();
      const summaryList = document.createElement('div');
      summaryList.className = 'library-diagnostics-pills';
      const pills = [
        { label: 'Comics', count: comics },
        { label: 'Books', count: books },
        { label: 'Games', count: games },
        { label: 'Software', count: software },
        { label: 'Audiobooks', count: audiobooks },
        { label: 'Videos', count: videos },
        { label: 'Unclassified', count: unclassified },
        { label: 'Unimported / Rejected', count: rejectedPurchaseItems.length }
      ];
      if (overrideCount > 0) pills.push({ label: 'Manual overrides', count: overrideCount });

      for (const p of pills) {
        const span = document.createElement('span');
        span.className = 'library-diag-pill';
        span.textContent = `${p.label}: ${p.count}`;
        summaryList.append(span);
      }
      diagnostics.append(summaryList);

      if (mediaImportVersion < HumbleComicLibrary.CURRENT_IMPORT_VERSION && purchaseSummaries.length > 0) {
        const note = document.createElement('p');
        note.className = 'library-rescan-tip';
        note.textContent = 'Some purchases were saved before Humble changed its site and keep the details recorded then. Run Sync full Library in your Humble Library to also save the details Humble lists today.';
        diagnostics.append(note);
      }
    }

    const rejectedSection = document.querySelector('#library-rejected-section');
    const rejectedCount = document.querySelector('#library-rejected-count');
    const rejectedList = document.querySelector('#library-rejected-list');
    const rejectedEmpty = document.querySelector('#library-rejected-empty');
    const rejectedActions = document.querySelector('#library-rejected-actions');
    const dismissAllBtn = document.querySelector('#library-dismiss-all-rejected');

    if (rejectedSection && rejectedCount && rejectedList) {
      rejectedSection.hidden = false;
      rejectedCount.textContent = String(rejectedPurchaseItems.length);
      if (rejectedPurchaseItems.length > 0) {
        if (rejectedEmpty) rejectedEmpty.hidden = true;
        if (rejectedActions) rejectedActions.hidden = false;
        if (dismissAllBtn) {
          dismissAllBtn.onclick = async () => {
            try {
              await HumbleComicLibrary.storageRequest('dismissRejectedItem', null);
              await render();
            } catch (err) {
              alert(`Dismissal failed: ${err.message}`);
            }
          };
        }
        rejectedList.replaceChildren(...rejectedPurchaseItems.map((rec) => {
          const li = document.createElement('li');
          li.className = 'library-rejected-item';
          const titleSpan = document.createElement('strong');
          titleSpan.textContent = rec.title;
          const metaSpan = document.createElement('span');
          metaSpan.className = 'library-rejected-meta';
          const rejFormats = Array.isArray(rec.formats) ? rec.formats : null;
          const formatsText = rejFormats && rejFormats.length > 0
            ? `Formats: ${rejFormats.map(f => f.startsWith('.') ? f : (/^[a-z0-9]{2,10}$/iu.test(f) ? '.' + f.toLowerCase() : f)).join(', ')}`
            : rejFormats && rejFormats.length === 0
            ? (rec.entitlement === 'direct-download' || rec.delivery === 'direct-download' ? 'No file formats in purchase metadata' : '')
            : (rec.entitlement === 'direct-download' || rec.delivery === 'direct-download' ? 'Format details require library rescan' : '');
          const deliveryText = rec.delivery === 'streaming' ? 'Streaming' : (rec.entitlement === 'third-party-key' || rec.delivery === 'third-party-key' ? (rec.keyType ? `Key: ${rec.keyType}` : 'External key') : (rec.entitlement === 'direct-download' || rec.delivery === 'direct-download' ? 'Direct download' : ''));
          const parts = [
            rec.sourceBundle ? `Bundle: ${rec.sourceBundle}` : '',
            deliveryText,
            formatsText,
            rec.reason || 'Unverified content'
          ].filter(Boolean);
          metaSpan.textContent = ` (${parts.join(' · ')})`;

          const recoverSelect = document.createElement('select');
          recoverSelect.className = 'library-recover-select';
          recoverSelect.setAttribute('aria-label', `Recover category for ${rec.title}`);
          const kinds = [
            { value: 'unclassified', label: 'Unclassified' },
            { value: 'video', label: 'Video' },
            { value: 'comic', label: 'Comic' },
            { value: 'book', label: 'Book' },
            { value: 'software', label: 'Software' },
            { value: 'game', label: 'Game' },
            { value: 'audiobook', label: 'Audiobook' }
          ];
          for (const k of kinds) {
            const opt = document.createElement('option');
            opt.value = k.value;
            opt.textContent = k.label;
            recoverSelect.append(opt);
          }

          const recoverBtn = document.createElement('button');
          recoverBtn.type = 'button';
          recoverBtn.className = 'secondary library-recover-btn';
          recoverBtn.textContent = 'Import to library';
          recoverBtn.addEventListener('click', async () => {
            try {
              await HumbleComicLibrary.storageRequest('recoverRejectedItem', rec, recoverSelect.value);
              await render();
            } catch (err) {
              alert(`Recovery failed: ${err.message}`);
            }
          });

          const dismissBtn = document.createElement('button');
          dismissBtn.type = 'button';
          dismissBtn.className = 'secondary library-dismiss-btn';
          dismissBtn.textContent = 'Dismiss';
          dismissBtn.addEventListener('click', async () => {
            try {
              await HumbleComicLibrary.storageRequest('dismissRejectedItem', rec);
              await render();
            } catch (err) {
              alert(`Dismissal failed: ${err.message}`);
            }
          });

          li.append(titleSpan, metaSpan, ' ', recoverSelect, ' ', recoverBtn, ' ', dismissBtn);
          return li;
        }));
      } else {
        if (rejectedEmpty) rejectedEmpty.hidden = false;
        if (rejectedActions) rejectedActions.hidden = true;
        rejectedList.replaceChildren();
      }
    }
    const history = state;
    document.querySelector('#share-hb-profile').textContent=history.humbleProfileLabel||'Not yet named';
    document.querySelector('#share-hb-profile').dataset.profileLabel=history.humbleProfileLabel;
    if (!live) document.querySelector('#confirm-reminder-sharing').checked=false;
    count.textContent += ` Active account nickname: ${history.humbleProfileLabel||'Not yet named'}. ${history.profileArchives.length} other saved accounts (selectable above; excluded from active matching). History archive: ${history.historicalLibraryItems.length} titles and ${history.historicalPurchaseSummaries.length} purchase observations (current-account titles may appear as Check ownership; never Owned).`;
    if (chrome.storage?.local?.getBytesInUse) {
      try {
        const bytes = await new Promise((resolve) => chrome.storage.local.getBytesInUse(null, resolve));
        if (typeof bytes === 'number' && Number.isFinite(bytes)) {
          const mb = (bytes / 1024 / 1024).toFixed(2);
          count.textContent += ` Storage usage: ${mb} MB.`;
        }
      } catch (_) {}
    }
    const context = live ? captureBrowserContext() : null;
    renderLibraryBrowser(items);
    restoreBrowserContext(context);
    mappingCount.textContent = `${HumbleCollectionMappings.builtIn.length} built-in verified collection mapping${HumbleCollectionMappings.builtIn.length === 1 ? '' : 's'} and ${customCollectionMappings.length} custom mapping${customCollectionMappings.length === 1 ? '' : 's'} stored locally.`;
    humbleExtensionId.textContent = chrome.runtime.id;
    document.querySelector('#builtin-galactic-id').textContent=HumbleComicLibrary.builtinGalacticId(chrome.runtime);
    if (!live) {
      showDiagnostics.checked = diagnosticsEnabled;
      galacticLibraryExtensionId.value = savedGalacticLibraryExtensionId;
      galacticLibraryLinkStatus.textContent = galacticLibraryExtensionId.value
        ? 'Saved override retained. Connection not yet verified; check the connection.'
        : 'Automatic Galactic Library pairing ready. Connection not yet verified; check the connection.';
    }
    renderLibrarySync(libraryEntitlements, humbleAccountId);
    reminderState.library = {libraryEntitlements, humbleAccountId, humbleProfileLabel: state.humbleProfileLabel, libraryItems: items, keyReminders};
    reminderState.reviews = state.humbleKeyReviews ?? {};
    refreshKeyReminders();
    refreshStats.renders++;
    if (live) refreshStats.liveRenders++;
    refreshStats.lastRenderMs = clock() - started;
  }

  // Live refreshes keep expanded rows open and the list where it was, when the same rows remain.
  const rowKeys = row => String(row?.dataset?.rowKeys ?? '').split('\n').filter(Boolean);
  const ownDetails = row => [...(row.children ?? [])].find(child => child.tagName === 'DETAILS');
  function captureBrowserContext() {
    if (!preview?.getBoundingClientRect) return null;
    const rows = [...preview.children], top = preview.getBoundingClientRect().top;
    const anchor = rows.find(row => row.getBoundingClientRect().bottom > top);
    return { open: new Set(rows.filter(row => ownDetails(row)?.open).flatMap(rowKeys)), scrollTop: preview.scrollTop,
      anchor: anchor ? { keys: rowKeys(anchor), offset: anchor.getBoundingClientRect().top - top } : null };
  }
  function restoreBrowserContext(context) {
    if (!context) return;
    const rows = [...preview.children];
    for (const row of rows) { const details = ownDetails(row); if (details && !details.open && rowKeys(row).some(key => context.open.has(key))) details.open = true; }
    const align = () => {
      const anchor = context.anchor && rows.find(row => row.isConnected && rowKeys(row).some(key => context.anchor.keys.includes(key)));
      if (anchor) preview.scrollTop += anchor.getBoundingClientRect().top - preview.getBoundingClientRect().top - context.anchor.offset;
      else preview.scrollTop = context.scrollTop;
    };
    align();
    // Reopened purchases render their contents on the toggle event; align again once they have.
    setTimeout(align, 0);
  }

  function renderLibrarySync(libraryEntitlements, humbleAccountId) {
    const status = document.querySelector('#library-sync-status');
    if (!status) return;
    const E = globalThis.HumbleLibraryEntitlements;
    let view = null;
    try { view = E?.ENABLED && libraryEntitlements ? E.syncView({ libraryEntitlements, humbleAccountId }) : null; } catch { status.textContent = 'Saved Library records could not be read. Your other purchases are unaffected; restore a backup if this continues.'; return; }
    const cp = view?.checkpoint, number = v => v.toLocaleString(), date = v => new Date(v).toLocaleDateString();
    if (!cp) { status.textContent = view?.saved ? `${number(view.saved)} Humble Library items saved for this account.` : 'Not synced from your Humble Library yet.'; return; }
    const parts = [`${number(view.saved)} Humble Library item${view.saved === 1 ? '' : 's'} saved for this account.`];
    if (['running', 'paused', 'stopped'].includes(cp.status)) parts.push(`A ${cp.mode === 'refresh' ? 'recent-purchase check' : 'full sync'} is unfinished (${number(Math.min(cp.nextPage - 1, cp.targetPages))} of ${number(cp.targetPages)} pages read). Open Humble Library and select Resume.`);
    if (cp.lastFull) parts.push(`Last full sync finished ${date(cp.lastFull.completedAt)}${cp.lastFull.coverage === 'accessible-pages-traversed' ? '.' : '; some items may have been missed, so run it again later.'}`);
    else if (cp.status === 'completed' || cp.status === 'cancelled') parts.push('No full sync has finished yet; run one to check your whole Library.');
    if (cp.status === 'completed' && cp.mode === 'refresh') parts.push(`Recent purchases checked ${date(cp.updatedAt)}.`);
    if (view.undetailed) parts.push(`${number(view.undetailed)} item${view.undetailed === 1 ? ' was' : 's were'} saved before download details were read, so ${view.undetailed === 1 ? 'its' : 'their'} media may be unknown. Run the full sync again on the Humble Library page to identify ${view.undetailed === 1 ? 'it' : 'them'} for bundle-page checks and Galactic Library.`);
    if (cp.unresolved) parts.push(`${number(cp.unresolved)} item${cp.unresolved === 1 ? '' : 's'} could not be verified and ${cp.unresolved === 1 ? 'was' : 'were'} not saved.`);
    status.textContent = parts.join(' ');
  }

  const reminderState = {library: null, reviews: {}, rows: [], timer: null};
  const reminderFilter = document.querySelector('#key-reminder-filter');
  const reminderSearch = document.querySelector('#key-reminder-search');
  const reminderActionStatus = document.querySelector('#key-reminder-action-status');
  const reminderDate = date => Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleDateString() : '';

  function refreshKeyReminders() {
    if (!reminderState.library || !globalThis.HumbleLibraryBrowser) return;
    const now = Date.now();
    reminderState.rows = HumbleLibraryBrowser.unifiedKeyReminders(reminderState.library, latestReconciliation?.groups, reminderState.reviews, now);
    clearTimeout(reminderState.timer);
    let next = Infinity;
    for (const row of reminderState.rows) {
      if (row.reviewState === 'snoozed') next = Math.min(next, Date.parse(row.review.until));
      const deadline = Date.parse(row.availableUntil);
      if (!row.expired && deadline > now) next = Math.min(next, row.expiring ? deadline : deadline - 30 * 86400000);
    }
    if (Number.isFinite(next)) {
      reminderState.timer = setTimeout(refreshKeyReminders, Math.min(60000, Math.max(1, next - now + 5)));
      reminderState.timer?.unref?.();
    }
    renderKeyReminders();
  }

  function renderKeyReminders() {
    const filter = reminderFilter.value || 'active', query = (reminderSearch.value || '').trim().toLowerCase();
    const filtered = reminderState.rows.filter(row => {
      // Active: a key known not to be redeemed, not dismissed, snoozed or past its deadline (as in Fanatical Library).
      const matchesView = ['dismissed', 'snoozed'].includes(filter) ? row.reviewState === filter
        : filter === 'hidden' ? row.reviewState !== 'active'
        : row.reviewState === 'active' && (filter === 'active' && !row.expired && row.status !== 'needs-review' || filter === 'expired' && row.expired
          || filter === 'expiring' && row.expiring || filter === 'unknown' && row.status === 'needs-review' && !row.expired);
      return matchesView && [row.title, row.bundle].some(value => value?.toLowerCase().includes(query));
    });
    keyReminderSummary.textContent = filtered.length
      ? filtered.length.toLocaleString() + ' ' + (filtered.length === 1 ? 'reminder' : 'reminders')
      : 'No reminders match this view.';
    keyReminderList.replaceChildren(...filtered.map(keyReminderCard));
  }

  function keyReminderCard(row) {
    const card = document.createElement('li');
    card.className = 'key-reminder-card';
    card.dataset.keyReminderState = row.expired ? 'expired' : row.expiring ? 'soon' : 'normal';
    const part = (tag, css, value) => {
      const node = document.createElement(tag);
      node.className = css;
      node.textContent = value;
      return node;
    };
    const heading = part('div', 'key-reminder-heading', '');
    const badge = row.reviewState === 'dismissed' ? 'Dismissed' : row.reviewState === 'snoozed' ? 'Snoozed until ' + reminderDate(row.review.until)
      : row.status === 'expired' ? 'Expired' : row.expired ? 'Past reported deadline' : row.expiring ? 'Expiring soon'
      : row.status === 'needs-review' ? 'Key status unknown' : row.native ? 'Not yet redeemed' : 'Reported unrevealed';
    heading.append(part('span', '', row.title), part('span', 'key-reminder-status', badge));
    const purchaseDate = Number.isFinite(Date.parse(row.purchasedAt)) ? formatPurchaseDate(Date.parse(row.purchasedAt)) : '';
    const context = [row.bundle || 'Humble purchase', purchaseDate ? 'Purchased ' + purchaseDate : 'Purchase date unknown'].join(' \u00b7 ');
    const evidence = row.status === 'needs-review' ? (row.native ? 'Humble does not report whether this key was redeemed.' : 'Redemption status unknown.')
      : row.status === 'expired' ? 'Humble reported this key expired.'
      : row.native ? 'Humble reports this key as not yet redeemed.' : 'Earlier import reported this key unrevealed.';
    const details = [evidence, row.keyType ? 'Key type: ' + row.keyType + '.' : '', row.directRedeem ? 'Direct redemption reported.' : '',
      row.combined ? 'Also recorded in an earlier import.' : '', row.availableUntil ? 'Reported deadline ' + reminderDate(row.availableUntil) + '.' : '',
      row.checkedAt ? 'Checked ' + reminderDate(row.checkedAt) + '.' : '', 'Activation is unknown.'].filter(Boolean).join(' ');
    card.append(heading, part('div', 'key-reminder-source', context), part('div', 'key-reminder-meta', details));
    if (row.destination) {
      const note = row.destination.kind === 'library' ? REMINDER_FALLBACK_TEXT[row.destination.reason] || REMINDER_FALLBACK_TEXT.unmatched
        : 'Likely the same order as \u201c' + row.destination.name + '\u201d in your Humble Library.';
      card.append(part('div', 'key-reminder-destination', note));
    }
    const actions = part('div', 'key-reminder-actions', '');
    const button = (text, action, secondary = false) => {
      const control = part('button', secondary ? 'secondary' : '', text);
      control.type = 'button';
      control.addEventListener('click', action);
      actions.append(control);
    };
    if (row.itemUrl) button('Open item', () => openOnHumble(row.itemUrl));
    if (row.purchaseUrl) button('Open purchase', () => openOnHumble(row.purchaseUrl), Boolean(row.itemUrl));
    if (!row.itemUrl && !row.purchaseUrl) button('Find in Library', () => chrome.tabs.create({url:'https://www.humblebundle.com/home/library'}));
    const scope = {accountId: reminderState.library.humbleAccountId ?? null, label: reminderState.library.humbleProfileLabel || ''};
    const review = (label, action) => button(label, async event => {
      const now = Date.now(), control = event?.currentTarget;
      if (control) control.disabled = true;
      const updates = Object.fromEntries(row.targets.map(({ref, basis}) => [ref, {action, basis, updatedAt: new Date(now).toISOString(),
        until: action === 'snoozed' ? new Date(now + 7 * 86400000).toISOString() : null}]));
      try {
        await HumbleComicLibrary.storageRequest('patch', {humbleKeyReviews: updates}, scope);
        await render();
        reminderActionStatus.textContent = 'Reminder review saved.';
      } catch (error) {
        if (control) control.disabled = false;
        reminderActionStatus.textContent = 'Could not save this reminder review: ' + error.message;
      }
    }, true);
    if (row.reviewState !== 'active') review('Restore reminder', 'active');
    else { review('Dismiss reminder', 'dismissed'); review('Snooze 7 days', 'snoozed'); }
    card.append(actions);
    return card;
  }

  reminderFilter.addEventListener('change', () => { keyReminderList.scrollTop = 0; renderKeyReminders(); });
  reminderSearch.addEventListener('input', () => { keyReminderList.scrollTop = 0; renderKeyReminders(); });

  const REMINDER_FALLBACK_TEXT = {
    'not-synced': 'Sync your Humble Library to link this reminder to its purchase. Until then, find the title in your Library.',
    repeat: 'You bought this more than once, and the Library does not show which purchase this key belongs to. Find the title in your Library.',
    ambiguous: 'More than one Library purchase could be this order. Find the title in your Library.',
    conflicting: 'The Library purchase with this name lists different items. Find the title in your Library.',
    unmatched: 'This order could not be linked to a single Library purchase. Find the title in your Library.',
    'no-record': 'This order could not be linked to a single Library purchase. Find the title in your Library.'
  };

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
    showMatchDetails = showDiagnostics.checked;
    renderLibraryBrowser();
  });

  backupFileInput.addEventListener('change', async () => {
    const [file] = backupFileInput.files;
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      HumbleComicLibrary.restoreBackupState(backup);
      if (!confirm(`Add this backup to your saved library?\n\nPurchases, titles, reminders, corrections and saved accounts already in this browser are kept; the backup adds what is missing. A saved account that is not in the backup stays as a saved account.\n\nWishlist: ${backup.wishlistItems === undefined ? 'this backup has no wishlist, so your wishlist does not change' : 'wishes missing here are added; your current wishes are kept'}.\nReminder reviews: the newer decision is kept for each key.`)) return;
      const result = await HumbleComicLibrary.storageRequest('restore', backup);
      restoreStatus.textContent = `Backup restored. The active account now has ${result.items} items, ${result.purchases} purchases and ${result.reminders} reminders; ${result.wishes} wishlist items; ${result.accounts} saved account${result.accounts === 1 ? '' : 's'}. Nothing already saved was removed.`;
      await render();
    } catch (error) {
      restoreStatus.textContent = `Restore failed: ${error.message}`;
    } finally {
      backupFileInput.value = '';
    }
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
      galacticLibraryLinkStatus.textContent = 'Connected to Galactic Library. You can now check bundle items against your other saved libraries.';
      const details = document.createElement('details');
      details.className = 'settings-help';
      const summary = document.createElement('summary');
      summary.textContent = 'Show technical details';
      const info = document.createElement('p');
      info.textContent = `Galactic Library ${response.appVersion || 'connected'}. ${response.advertised ? 'Supported media: ' + response.mediaTypes.join(', ') + '.' : 'Capabilities not advertised; newer features remain unconfirmed.'}`;
      details.append(summary, info);
      galacticLibraryLinkStatus.append(details);
    } catch (error) {
      galacticLibraryLinkStatus.textContent = "Could not connect to Galactic Library. Make sure it's installed and enabled, then try Check connection again.";
      const details = document.createElement('details');
      details.className = 'settings-help';
      const summary = document.createElement('summary');
      summary.textContent = 'Show technical details';
      const err = document.createElement('p');
      err.textContent = `Error: ${error.message}. If using an unpacked build, check that this extension's ID is authorized in Galactic Library Advanced settings.`;
      details.append(summary, err);
      galacticLibraryLinkStatus.append(details);
    }
  });

  document.querySelector('#clear-galactic-library-link').addEventListener('click', async () => {
    await HumbleComicLibrary.storageRemove('galacticLibraryExtensionId');
    galacticLibraryExtensionId.value = '';
    galacticLibraryLinkStatus.textContent = 'Override removed. Automatic Galactic Library pairing remains available; check the connection.';
  });

  document.querySelector('#open-purchases').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.humblebundle.com/home/library' });
  });

  document.querySelector('#export-library').addEventListener('click', async () => {
    const saved = await chrome.storage.local.get({...HumbleComicLibrary.LIBRARY_STATE_DEFAULTS, humbleKeyReviews: {}, wishlistItems: []});
    const contents = JSON.stringify(HumbleComicLibrary.createLibraryBackup(saved), null, 2);
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'humble-library-export.json' });
    link.click();
    URL.revokeObjectURL(url);
  });

  for(const format of ['json','csv'])document.querySelector(format==='csv'?'#export-catalog-csv':'#export-catalog').addEventListener('click',async()=>{
    const status=document.querySelector('#local-status');
    try {
      const saved=await chrome.storage.local.get({libraryItems:[],purchaseSummaries:[],libraryEntitlements:null,humbleAccountId:null,mediaTypeOverrides:{}});
      const model=HumbleLibraryBrowser.buildGroups({items:saved.libraryItems,...saved});
      const reconciliation=model.native.present?HumbleLibraryBrowser.reconcile(model.groups):null;
      const links=model.native.present?HumbleLibraryBrowser.titleLinks(model.groups,reconciliation):null;
      const titles=[...titleRows(saved.libraryItems),...HumbleLibraryBrowser.nativeOnlyTitles(model,saved.libraryItems,links)];
      const catalog=HumbleComicLibrary.createTitleCatalog(titles);
      const url=URL.createObjectURL(new Blob([format==='csv'?HumbleComicLibrary.createTitleCatalogCsv(titles,item=>catalogPurchases(item,links)):JSON.stringify(catalog,null,2)],{type:format==='csv'?'text/csv;charset=utf-8':'application/json'}));
      Object.assign(document.createElement('a'),{href:url,download:'humble-title-catalog.'+format}).click();setTimeout(()=>URL.revokeObjectURL(url),0);
      status.textContent='Exported catalog titles and identity metadata only; this is not a recoverable ownership backup.';
    }catch(error){status.textContent='Could not export the title catalog: '+error.message;}
  });

  document.querySelector('#clear-library').addEventListener('click', async () => {
    if (!confirm('Clear all saved accounts and every locally stored title, purchase record, key reminder, import history, historical purchase archive, and custom collection mapping? Your wishlist, display preferences, sharing preference and Galactic Library link will be kept. Turn automatic sharing off first if you do not want Galactic Library to send its saved purchases back.')) return;
    await HumbleComicLibrary.storageRemove([...Object.keys(HumbleComicLibrary.LIBRARY_STATE_DEFAULTS), 'hclPurchaseFocus', 'humbleKeyReviews']);
    status.textContent = 'Library, purchase history, key reminders, and custom mappings cleared.';
    await render();
  });
  LibraryAccountProfiles.mount(document.querySelector('#account-profiles'),{request:HumbleComicLibrary.storageRequest,keys:['humbleProfileLabel','profileArchives'],onActiveChange:()=>render()});
  globalThis.LibraryBrowser = {
    consolidateItemInto,
    filterAndSortLibrary,
    getItemPurchaseDate,
    getState: () => ({ ...libraryBrowserState }),
    setState: (next) => { Object.assign(libraryBrowserState, next); saveLibraryState(libraryBrowserState); renderLibraryBrowser(); },
    render: () => renderLibraryBrowser(),
    getGroups: () => latestGroupModel,
    getReconciliation: () => latestReconciliation,
    getTitleLinks: () => latestTitleLinks,
    getRefreshStats: () => ({ ...refreshStats, pending: Boolean(liveTimer) || queuedRenders > 0 }),
    renderOptions: () => render()
  };
  // Live refresh. A syncing Humble tab, the worker or another extension page changes storage;
  // this page follows without a reload. Sync progress alone (checkpoints) only updates the sync
  // summary. Changed library data reloads the model from storage once per burst, and while a
  // sync streams batches, rebuilds are spaced to stay a small share of the time.
  const MODEL_KEYS = ['libraryItems', 'purchaseSummaries', 'humbleAccountId', 'mediaTypeOverrides'];
  const DATA_KEYS = Object.keys(HumbleComicLibrary.LIBRARY_STATE_DEFAULTS).filter(key => key !== 'libraryEntitlements');
  let liveTimer = null, lastLiveAt = 0;
  function scheduleLiveRefresh() {
    if (liveTimer) return;
    const wait = Math.max(250, lastLiveAt + Math.max(1000, refreshStats.lastRenderMs * 4) - Date.now());
    liveTimer = setTimeout(() => { liveTimer = null; lastLiveAt = Date.now(); render({ live: true }).catch(() => {}); }, wait);
  }
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    try {
      if (MODEL_KEYS.some(key => Object.hasOwn(changes, key))) modelDirty = true;
      let data = DATA_KEYS.some(key => Object.hasOwn(changes, key));
      if (changes.libraryEntitlements) {
        const next = changes.libraryEntitlements.newValue ?? null;
        const signature = globalThis.HumbleLibraryBrowser ? HumbleLibraryBrowser.nativeSignature(next, renderedAccountId) : null;
        if (signature !== knownSignature) { knownSignature = signature; modelDirty = true; data = true; }
        else if (!data) { refreshStats.progressOnly++; renderLibrarySync(next, renderedAccountId); }
        // Key redemption can change without changing the Library titles; the key list is cheap to redraw.
        if (!data && reminderState.library) { reminderState.library = { ...reminderState.library, libraryEntitlements: next }; refreshKeyReminders(); }
      }
      if (changes.humbleKeyReviews && !data) { reminderState.reviews = changes.humbleKeyReviews.newValue ?? {}; refreshKeyReminders(); }
      if (data) scheduleLiveRefresh();
    } catch {}
  });
  render();
}());
