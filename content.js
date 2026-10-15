const catalogueExpiryByOffer = new Map();
const REDACTED_REDEMPTION_KEY_VALUE = '__HCL_REDACTED_REDEMPTION_KEY_VALUE__';
const GALACTIC_LIBRARY_API_VERSION = 1;
// Bump only when saved purchases need new extraction, not for every release.
const CURRENT_IMPORT_VERSION = HumbleComicLibrary.CURRENT_IMPORT_VERSION;
// Reading and validating a large private GL database, then matching a bounded
// batch, can exceed a few seconds. Keep a finite deadline with room for that work.
const GALACTIC_LIBRARY_REQUEST_TIMEOUT_MS = 30000;
// Media types accepted by Galactic Library's version-1 MATCH_ITEMS contract.
// Software requests require an advertised capability; older GL stays local.
const GALACTIC_LIBRARY_MEDIA_TYPES = new Set(['book', 'game', 'audiobook', 'software']);
const PURCHASE_FOCUS_MAX_AGE_MS = 15 * 60 * 1000;
let purchaseFocusTimer;
let bundleSummaryPreferences = {minimized:false,position:'bottom-right'};
let galacticDiagnosticSequence=0;
const galacticDiagnosticPrefix=(globalThis.crypto?.randomUUID?.().replaceAll('-','')??Math.random().toString(16).slice(2).padEnd(12,'0')).slice(0,12);
const galacticDiagnosticNow=()=>Number.isFinite(globalThis.performance?.timeOrigin)?performance.timeOrigin+performance.now():Date.now();
const galacticPageStartedEpochMs=galacticDiagnosticNow();
async function sendGalacticMatch(extensionId,request,diagnostic=null){
  const id='lookup-'+galacticDiagnosticPrefix+'-'+String(++galacticDiagnosticSequence).padStart(3,'0');
  const sent=galacticDiagnosticNow();
  const response=await chrome.runtime.sendMessage(extensionId,{...request,diagnosticLookupId:id,diagnosticSentEpochMs:sent,
    ...(diagnostic?{diagnosticHb:{beforeSendMs:Math.max(0,sent-galacticPageStartedEpochMs),localStorageMs:diagnostic.storageMs,preparationMs:Math.max(0,diagnostic.ready-diagnostic.started),previousFlightMs:diagnostic.previousFlightMs??0}}:{})});
  const callback=galacticDiagnosticNow();
  // Builds without timing support omit performance. Reporting is best effort and must
  // never delay, reject or change the ownership response, even after a timeout.
  if(response?.performance?.id===id){
    diagnostic?.requests.push({extensionId,id,callback});
    try{Promise.resolve(chrome.runtime.sendMessage(extensionId,{type:'MATCH_ITEMS_DIAGNOSTIC_CALLBACK',apiVersion:1,diagnosticLookupId:id,diagnosticCallbackEpochMs:callback})).catch(()=>{});}catch{}
  }
  return response;
}
function finishGalacticRendering(diagnostic){
  const rendered=galacticDiagnosticNow();
  for(const {extensionId,id,callback} of diagnostic.requests){try{Promise.resolve(chrome.runtime.sendMessage(extensionId,{type:'MATCH_ITEMS_DIAGNOSTIC_RENDER',apiVersion:1,diagnosticLookupId:id,diagnosticCallbackEpochMs:callback,diagnosticHb:{postResponseMs:Math.max(0,rendered-callback),pageToRenderedMs:Math.max(0,rendered-galacticPageStartedEpochMs),renderOutcome:diagnostic.renderOutcome??'incomplete'}})).catch(()=>{});}catch{}}
}

(async function initialiseHumbleComicLibrary() {
  'use strict';

  if (location.pathname.startsWith('/home/purchases')) {
    ensurePurchaseImporter();
    schedulePurchaseFocus();
    let importerTimer;
    new MutationObserver(() => {
      schedulePurchaseFocus();
      if (document.querySelector('#hcl-importer')) return;
      clearTimeout(importerTimer);
      importerTimer = setTimeout(ensurePurchaseImporter, 100);
    }).observe(document.documentElement, { childList: true, subtree: true });
    return;
  }

  if (isBundleCataloguePage()) {
    const storage = await chrome.storage.local.get({ purchaseSummaries: [], showDiagnostics: false, catalogueFilters: {} });
    const { purchaseSummaries = [], showDiagnostics = false } = storage;
    let filters = normaliseCatalogueFilters(storage.catalogueFilters);
    let refreshTimer;
    const refresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => renderCataloguePurchaseMarkers(purchaseSummaries, showDiagnostics, filters, (nextFilters) => {
        filters = normaliseCatalogueFilters(nextFilters);
        HumbleComicLibrary.storageSet({ catalogueFilters: filters }).catch(() => {});
        refresh();
      }), 150);
    };
    refresh();
    new MutationObserver((records) => {
      if (records.some(record => recordHasExternalAddition(record) || recordHasCatalogueTimingChange(record))) refresh();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'data-countdown'] });
    return;
  }

  const itemKind = location.pathname.startsWith('/books/') ? 'book'
    : location.pathname.startsWith('/games/') ? 'game'
      : location.pathname.startsWith('/software/') ? 'software' : null;
  if (!itemKind) return;

  const comparison = { startedAt: performance.now(), refreshes: 0, storageMs: null, lastMatchMs: null, itemCount: 0, libraryCount: 0, completedItems: 0, emptyChecks: 0, job: 0, showDiagnostics: false, showNewItemsOnly: false, galactic: null };
  showComparisonProgress('Loading your local library…');
  const storageDefaults = { libraryItems: [], historicalLibraryItems: [], purchaseSummaries: [], customCollectionMappings: [], showDiagnostics: false, showNewItemsOnly: false, galacticLibraryExtensionId: '', wishlistItems: [], bundleSummaryPreferences: {} };
  // Subscribe before the first await. An import/profile restore can finish
  // while a cold storage read is still returning its older snapshot.
  let storageRevision = 0;
  let storageChanged;
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    storageRevision++;
    storageChanged?.(changes, area);
  });
  const readCurrentStorage = async () => {
    let snapshot, revision;
    do {
      revision = storageRevision;
      snapshot = await chrome.storage.local.get(storageDefaults);
    } while (revision !== storageRevision);
    return snapshot;
  };
  const storage = await readCurrentStorage();
  bundleSummaryPreferences = HumbleComicLibrary.normalizeSummaryPreferences(storage.bundleSummaryPreferences);
  comparison.showDiagnostics = storage.showDiagnostics;
  comparison.showNewItemsOnly = storage.showNewItemsOnly;
  comparison.wishlistItems = storage.wishlistItems;
  let libraryItems = storage.libraryItems.filter((item) => item.kind === itemKind || (itemKind === 'book' && (!item.kind || item.kind === 'audiobook' || item.kind === 'comic')));
  comparison.storageMs = Math.round(performance.now() - comparison.startedAt);
  comparison.libraryCount = libraryItems.length;
  comparison.galactic = createGalacticLookup(storage.galacticLibraryExtensionId);
  let currentBundlePurchases = findCurrentBundlePurchases(storage.purchaseSummaries);
  let libraryMatcher = createBundleLibraryMatcher(libraryItems, itemKind, storage.historicalLibraryItems);
  let collectionMappings = [...HumbleCollectionMappings.builtIn, ...(Array.isArray(storage.customCollectionMappings) ? storage.customCollectionMappings : [])];
  let refreshTimer;
  const refresh = (reason = 'update') => {
    clearTimeout(refreshTimer);
    const job = ++comparison.job;
    comparison.refreshes += 1;
    comparison.completedItems = 0;
    document.querySelector('#hcl-summary')?.setAttribute('aria-busy', 'true');
    showComparisonProgress(reason === 'initial' ? 'Checking your library…' : 'Updating library labels…');
    // Let Humble finish its paint and image work before this potentially
    // expensive comparison. The timeout guarantees it still runs promptly on
    // a continuously busy page.
    refreshTimer = setTimeout(() => runWhenIdle(() => renderBundleComparison(libraryMatcher, itemKind, currentBundlePurchases, collectionMappings, comparison, job), 500), reason === 'initial' ? 0 : 120);
  };
  comparison.retryGalactic = () => {
    if (comparison.galactic.softwareCapabilityFailed) {
      comparison.galactic.softwareCapability = null;
      comparison.galactic.softwareCapabilityFailed = false;
    }
    refresh('retry Galactic Library');
  };
  comparison.refreshGalactic=()=>{comparison.galactic=createGalacticLookup(comparison.galactic.extensionId);refresh('refresh Galactic Library');};
  window.addEventListener('hcl-refresh-central',()=>comparison.refreshGalactic());
  refresh('initial');
  let libraryRevision = 0;
  storageChanged = (changes, area) => {
    if(area==='local'&&changes.showDiagnostics){comparison.showDiagnostics=Boolean(changes.showDiagnostics.newValue);comparison.renderSummary?.();}
    if (area === 'local' && changes.wishlistItems) { comparison.wishlistItems=HumbleComicLibrary.normalizeWishlist(changes.wishlistItems.newValue||[]); comparison.renderSummary?.(); }
    if(area==='local'&&changes.bundleSummaryPreferences){bundleSummaryPreferences=HumbleComicLibrary.normalizeSummaryPreferences(changes.bundleSummaryPreferences.newValue);document.querySelector('#hcl-summary')?.dispatchEvent(new Event('hcl-summary-preferences'));}
    if (area !== 'local' || !['libraryItems', 'historicalLibraryItems', 'humbleProfileLabel', 'purchaseSummaries', 'customCollectionMappings', 'galacticLibraryExtensionId'].some(key => Object.hasOwn(changes, key))) return;
    const revision = ++libraryRevision;
    ++comparison.job; clearTimeout(refreshTimer); // Cancel an in-flight old-profile comparison.
    comparison.summaryView = changes.humbleProfileLabel ? null
      : captureSummaryState(document.querySelector('#hcl-summary')) ?? comparison.summaryView;
    comparison.renderSummary = null; // A UI-only update must not revive old ownership during hydration.
    clearBundleAnnotations();
    document.querySelector('#hcl-summary')?.remove(); // Do not display the previous account's ownership.
    (async () => {
      const latest = await readCurrentStorage();
      if (revision !== libraryRevision) return;
      libraryItems = latest.libraryItems.filter(item => item.kind === itemKind || itemKind === 'book' && (!item.kind || item.kind === 'audiobook' || item.kind === 'comic'));
      libraryMatcher = createBundleLibraryMatcher(libraryItems, itemKind, latest.historicalLibraryItems);
      currentBundlePurchases = findCurrentBundlePurchases(latest.purchaseSummaries);
      collectionMappings = [...HumbleCollectionMappings.builtIn, ...latest.customCollectionMappings];
      comparison.wishlistItems = latest.wishlistItems;
      comparison.libraryCount = libraryItems.length;
      comparison.galactic = createGalacticLookup(latest.galacticLibraryExtensionId);
      refresh('library updated');
    })().catch(showComparisonFailure);
  };
  window.addEventListener('resize', () => refresh('resize'), { passive: true });
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('.js-tier-filter[data-tier]')) refresh('tier changed');
  });
  let metadataFingerprint = bundleMetadataFingerprint();
  let bundleCovers = new Set([...document.querySelectorAll(HCL_COVER_SELECTOR)].filter(isBundleCover));
  new MutationObserver((records) => {
    // Humble renders covers lazily. Look only at the added/changed local
    // subtree, rather than re-querying every cover after every React update.
    const metadataChanged = records.some(recordHasBundleMetadataChange);
    const nextFingerprint = metadataChanged ? bundleMetadataFingerprint() : metadataFingerprint;
    const changedAttribute = records.some(record => record.type === 'attributes' && recordHasBundleMetadataChange(record)
      && record.oldValue !== record.target.getAttribute(record.attributeName));
    const coversChanged = records.some(record => recordHasUnannotatedCover(record, bundleCovers));
    const tierAnimationFinished = records.some(record => record.type === 'attributes' && record.attributeName === 'class'
      && record.target.matches('.tier-item-view') && /(?:^|\s)flipping(?:\s|$)/u.test(record.oldValue ?? '')
      && !record.target.classList.contains('flipping'));
    // Humble detaches and reuses annotated views when switching tiers. Track
    // mounted covers, so a returning card is processed even with old badges.
    bundleCovers = new Set([...bundleCovers].filter(cover => cover.isConnected));
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.matches(HCL_COVER_SELECTOR) && isBundleCover(node)) bundleCovers.add(node);
      for (const cover of node.querySelectorAll(HCL_COVER_SELECTOR)) if (isBundleCover(cover)) bundleCovers.add(cover);
    }
    if (coversChanged || tierAnimationFinished || metadataChanged && (nextFingerprint !== metadataFingerprint || changedAttribute)) {
      metadataFingerprint = nextFingerprint;
      refresh('bundle data updated');
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeOldValue: true,
    attributeFilter: ['alt', 'class', 'data-tier', 'data-content-type', 'data-product-type', 'data-format', 'data-isbn', 'data-asin', 'data-edition', 'data-edition-id', 'data-language', 'data-series', 'data-series-id', 'data-run', 'data-run-id', 'data-volume', 'data-issue', 'data-author'] });
}()).catch((error) => showComparisonFailure(error));

const HCL_COVER_SELECTOR = 'img.item-image[alt], img[class~="item-image"][alt]';

function isBundleCover(cover) {
  // This full-width sibling is Humble's expandable details carousel. Its
  // preview image is not a purchasable card or a sortable grid slot.
  return !cover.closest('.expanded-info-view');
}

function bundleMetadataFingerprint() {
  return JSON.stringify([document.querySelector('#webpack-bundle-page-data')?.textContent ?? '', document.querySelector('h1')?.textContent ?? '']);
}

function recordHasBundleMetadataChange(record) {
  const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
  if (target?.closest('[id^="hcl-"], .hcl-summary, .expanded-info-view')) return false;
  if (record.type === 'attributes') return !['alt', 'class'].includes(record.attributeName)
    && Boolean(target?.matches(HCL_COVER_SELECTOR) || target?.querySelector(HCL_COVER_SELECTOR));
  if (target?.closest('#webpack-bundle-page-data, h1')) return true;
  return [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === Node.ELEMENT_NODE
    && (node.matches('#webpack-bundle-page-data, h1') || node.querySelector('#webpack-bundle-page-data, h1')));
}

function recordHasExternalAddition(record) {
  return [...record.addedNodes].some((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    return !node.id?.startsWith('hcl-') && !node.classList?.contains('hcl-summary') && !node.classList?.contains('hcl-progress');
  });
}

function recordHasCatalogueTimingChange(record) {
  const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
  const link = target?.closest('a[href]');
  if (!link || !isBundleOfferLink(link)) return false;
  const card = catalogueCardContainer(link);
  const cached = catalogueExpiryByOffer.get(catalogueOfferKey(link));
  const days = catalogueDisplayedDays(card);
  const minutes = catalogueEndsInMinutes(card);
  const nextWindow = catalogueSortWindow({ displayedDays: days, endsInMinutes: minutes });
  const previousWindow = cached ? catalogueSortWindow({ displayedDays: cached.displayedDays, endsInMinutes: cached.minutes }) : null;
  // Countdown seconds change constantly. Refresh only when an expiry becomes
  // readable or the displayed day bucket changes, rather than on every tick.
  return nextWindow !== null && nextWindow !== previousWindow;
}

function runWhenIdle(callback, timeout) {
  const run = () => Promise.resolve(callback()).catch(showComparisonFailure);
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout });
  } else {
    setTimeout(run, 0);
  }
}

function recordHasUnannotatedCover(record, mountedCovers = null) {
  const uiSelector = '[id^="hcl-"], .hcl-summary, .hcl-progress, .hcl-status-button, .hcl-related-titles, details[data-hcl-related], .hcl-owned-badge, .hcl-new-badge, .hcl-possible-badge, .hcl-partial-badge, .expanded-info-view';
  const isOwnUi = node => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest?.(uiSelector);
  if (isOwnUi(record.target)) return false;
  const changed = [...record.addedNodes, ...record.removedNodes];
  if (changed.length && changed.every(isOwnUi)) return false;
  if (record.type === 'attributes' && record.attributeName === 'alt') return record.target.matches(HCL_COVER_SELECTOR) && Boolean(likelyItemTitle({textContent:record.target.alt}));
  const roots = [...record.addedNodes].filter(node => node.nodeType === Node.ELEMENT_NODE && !isOwnUi(node));
  for (const node of record.removedNodes) {
    if (node.nodeType !== Node.ELEMENT_NODE || isOwnUi(node) || node.isConnected) continue;
    if (node.matches(HCL_COVER_SELECTOR) || node.querySelector(HCL_COVER_SELECTOR)) return true;
  }
  // Provider text/hydration can complete a local card. Never expand an unrelated
  // body mutation into a scan of every cover, including unmatchable galleries.
  if (record.target instanceof Element && record.target !== document.body && record.target !== document.documentElement) roots.push(record.target);
  return roots.some((root) => {
    const covers = [];
    if (root.matches?.(HCL_COVER_SELECTOR)) covers.push(root);
    covers.push(...(root.querySelectorAll?.(HCL_COVER_SELECTOR) ?? []));
    return covers.some((cover) => isBundleCover(cover) && likelyItemTitle({ textContent: cover.alt }) && (mountedCovers && !mountedCovers.has(cover)
      || !cover.classList.contains('hcl-cover-owned') && !cover.classList.contains('hcl-cover-elsewhere') && !cover.classList.contains('hcl-cover-new') && !cover.classList.contains('hcl-cover-possible') && !cover.classList.contains('hcl-cover-partial') && !cover.classList.contains('hcl-cover-unchecked')));
  });
}

function showComparisonProgress(message, { spinning = true } = {}) {
  let progress = document.querySelector('#hcl-progress');
  if (!progress) {
    progress = document.createElement('aside');
    progress.id = 'hcl-progress';
    progress.className = 'hcl-progress';
    (document.body ?? document.documentElement).append(progress);
  }
  progress.classList.toggle('hcl-progress-static', !spinning);
  progress.textContent = message;
}

function removeComparisonProgress() {
  document.querySelector('#hcl-progress')?.remove();
}

function showComparisonFailure(error) {
  showComparisonProgress('Could not check your library. Reload the page to try again.');
  const progress = document.querySelector('#hcl-progress');
  progress.title = String(error?.message ?? error ?? 'Unknown extension error');
}

function isBundleCataloguePage() {
  return location.pathname === '/bundles' || location.pathname === '/books' || location.pathname === '/games' || location.pathname === '/software';
}

function normaliseCatalogueFilters(filters) {
  return {
    hidePurchased: Boolean(filters?.hidePurchased),
    endingSoon: Boolean(filters?.endingSoon),
  };
}

function renderCataloguePurchaseMarkers(purchaseSummaries, showDiagnostics = false, filters = {}, onFiltersChanged = () => {}) {
  const activeFilters = normaliseCatalogueFilters(filters);
  document.querySelectorAll('.hcl-catalog-purchased').forEach((card) => {
    card.classList.remove('hcl-catalog-purchased');
    delete card.dataset.hclCatalogueBadge;
    card.removeAttribute('title');
  });
  document.querySelectorAll('.hcl-catalog-filtered').forEach((card) => card.classList.remove('hcl-catalog-filtered'));
  document.querySelectorAll('.hcl-catalog-empty-row').forEach((row) => row.classList.remove('hcl-catalog-empty-row'));
  document.querySelectorAll('[data-hcl-catalog-filter]').forEach((card) => delete card.dataset.hclCatalogFilter);
  const purchasesByTitle = new Map();
  for (const purchase of purchaseSummaries) {
    const key = catalogueTitleKey(purchase.sourceBundle);
    if (!key) continue;
    const existing = purchasesByTitle.get(key) ?? [];
    existing.push(purchase);
    purchasesByTitle.set(key, existing);
  }
  const cards = new Map();
  for (const link of document.querySelectorAll('a[href]')) {
    if (!isBundleOfferLink(link)) continue;
    const title = catalogueCardTitle(link);
    const card = catalogueCardContainer(link);
    if (!card) continue;
    const purchases = purchasesByTitle.get(catalogueTitleKey(title)) ?? [];
    const timing = catalogueTimingForOffer(link, card);
    const entry = { purchases, endsInMinutes: timing.minutes, displayedDays: timing.displayedDays };
    if (!cards.has(card) || purchases.length) cards.set(card, entry);
    if (!purchases.length) continue;
    const latest = [...purchases].sort((left, right) => String(right.purchasedAt ?? '').localeCompare(String(left.purchasedAt ?? '')))[0];
    card.classList.add('hcl-catalog-purchased');
    card.dataset.hclCatalogueBadge = purchases.length > 1 ? `Purchased ${purchases.length}x` : 'Purchased';
    card.title = `Already purchased${purchases.length > 1 ? ` (${purchases.length} times)` : ''}: ${formatBundlePurchase(latest)}`;
  }
  const filteredCards = catalogueFilterStates(cards, activeFilters);
  for (const [card, filtered] of filteredCards) card.dataset.hclCatalogFilter = filtered ? 'true' : 'false';
  const sorting = sortCatalogueCards();
  applyCatalogueFilters(filteredCards);
  for (const card of filteredCards.keys()) delete card.dataset.hclCatalogFilter;
  renderCatalogueFilterControls(activeFilters, onFiltersChanged);
  if (showDiagnostics) renderCatalogueSortDiagnostics(sorting);
  else document.querySelector('#hcl-catalog-sort-diagnostics')?.remove();
}

function catalogueFilterStates(cards, filters) {
  const filteredCards = new Map();
  for (const [card, { purchases, endsInMinutes, displayedDays }] of cards) {
    const hideForPurchase = filters.hidePurchased && purchases.length > 0;
    const withinSevenDays = displayedDays !== null ? displayedDays <= 7 : endsInMinutes !== null && endsInMinutes <= 7 * 24 * 60;
    const hideForExpiry = filters.endingSoon && !withinSevenDays;
    filteredCards.set(card, hideForPurchase || hideForExpiry);
  }
  return filteredCards;
}

function applyCatalogueFilters(filteredCards) {
  const rows = new Map();
  for (const [card, filtered] of filteredCards) {
    const slot = catalogueLayoutSlot(card);
    slot.classList.toggle('hcl-catalog-filtered', filtered);
    if (slot.parentElement) {
      const slots = rows.get(slot.parentElement) ?? new Set();
      slots.add(slot);
      rows.set(slot.parentElement, slots);
    }
  }
  for (const [row, slots] of rows) {
    if (slots.size && !catalogueRowHasVisibleOffer(row)) {
      row.classList.add('hcl-catalog-empty-row');
    }
  }
}

function catalogueRowHasVisibleOffer(row) {
  for (const link of row.querySelectorAll('a[href]')) {
    if (!isBundleOfferLink(link)) continue;
    const card = catalogueCardContainer(link);
    if (card && !catalogueLayoutSlot(card).classList.contains('hcl-catalog-filtered')) return true;
  }
  return false;
}

function catalogueLayoutSlot(card) {
  // Humble's final mosaic row can contain just one tile. It still occupies a
  // normal tile-holder slot; filtering the inner card leaves an empty row gap.
  const holder = card.closest('.tile-holder');
  if (holder?.parentElement?.matches('.mosaic-layout') && catalogueOfferLinkCount(holder) === 1) return holder;
  let child = card;
  for (let parent = child.parentElement; parent && parent !== document.body; child = parent, parent = parent.parentElement) {
    const siblingSlots = [...parent.children].filter((sibling) => catalogueOfferLinkCount(sibling) === 1);
    if (siblingSlots.length >= 2 && siblingSlots.includes(child)) return child;
  }
  return card;
}

function catalogueOfferLinkCount(element) {
  const links = [];
  if (element.matches?.('a[href]')) links.push(element);
  links.push(...(element.querySelectorAll?.('a[href]') ?? []));
  return new Set(links.filter(isBundleOfferLink).map((link) => link.href)).size;
}

function renderCatalogueFilterControls(filters, onFiltersChanged) {
  document.querySelector('#hcl-catalog-filters')?.remove();
  const panel = document.createElement('aside');
  panel.id = 'hcl-catalog-filters';
  panel.className = 'hcl-catalog-filters';
  const title = document.createElement('strong');
  title.textContent = 'Catalogue filters';
  panel.append(title);
  const inputs = {};
  for (const [key, label] of [['hidePurchased', 'Hide purchased'], ['endingSoon', 'Ending within 7 days']]) {
    const field = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = filters[key];
    inputs[key] = input;
    field.append(input, ` ${label}`);
    panel.append(field);
  }
  panel.addEventListener('change', () => onFiltersChanged({
    hidePurchased: inputs.hidePurchased.checked,
    endingSoon: inputs.endingSoon.checked,
  }));
  document.body.append(panel);
}

function isBundleOfferLink(link) {
  try {
    const url = new URL(link.href, location.href);
    return url.origin === location.origin && /^\/(?:books|games|software)\/[^/]+/u.test(url.pathname);
  } catch {
    return false;
  }
}

function catalogueOfferKey(link) {
  try {
    const url = new URL(link.href, location.href);
    return `${url.pathname}${url.search}`;
  } catch {
    return '';
  }
}

function catalogueTimingForOffer(link, card) {
  const key = catalogueOfferKey(link);
  const cached = key ? catalogueExpiryByOffer.get(key) : null;
  const minutes = catalogueEndsInMinutes(card);
  const displayedDays = catalogueDisplayedDays(card);
  if (minutes !== null) {
    if (key) catalogueExpiryByOffer.set(key, { minutes, displayedDays, readAt: Date.now() });
    return { minutes, displayedDays };
  }
  if (cached) {
    return {
      minutes: Math.max(0, cached.minutes - (Date.now() - cached.readAt) / 60000),
      displayedDays: cached.displayedDays,
    };
  }
  return { minutes, displayedDays };
}

function catalogueCountdownText(card, exact = false) {
  const simple = card.querySelector('.js-simple-countdown-timer');
  const full = card.querySelector('.js-countdown-timer');
  const label = card.querySelector('[data-countdown]')?.getAttribute('data-countdown');
  const sources = exact
    ? [full?.getAttribute('aria-label'), full?.textContent, simple?.textContent, label]
    : [simple?.textContent, label, full?.getAttribute('aria-label'), full?.textContent];
  // Humble renders both the simple badge and a hidden detailed countdown.
  // Read one countdown source, excluding marketing text and duplicate timers.
  return String(sources.find(text => typeof text === 'string' && text.trim()) ?? card.textContent ?? '').replace(/\s+/gu, ' ').toLowerCase();
}

function catalogueDisplayedDays(card) {
  const text = catalogueCountdownText(card);
  const marker = text.search(/\b(?:offer\s+)?ends?(?:\s+in)?\b/u);
  const timing = marker === -1 ? text : text.slice(marker, marker + 100);
  const match = timing.match(/\b(\d+)\s+days?\b/u);
  return match ? Number(match[1]) : null;
}

function catalogueCardTitle(link) {
  const imageTitle = link.querySelector('img[alt]')?.alt?.trim();
  if (imageTitle) return imageTitle;
  const heading = link.querySelector('h1, h2, h3, h4, [class*="title" i]');
  return heading?.textContent?.replace(/\s+/gu, ' ').trim() ?? link.getAttribute('aria-label') ?? '';
}

function isExtensionId(value) {
  return HumbleComicLibrary.isExtensionId(value);
}

function createGalacticLookup(extensionId) {
  extensionId=HumbleComicLibrary.resolveGalacticId(extensionId,chrome.runtime);
  const id = String(extensionId ?? '').trim();
  return {
    enabled: isExtensionId(id),
    extensionId: id,
    resultsByKey: new Map(),
    requestKeys: new Map(),
    usedRequestKeys: new Set(),
    failuresByKey: new Map(),
    reviewedContentsAvailable: false,
    softwareCapability: null,softwareSupported:false,
    inFlightKeys: new Set(),
    inFlight: null,
    error: null,
    status: isExtensionId(id) ? 'Waiting for ownership checks.' : 'Not configured.'
  };
}

function galacticRequestKey(itemKind, title) {
  return `${itemKind}:${HumbleComicLibrary.titleKey(title)}`;
}

function waitForGalacticResponse(promise) {
  let timeout;
  const timed = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Galactic Library did not respond within 30 seconds. It may be busy; retry the checks.')), GALACTIC_LIBRARY_REQUEST_TIMEOUT_MS);
  });
  return Promise.race([promise, timed]).finally(() => clearTimeout(timeout));
}

function ownedOutsideHumble(result, offered = null) {
  const offeredSeries = offered ? HumbleComicLibrary.bibliographicFields(offered).series : '';
  return (Array.isArray(result?.matches) ? result.matches : [])
    .filter((match) => match?.provider !== 'humble' && HumbleOwnership.permanent(match)
      && (match.relationship === undefined || match.relationship === 'same-edition'
        || match.relationship === 'contains' && result?.coverage?.complete === true))
    .filter(match => !offered || match.relationship === 'contains'
      || !HumbleOwnership.conflicts(offered, { ...match, ...(match.evidence ?? {}), kind: offered.kind,
        series: Array.isArray(match.evidence?.series)
          ? match.evidence.series.find(series => HumbleCollectionMappings.scopeKey(series) === HumbleCollectionMappings.scopeKey(offeredSeries)) ?? match.evidence.series[0]
          : match.evidence?.series }, true).length);
}

function needsOwnershipReviewOutsideHumble(result) {
  return (Array.isArray(result?.matches) ? result.matches : [])
    .filter((match) => match?.provider !== 'humble' && match?.ownership && match.ownership !== 'owned' && match.ownership !== 'claimed');
}

function possibleOutsideHumble(result) {
  return (Array.isArray(result?.possibleMatches) ? result.possibleMatches : [])
    .filter((match) => match?.provider && match.provider !== 'humble');
}

async function queryGalacticLibrary(items, itemKind, comparison, job, diagnostic=null) {
  const lookup = comparison?.galactic;
  if (!lookup?.enabled) return;
  if(items.some(({item,match})=>(item.kind??itemKind)==='software'&&match.state!=='owned')){
    lookup.softwareCapability??=waitForGalacticResponse(chrome.runtime.sendMessage(lookup.extensionId,{type:'GET_STATUS'})).then(response=>{
      lookup.softwareSupported=response?.ok===true&&response.apiVersion===GALACTIC_LIBRARY_API_VERSION&&Array.isArray(response.capabilities?.mediaTypes)&&response.capabilities.mediaTypes.includes('software');
      if(!lookup.softwareSupported)lookup.status='Software is not advertised by Galactic Library; using local software evidence.';
    }).catch(()=>{lookup.softwareCapabilityFailed=true;lookup.status='Software capability check unavailable; using local software evidence.';});
    await lookup.softwareCapability;
  }
  const requested = new Map();
  for (const { item, match, target, contextOnly } of items) {
    if (match.state === 'owned' && !target?.entries.length && !contextOnly) continue;
    const mediaType = item.kind ?? itemKind;
    if (!GALACTIC_LIBRARY_MEDIA_TYPES.has(mediaType)||mediaType==='software'&&!lookup.softwareSupported) continue;
    const fields = HumbleOwnership.request({ ...item, kind: mediaType }, comparison.collectionMappings ?? [], target);
    const fingerprint = JSON.stringify(fields);
    let requestId = lookup.requestKeys.get(fingerprint);
    if (!requestId) {
      const base = galacticRequestKey(mediaType, fields.title).slice(0, 440);
      const hasEvidence = Object.keys(fields).length > 3;
      requestId = !hasEvidence && !lookup.usedRequestKeys.has(base) ? base : `${base}:request-${lookup.requestKeys.size + 1}`;
      lookup.requestKeys.set(fingerprint, requestId);
      lookup.usedRequestKeys.add(requestId);
    }
    item.galacticKey = requestId;
    if (lookup.resultsByKey.has(requestId) || lookup.inFlightKeys.has(requestId)) continue;
    lookup.inFlightKeys.add(requestId);
    requested.set(requestId, { requestId, ...fields });
  }
  if (!requested.size) {
    // A DOM refresh can begin while the first request is still running. Wait
    // for its cache update rather than briefly replacing its results with an
    // empty external-match count.
    if (lookup.inFlight) await lookup.inFlight.catch(() => {});
    return;
  }
  lookup.status = `Checking ${requested.size} title${requested.size === 1 ? '' : 's'}…`;
  showComparisonProgress(`Checking ${requested.size} title${requested.size === 1 ? '' : 's'} in Galactic Library…`);
  // GL bounds both item count and aggregate contents. Keep one in-flight
  // promise across batches so lazy cards/resize refreshes share the cache.
  const previousFlight = lookup.inFlight;
  if(diagnostic)diagnostic.ready=galacticDiagnosticNow();
  const responsePromise = (async () => {
    const waiting=galacticDiagnosticNow();
    if (previousFlight) await previousFlight.catch(() => {});
    if(diagnostic)diagnostic.previousFlightMs=previousFlight?Math.max(0,galacticDiagnosticNow()-waiting):0;
    const batches = []; let batch = []; let units = 0;
    for (const fields of requested.values()) {
      const count = fields.contents?.length ?? 0;
      if (batch.length && (batch.length === 500 || units + count > 20000)) { batches.push(batch); batch = []; units = 0; }
      batch.push(fields); units += count;
    }
    if (batch.length) batches.push(batch);
    for (const entries of batches) {
      const response = await waitForGalacticResponse(sendGalacticMatch(lookup.extensionId, {
        type: 'MATCH_ITEMS', apiVersion: GALACTIC_LIBRARY_API_VERSION, items: entries
      },diagnostic));
      if (!response?.ok || response.apiVersion !== GALACTIC_LIBRARY_API_VERSION || !Array.isArray(response.results)) {
        throw new Error(response?.error ?? 'Galactic Library returned an incompatible response.');
      }
      const results = new Map(response.results.map(result => [result?.requestId, result]));
      if (response.results.length !== entries.length || results.size !== entries.length
        || entries.some(entry => !['matches', 'possibleMatches', 'partialMatches'].every(field =>
          (field !== 'matches' && results.get(entry.requestId)?.[field] === undefined) || Array.isArray(results.get(entry.requestId)?.[field]))))
        throw new Error('Galactic Library returned incomplete matching results.');
      for (const entry of entries) {
        const result = results.get(entry.requestId);
        lookup.resultsByKey.set(entry.requestId, result);
        lookup.failuresByKey.delete(entry.requestId);
        if (entry.contents?.length && Array.isArray(result.coverage?.covered)) lookup.reviewedContentsAvailable = true;
      }
    }
  })();
  lookup.inFlight = responsePromise;
  try {
    await responsePromise;
    const matchCount = [...lookup.resultsByKey.values()].filter((result) => ownedOutsideHumble(result).length).length;
    lookup.status = `Available. ${matchCount} exact non-Humble title match${matchCount === 1 ? '' : 'es'}.`;
    lookup.error = lookup.failuresByKey.size ? `${lookup.failuresByKey.size} incomplete ownership checks. ${lookup.failuresByKey.values().next().value}` : null;
  } catch (error) {
    lookup.status = 'Some checks unavailable.';
    const message = String(error?.message ?? error);
    for (const requestId of requested.keys()) if (!lookup.resultsByKey.has(requestId)) lookup.failuresByKey.set(requestId, message);
    lookup.error = message;
  } finally {
    for (const requestId of requested.keys()) lookup.inFlightKeys.delete(requestId);
    if (lookup.inFlight === responsePromise) lookup.inFlight = null;
  }
  if (comparison.job !== job) return;
}

function galacticOwnedMatches(itemKind, title, comparison) {
  return ownedOutsideHumble(comparison?.galactic?.resultsByKey.get(galacticRequestKey(itemKind, title)));
}

function galacticOwnershipReviewMatches(itemKind, title, comparison) {
  return needsOwnershipReviewOutsideHumble(comparison?.galactic?.resultsByKey.get(galacticRequestKey(itemKind, title)));
}

function galacticPossibleMatches(itemKind, title, comparison) {
  return possibleOutsideHumble(comparison?.galactic?.resultsByKey.get(galacticRequestKey(itemKind, title)));
}

function displayProviderName(provider) {
  return provider === 'gog' ? 'GOG' : String(provider ?? '').replace(/^./u, (letter) => letter.toUpperCase());
}

function catalogueSortTitle(link, card) {
  const heading = card.querySelector('h1, h2, h3, h4, h5, h6, [data-testid*="title" i]');
  const headingTitle = heading?.textContent?.replace(/\s+/gu, ' ').trim();
  if (headingTitle) return headingTitle;
  const cardText = String(card.textContent ?? '')
    .replace(/\b(?:offer\s+)?ends?(?:\s+in)?\s*\d+\s+(?:weeks?|days?|hours?|hrs?|minutes?|mins?)(?:\s+\d+\s+(?:weeks?|days?|hours?|hrs?|minutes?|mins?))*\b/giu, '')
    .replace(/\b\d+\s+days?\s+left\b/giu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (cardText) return cardText;
  const linkedTitle = catalogueCardTitle(link);
  if (linkedTitle) return linkedTitle;
  return link.getAttribute('aria-label') ?? '';
}

function catalogueCardContainer(link) {
  return link.closest('article, li, [class*="tile" i], [class*="card" i], [class*="product" i], [class*="entity" i]') ?? link;
}

function sortCatalogueCards() {
  const cards = new Map();
  for (const link of document.querySelectorAll('a[href]')) {
    if (!isBundleOfferLink(link)) continue;
    const card = catalogueCardContainer(link);
    if (!card || cards.has(card)) continue;
    const timing = catalogueTimingForOffer(link, card);
    cards.set(card, {
      title: catalogueSortTitle(link, card),
      offerKey: catalogueOfferKey(link).split('?')[0] || link.pathname,
      endsInMinutes: timing.minutes,
      displayedDays: timing.displayedDays,
      filtered: card.dataset.hclCatalogFilter === 'true',
    });
  }
  const sections = new Map();
  for (const [element, data] of cards) {
    const heading = precedingCatalogueSectionHeading(element) ?? document.body;
    const section = sections.get(heading) ?? [];
    section.push({ element, ...data });
    sections.set(heading, section);
  }
  const result = { sections: sections.size, distinctCards: cards.size, cardSlots: 0, singletonRows: 0, directGroups: 0, directCardsMoved: 0, rowSections: 0, rowCardsMoved: 0, timedCards: [...cards.values()].filter((card) => card.endsInMinutes !== null).length, plannedCrossRowCards: 0, inaccessibleCrossRowCards: 0 };
  for (const section of sections.values()) {
    const sectionResult = sortVisibleCardGroups(section, (left, right) => {
    if (left.filtered !== right.filtered) return left.filtered ? 1 : -1;
    const leftEnds = catalogueSortWindow(left);
    const rightEnds = catalogueSortWindow(right);
    if (leftEnds !== null && rightEnds !== null && leftEnds !== rightEnds) return leftEnds - rightEnds;
    if (leftEnds !== null && rightEnds === null) return -1;
    if (leftEnds === null && rightEnds !== null) return 1;
    const titleComparison = naturalTitleCompare(left.title, right.title);
    if (titleComparison) return titleComparison;
    return String(left.offerKey).localeCompare(String(right.offerKey));
    }, true, true);
    result.directGroups += sectionResult.directGroups;
    result.cardSlots += sectionResult.cardSlots;
    result.singletonRows += sectionResult.singletonRows;
    result.directCardsMoved += sectionResult.directCardsMoved;
    result.rowSections += sectionResult.rowSections;
    result.rowCardsMoved += sectionResult.rowCardsMoved;
    result.plannedCrossRowCards += sectionResult.plannedCrossRowCards;
    result.inaccessibleCrossRowCards += sectionResult.inaccessibleCrossRowCards;
  }
  return result;
}

function catalogueSortWindow(card) {
  if (Number.isFinite(card.displayedDays)) return card.displayedDays;
  if (Number.isFinite(card.endsInMinutes)) return Math.floor(card.endsInMinutes / 1440);
  return null;
}

function renderCatalogueSortDiagnostics(sorting) {
  document.querySelector('#hcl-catalog-sort-diagnostics')?.remove();
  const panel = document.createElement('aside');
  panel.id = 'hcl-catalog-sort-diagnostics';
  panel.className = 'hcl-catalog-sort-diagnostics';
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Catalogue sorting';
  const message = document.createElement('p');
  message.textContent = `${sorting.sections} section${sorting.sections === 1 ? '' : 's'}; ${sorting.timedCards} card${sorting.timedCards === 1 ? '' : 's'} with an expiry; ${sorting.cardSlots}/${sorting.distinctCards} cards in sortable slots (${sorting.singletonRows} one-card row${sorting.singletonRows === 1 ? '' : 's'}); ${sorting.directGroups} row group${sorting.directGroups === 1 ? '' : 's'} (${sorting.directCardsMoved} cards moved); ${sorting.rowSections} cross-row section${sorting.rowSections === 1 ? '' : 's'} (${sorting.rowCardsMoved}/${sorting.plannedCrossRowCards} planned cards moved, ${sorting.inaccessibleCrossRowCards} unavailable slots).`;
  details.append(summary, message);
  panel.append(details);
  document.body.append(panel);
}

function precedingCatalogueSectionHeading(card) {
  let sectionHeading = null;
  for (const heading of document.querySelectorAll('h1, h2, h3, h4, [class*="title" i], [class*="header" i]')) {
    const label = HumbleComicLibrary.titleKey(heading.textContent);
    if (label !== 'games' && label !== 'books' && !label.includes('software')) continue;
    if (heading.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING) sectionHeading = heading;
  }
  return sectionHeading;
}

function catalogueEndsInMinutes(card) {
  const text = catalogueCountdownText(card, true);
  const marker = text.search(/\b(?:offer\s+)?ends?(?:\s+in)?\b/u);
  const timing = marker === -1 ? text : text.slice(marker, marker + 100);
  let total = 0;
  let found = false;
  for (const match of timing.matchAll(/(\d+)\s*(weeks?|days?|hours?|hrs?|minutes?|mins?)/gu)) {
    const amount = Number(match[1]);
    const unit = match[2];
    total += amount * (unit.startsWith('week') ? 10080 : unit.startsWith('day') ? 1440 : unit.startsWith('hour') || unit.startsWith('hr') ? 60 : 1);
    found = true;
  }
  if (found && (marker !== -1 || /\bleft\b/u.test(text))) return total;
  const clock = text.match(/\b(\d+):(\d{2}):(\d{2})(?::(\d{2}))?\b/u);
  if (!clock) return null;
  const [, first, second, third, fourth] = clock;
  // Humble uses either H:MM:SS or D:HH:MM:SS countdowns.
  return fourth === undefined
    ? Number(first) * 60 + Number(second) + Number(third) / 60
    : Number(first) * 1440 + Number(second) * 60 + Number(third) + Number(fourth) / 60;
}

function catalogueTitleKey(title) {
  return HumbleComicLibrary.titleKey(title)
    .replace(/^humble\s+(?:(?:books|comics|games|software)\s+)?bundle\s+/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function sortBundleItems(items) {
  const cardsByTier = new Map();
  for (const item of items) {
    // productContainer is intentionally broad for status annotation; on
    // some Humble layouts it is the whole tier. For sorting, use the nearest
    // ancestor containing exactly one cover so each book has its own card.
    const card = findSingleCoverCard(item.element) ?? item.container;
    if (!card) continue;
    const cards = cardsByTier.get(item.tier.label) ?? new Map();
    if (!cards.has(card)) cards.set(card, { title: item.title });
    cardsByTier.set(item.tier.label, cards);
  }
  const sorting = { directGroups: 0, directCardsMoved: 0, rowSections: 0, rowCardsMoved: 0, tierGroups: cardsByTier.size };
  const allCards = new Set();
  const parents = new Set();
  for (const cards of cardsByTier.values()) {
    for (const card of cards.keys()) {
      allCards.add(card);
      if (card.parentElement) parents.add(card.parentElement);
    }
    const result = sortVisibleCardGroups([...cards.entries()].map(([element, data]) => ({ element, ...data })), (left, right) => naturalTitleCompare(left.title, right.title), true);
    sorting.directGroups += result.directGroups;
    sorting.directCardsMoved += result.directCardsMoved;
    sorting.rowSections += result.rowSections;
    sorting.rowCardsMoved += result.rowCardsMoved;
  }
  sorting.sourceItems = items.length;
  sorting.distinctCards = allCards.size;
  sorting.directParents = parents.size;
  return sorting;
}

function sortVisibleCardGroups(entries, compare, allowDocumentBody = false, includeSingletonMosaicRows = false) {
  const result = { directGroups: 0, directCardsMoved: 0, rowSections: 0, rowCardsMoved: 0, plannedCrossRowCards: 0, inaccessibleCrossRowCards: 0, cardSlots: 0, singletonRows: 0 };
  const candidatesByParent = new Map();
  for (const entry of entries) {
    let child = entry.element;
    for (let parent = child.parentElement; parent; child = parent, parent = parent.parentElement) {
      if (parent === document.body && !allowDocumentBody) break;
      const candidates = candidatesByParent.get(parent) ?? [];
      candidates.push({ entry, child });
      candidatesByParent.set(parent, candidates);
      if (parent === document.body) break;
    }
  }
  const usableParents = new Set([...candidatesByParent].filter(([, candidates]) => (
    candidates.length >= 2 && new Set(candidates.map((candidate) => candidate.child)).size === candidates.length
  )).map(([parent]) => parent));
  const singletonRows = new Set();
  if (includeSingletonMosaicRows) {
    // The live catalogue uses .mosaic-section > .mosaic-layout > .tile-holder.
    // A row with one offer is a real row, not an unrelated sidebar/card. Admit
    // its slot into the same cross-row sort as the fuller rows in this section.
    for (const [parent, candidates] of candidatesByParent) {
      if (candidates.length === 1 && parent.matches('.mosaic-layout')
        && parent.parentElement?.matches('.mosaic-section') && candidates[0].child.matches('.tile-holder')) {
        usableParents.add(parent);
        singletonRows.add(parent);
      }
    }
  }
  const chosenGroups = new Map();
  for (const entry of entries) {
    let child = entry.element;
    for (let parent = child.parentElement; parent; child = parent, parent = parent.parentElement) {
      if (parent === document.body && !allowDocumentBody) break;
      if (!usableParents.has(parent)) continue;
      const group = chosenGroups.get(parent) ?? [];
      group.push({ entry, child });
      chosenGroups.set(parent, group);
      break;
    }
  }
  const recognizedRows = [];
  for (const [parent, group] of chosenGroups) {
    if (group.length < 2 && !singletonRows.has(parent)) continue;
    result.cardSlots += group.length;
    if (group.length === 1) result.singletonRows += 1;
    if (group.length >= 2) result.directGroups += 1;
    const sorted = group.sort((left, right) => compare(left.entry, right.entry)).map(({ child }) => child);
    if (reorderCardsInContainer(group[0].child.parentElement, sorted)) result.directCardsMoved += sorted.length;
    recognizedRows.push({ parent: group[0].child.parentElement, records: group });
  }
  const acrossRows = sortAcrossRecognizedRows(recognizedRows, compare);
  result.rowSections = acrossRows.sections;
  result.rowCardsMoved = acrossRows.cardsMoved;
  result.plannedCrossRowCards = acrossRows.plannedCards;
  result.inaccessibleCrossRowCards = acrossRows.inaccessibleCards;
  return result;
}

function sortAcrossRecognizedRows(rows, compare) {
  const result = { sections: 0, cardsMoved: 0, plannedCards: 0, inaccessibleCards: 0 };
  const sections = new Map();
  for (const row of rows) {
    const section = row.parent.parentElement;
    if (!section) continue;
    const sectionRows = sections.get(section) ?? [];
    sectionRows.push(row);
    sections.set(section, sectionRows);
  }
  for (const sectionRows of sections.values()) {
    if (sectionRows.length < 2) continue;
    const sorted = sectionRows.flatMap((row) => row.records).sort((left, right) => compare(left.entry, right.entry));
    const actual = sectionRows.flatMap((row) => row.records.map(({ child }) => child));
    const moved = actual.some((card, index) => card !== sorted[index].child);
    if (moved) {
      result.plannedCards += sorted.length;
      reorderCardsAcrossRows(sectionRows, sorted.map(({ child }) => child));
    }
    result.sections += 1;
    if (moved) result.cardsMoved += sorted.length;
  }
  return result;
}

function reorderCardsAcrossRows(rows, expectedCards) {
  const slotsByRow = rows.map((row) => {
    const cards = row.records.map(({ child }) => child);
    const slots = cards.map(() => document.createComment('hcl-sort-slot'));
    cards.forEach(forceDocumentCardOrder);
    cards.forEach((card, index) => row.parent.replaceChild(slots[index], card));
    return slots;
  });
  let offset = 0;
  for (const slots of slotsByRow) {
    slots.forEach((slot, index) => slot.parentElement.replaceChild(expectedCards[offset + index], slot));
    offset += slots.length;
  }
}

function sortAcrossCardRows(entries, compare, allowDocumentBody = false) {
  const result = { sections: 0, cardsMoved: 0 };
  const candidatesByParent = new Map();
  for (const entry of entries) {
    let child = entry.element;
    let depth = 0;
    for (let parent = child.parentElement; parent; child = parent, parent = parent.parentElement, depth += 1) {
      if (parent === document.body && !allowDocumentBody) break;
      if (child === entry.element) continue;
      const card = directChildWithin(entry.element, child);
      if (!card || card === child) continue;
      const candidates = candidatesByParent.get(parent) ?? [];
      candidates.push({ entry, row: child, card, depth });
      candidatesByParent.set(parent, candidates);
      if (parent === document.body) break;
    }
  }
  const candidates = [...candidatesByParent].map(([parent, records]) => ({ parent, records }))
    .filter(({ records }) => {
      const rows = new Set(records.map((record) => record.row));
      const cards = new Set(records.map((record) => record.card));
      return rows.size >= 2 && cards.size === records.length && [...rows].every((row) => records.filter((record) => record.row === row).length >= 2);
    })
    .sort((left, right) => Math.min(...left.records.map((record) => record.depth)) - Math.min(...right.records.map((record) => record.depth)));
  const movedCards = new Set();
  for (const { parent, records } of candidates) {
    if (records.some((record) => movedCards.has(record.card))) continue;
    const rows = [...parent.children].filter((child) => records.some((record) => record.row === child));
    const sorted = [...records].sort((left, right) => compare(left.entry, right.entry));
    let offset = 0;
    let moved = false;
    for (const row of rows) {
      const capacity = records.filter((record) => record.row === row).length;
      const cards = sorted.slice(offset, offset + capacity).map((record) => record.card);
      moved = reorderCardsInContainer(row, cards) || moved;
      cards.forEach((card) => movedCards.add(card));
      offset += capacity;
    }
    result.sections += 1;
    if (moved) result.cardsMoved += records.length;
  }
  return result;
}

function directChildWithin(element, ancestor) {
  let child = element;
  while (child.parentElement && child.parentElement !== ancestor) child = child.parentElement;
  return child.parentElement === ancestor ? child : null;
}

function reorderCardsInContainer(parent, expectedCards) {
  if (!parent || expectedCards.length < 2) return false;
  const expected = [...new Set(expectedCards)];
  // Humble sets inline flex order on these wrappers. The extension is
  // intentionally taking over ordering for this page view, so force the
  // browser to honor the reordered document slots instead. Reloading the page
  // restores Humble's original markup and order values.
  expected.forEach(forceDocumentCardOrder);
  const expectedSet = new Set(expected);
  const actual = [...parent.children].filter((child) => expectedSet.has(child));
  if (actual.length !== expected.length || actual.every((card, index) => card === expected[index])) return false;
  // Replace only the card positions, rather than appending nodes. This keeps
  // Humble's tier headings, sidebar, and other non-card siblings fixed even
  // when the card parent is the page's main content container.
  const slots = actual.map((card) => document.createComment('hcl-sort-slot'));
  actual.forEach((card, index) => parent.replaceChild(slots[index], card));
  expected.forEach((card, index) => {
    parent.replaceChild(card, slots[index]);
  });
  return true;
}

function forceDocumentCardOrder(card) {
  card.style.setProperty('order', 'initial', 'important');
  card.dataset.hclSortOrder = 'document';
}


function naturalTitleCompare(left, right) {
  return globalThis.LibraryTitleSort.compare(displayTitle(left), displayTitle(right));
}

function audiobookLookupTitle(title) {
  // Remove only an explicit trailing delivery label, not words in a work's
  // title (e.g. "The Audiobook Production Guide") or narration/edition details.
  return String(title).replace(/\s*(?:\(audio[ -]?book\)|\[audio[ -]?book\]|[-\u2013\u2014:]\s*audio[ -]?book)\s*$/iu, '').trim();
}

function bundleMediaContext(baseKind = location.pathname.startsWith('/games/') ? 'game' : location.pathname.startsWith('/software/') ? 'software' : 'book') {
  const kindsByTitle = new Map();
  const productsByTitle = new Map();
  let defaultKind = baseKind;
  // Audiobook bundles use Humble's /books/ route. Do not infer media from a
  // random description, soundtrack, or an ebook about producing audiobooks.
  const heading = document.querySelector('h1')?.textContent ?? '';
  const listing = `${location.pathname} ${heading}`;
  const mixed = /\b(?:e?books?|comics?)[\s-]*(?:and|&|\+)[\s-]*audio[ -]?books?\b|\baudio[ -]?books?[\s-]*(?:and|&|\+)[\s-]*(?:e?books?|comics?)\b/iu.test(listing);
  if (baseKind === 'book' && !mixed && (/(?:^|[-/])audiobooks(?:[-/]|$)/iu.test(location.pathname)
    || /\baudio[ -]?books?\s+bundle\b/iu.test(heading))) defaultKind = 'audiobook';
  try {
    const data = JSON.parse(document.querySelector('#webpack-bundle-page-data')?.textContent ?? '{}').bundleData;
    if (baseKind === 'book' && !mixed && /^(?:audio[ _-]?book|audio)$/iu.test(data?.content_type ?? data?.product_type ?? '')) defaultKind = 'audiobook';
    for (const product of Object.values(data?.tier_item_data ?? {})) {
      const key = HumbleComicLibrary.titleKey(product?.human_name);
      if (!key) continue;
      const products = productsByTitle.get(key) ?? [];
      products.push(product);
      productsByTitle.set(key, products);
      const kind = hasAudiobookDownload(product) ? 'audiobook'
        : hasBookDownload(product) || /^(?:book|ebook)$/iu.test(product?.content_type ?? product?.product_type ?? '') ? 'book' : null;
      if (!kind) continue;
      const kinds = kindsByTitle.get(key) ?? new Set();
      kinds.add(kind);
      kindsByTitle.set(key, kinds);
    }
  } catch {
    // Missing/unhydrated or malformed metadata must not stop ordinary matching.
  }
  return { defaultKind, kindsByTitle, productsByTitle };
}

function describeBundleItem(item, media) {
  let kind = media.defaultKind;
  if (kind === 'book' || kind === 'audiobook') {
    // A local explicit format/type can distinguish identically named ebook and
    // audio cards in a mixed bundle; otherwise use unambiguous item metadata.
    const nodes = [item.element, item.container];
    const hints = nodes.flatMap((node) => ['data-content-type', 'data-product-type', 'data-format']
      .map((attribute) => node?.getAttribute?.(attribute) ?? ''));
    const hint = hints.find((value) => /^(?:audio[ _-]?book|audio|mp3|m4a|m4b|aac|flac|ogg|opus|wav|book|ebook|pdf|epub|cbz|cbr|mobi)$/iu.test(value));
    const metadataKinds = media.kindsByTitle.get(HumbleComicLibrary.titleKey(item.title));
    if (hint) kind = /^(?:book|ebook|pdf|epub|cbz|cbr|mobi)$/iu.test(hint) ? 'book' : 'audiobook';
    else if (metadataKinds?.size === 1) kind = [...metadataKinds][0];
    else if (audiobookLookupTitle(item.title) !== String(item.title).trim()) kind = 'audiobook';
    else if (metadataKinds?.size > 1) kind = 'unknown'; // no ownership claim for ambiguous media
  }
  const candidates = (media.productsByTitle?.get(HumbleComicLibrary.titleKey(item.title)) ?? [])
    .filter(product => kind !== 'audiobook' || hasAudiobookDownload(product))
    .filter(product => kind !== 'book' || !hasAudiobookDownload(product));
  const fields = candidates.length === 1 ? HumbleComicLibrary.bibliographicFields(candidates[0]) : {};
  for (const field of ['isbn', 'asin', 'edition', 'editionId', 'language', 'series', 'seriesId', 'run', 'runId', 'volume', 'issue', 'author']) {
    const attribute = `data-${field.replace(/[A-Z]/gu, letter => `-${letter.toLowerCase()}`)}`;
    const value = item.element?.getAttribute?.(attribute) || item.container?.getAttribute?.(attribute);
    if (value) Object.assign(fields, HumbleComicLibrary.bibliographicFields({ [field]: value }));
  }
  return { ...item, ...fields, kind, lookupTitle: kind === 'audiobook' ? audiobookLookupTitle(item.title) : item.title };
}

function bundleItemKey(item) {
  return HumbleComicLibrary.catalogItemKey(item);
}

// Require the complete, already-hydrated catalogue; this never fetches a page.
function completeBundleMatchContext(rows, media) {
  try {
    const bundle = JSON.parse(document.querySelector('#webpack-bundle-page-data')?.textContent || '{}').bundleData;
    const tiers = Object.values(bundle?.tier_display_data || {});
    if (!tiers.length || !bundle?.tier_item_data || tiers.some(tier => !Array.isArray(tier?.tier_item_machine_names))) return false;
    const ids = [...new Set(tiers.flatMap(tier => tier.tier_item_machine_names))];
    if (ids.length < 2 || ids.some(id => typeof bundle.tier_item_data[id]?.human_name !== 'string' || !bundle.tier_item_data[id].human_name.trim())) return false;
    const keys = ids.map(id => bundleItemKey(describeBundleItem({title:bundle.tier_item_data[id].human_name},media)));
    const actual = rows.map(({item}) => bundleItemKey(item));
    return new Set(keys).size === keys.length && new Set(actual).size === actual.length
      && actual.length === keys.length && actual.every(key => keys.includes(key));
  } catch { return false; }
}

function createBundleLibraryMatcher(items, baseKind, historicalItems = []) {
  // Storage supplies only the active profile's archive. Other profile archives
  // are never candidate inputs. History stays out of current contents evidence.
  const currentKeys = new Set(items.map(item => HumbleComicLibrary.catalogItemKey(item)));
  const missing = historicalItems.filter(item => !currentKeys.has(HumbleComicLibrary.catalogItemKey(item)));
  const history = missing.length ? createBundleLibraryMatcher(missing, baseKind) : null;
  const mediaMatchers = new Map();
  for (const kind of baseKind === 'book' ? ['book', 'audiobook', 'comic'] : [baseKind]) {
    const byKey = new Map();
    for (const item of items) {
      if ((item.kind ?? 'book') !== kind) continue;
      const title = kind === 'audiobook' ? audiobookLookupTitle(item.title) : item.title;
      const key = HumbleComicLibrary.titleKey(title);
      if (key) byKey.set(byKey.has(key) ? `${key}\u0000${byKey.size}` : key, { ...item, title });
    }
    const matcher = createLibraryMatcher(byKey, kind);
    matcher.historicalMatcher = history?.mediaMatchers.get(kind) ?? null;
    mediaMatchers.set(kind, matcher);
  }
  const matcher = mediaMatchers.get(baseKind);
  mediaMatchers.set('unknown', createLibraryMatcher(new Map(), 'unknown'));
  mediaMatchers.set('unclassified', createLibraryMatcher(new Map(), 'unclassified'));
  matcher.mediaMatchers = mediaMatchers;
  return matcher;
}

function clearBundleAnnotations() {
  document.querySelectorAll('.hcl-status-button, .hcl-owned-badge, .hcl-new-badge, .hcl-possible-badge, .hcl-partial-badge').forEach((badge) => badge.remove());
  document.querySelectorAll('.hcl-owned-item, .hcl-unchecked-item, .hcl-elsewhere-item, .hcl-new-item, .hcl-possible-item, .hcl-partial-item').forEach((item) => {
    item.style.removeProperty('border-left');
    item.style.removeProperty('box-shadow');
    item.style.removeProperty('background-color');
    item.querySelectorAll('h1, h2, h3, h4, h5, p, a, span').forEach((text) => text.style.removeProperty('color'));
  });
  document.querySelectorAll('.hcl-cover-owned, .hcl-cover-unchecked, .hcl-cover-elsewhere, .hcl-cover-new, .hcl-cover-possible, .hcl-cover-partial').forEach((cover) => {
    cover.style.removeProperty('outline');
    cover.style.removeProperty('outline-offset');
    cover.style.removeProperty('box-shadow');
  });
  document.querySelectorAll('.hcl-owned-item, .hcl-unchecked-item, .hcl-elsewhere-item, .hcl-new-item, .hcl-possible-item, .hcl-partial-item, .hcl-badge-host, .hcl-card-owned, .hcl-card-unchecked, .hcl-card-elsewhere, .hcl-card-new, .hcl-card-possible, .hcl-card-partial, .hcl-cover-owned, .hcl-cover-unchecked, .hcl-cover-elsewhere, .hcl-cover-new, .hcl-cover-possible, .hcl-cover-partial').forEach((item) => {
    item.classList.remove('hcl-owned-item', 'hcl-elsewhere-item', 'hcl-new-item', 'hcl-possible-item', 'hcl-partial-item', 'hcl-badge-host', 'hcl-card-owned', 'hcl-card-elsewhere', 'hcl-card-new', 'hcl-card-possible', 'hcl-card-partial', 'hcl-cover-owned', 'hcl-cover-elsewhere', 'hcl-cover-new', 'hcl-cover-possible', 'hcl-cover-partial');
    delete item.dataset.hclBadge;
    item.classList.remove('hcl-unchecked-item', 'hcl-card-unchecked', 'hcl-cover-unchecked');
  });
  document.querySelectorAll('.hcl-title-colored').forEach((item) => {
    item.classList.remove('hcl-title-colored');
    item.style.removeProperty('color');
    item.style.removeProperty('font-weight');
  });
  document.querySelectorAll('.hcl-related-titles').forEach(node=>{if(node.parentElement.matches('li'))return;node.nextElementSibling?.matches('details[data-hcl-related]')&&node.nextElementSibling.remove();node.remove();});
}

async function renderBundleComparison(libraryMatcher, itemKind, currentBundlePurchases = [], collectionMappings = [], comparison = null, job = 0) {
  const diagnostic={started:galacticDiagnosticNow(),ready:0,storageMs:comparison?.storageMs,requests:[]};
  try {
  if (comparison && comparison.job !== job) return;
  // Humble's FLIP transition owns the departing/returning card positions.
  // Reparenting during it interrupts native cleanup. Resume on its class
  // removal/mount events instead of racing a guessed animation duration.
  if (document.querySelector('.desktop-tier-collection-view > .tier-item-view.flipping')) {
    showComparisonProgress('Waiting for tier changes…');
    return;
  }
  const media = bundleMediaContext(itemKind);
  const items = collectBundleItems(media);
  if (!items.length) {
    clearBundleAnnotations();
    document.querySelector('#hcl-summary')?.remove();
    if (comparison) comparison.emptyChecks += 1;
    const waitedLongEnough = comparison && (comparison.emptyChecks >= 3 || performance.now() - comparison.startedAt >= 6000);
    showComparisonProgress(waitedLongEnough ? 'No active bundle items found. This offer may have ended.' : 'Waiting for Humble’s bundle items…', { spinning: !waitedLongEnough });
    if (comparison && !waitedLongEnough) {
      setTimeout(() => {
        if (comparison.job === job) renderBundleComparison(libraryMatcher, itemKind, currentBundlePurchases, collectionMappings, comparison, job);
      }, 1200);
    }
    return;
  }
  if (comparison) comparison.emptyChecks = 0;
  const sorting = sortBundleItems(items);
  if (comparison) {
    comparison.itemCount = items.length;
    comparison.sorting = sorting;
  }
  const matchStartedAt = performance.now();
  if (comparison) comparison.collectionMappings = collectionMappings;
  const records = [...(libraryMatcher.mediaMatchers?.values() ?? [libraryMatcher])].flatMap(matcher => [...matcher.libraryByKey.values()]);
  const localContents = HumbleOwnership.localEvidence(records.filter(record => (record.kind ?? 'book') === 'book' || record.kind === 'comic'), collectionMappings);
  const counts = { owned: 0, elsewhere: 0, partial: 0, possible: 0, new: 0, unchecked: 0 };
  const titlesByState = { owned: [], elsewhere: [], partial: [], possible: [], new: [], unchecked: [] };
  const matchesByTitleKey = new Map();
  const tiers = new Map();
  const resolvedItems = [];
  let sliceStartedAt = performance.now();
  for (const [index, item] of items.entries()) {
    const matcher = libraryMatcher.mediaMatchers?.get(item.kind) ?? libraryMatcher;
    const match = classifyLocalBundleItem(item, matcher, collectionMappings);
    const target = HumbleOwnership.offerContents(item, collectionMappings);
    resolvedItems.push({ item, match, target });
    // Large libraries can make an individual card comparison expensive. Yield
    // after a very small CPU slice so Humble can continue painting and loading
    // covers instead of waiting for every title to be checked.
    if (comparison) {
      comparison.completedItems = index + 1;
      if (comparison.job !== job) return;
      if (performance.now() - sliceStartedAt >= 12) {
        showComparisonProgress(`Checking your library\u2026 ${comparison.completedItems}/${items.length} items`);
        await yieldToBrowser();
        if (comparison.job !== job) return;
        sliceStartedAt = performance.now();
      }
    }
  }
  const completeContext=completeBundleMatchContext(resolvedItems,media);
  // Query copies only for identity context. Keep the owned result/offer unchanged.
  const identityRows=completeContext ? resolvedItems.filter(row=>row.match.state==='owned'&&!row.target.entries.length)
    .map(row=>({...row,item:{...row.item},contextOnly:true})) : [];
  const seriesQueries = HumbleOwnership.readingTargets(resolvedItems);
  await queryGalacticLibrary([...resolvedItems,...identityRows, ...seriesQueries.filter(query=>!query.unknownScope)], itemKind, comparison, job,diagnostic);
  if (comparison?.job !== job) return;
  // Retain the settled labels while awaiting GL or yielding CPU time. Clearing
  // them earlier makes our own card moves look like unprocessed lazy content.
  clearBundleAnnotations();
  for (const resolved of resolvedItems) {
    const { kind, lookupTitle } = resolved.item;
    // A context-only probe must not leak into this item's ownership/explanation.
    const result = resolved.match.state === 'owned' && !resolved.target.entries.length ? undefined
      : comparison?.galactic?.resultsByKey.get(resolved.item.galacticKey ?? galacticRequestKey(kind, lookupTitle));
    const coverage = HumbleOwnership.coverageFor(resolved.target, localContents, result);
    const externalMatches = resolved.match.state === 'owned' ? [] : ownedOutsideHumble(result, resolved.item)
      .filter(record => record.relationship !== 'contains' || coverage.complete && resolved.target.complete);
    const externalReviewMatches = needsOwnershipReviewOutsideHumble(result);
    const rejectedExact = ownedOutsideHumble(result).filter(record => record.relationship !== 'contains' && !externalMatches.includes(record));
    const externalPossibleMatches = [...possibleOutsideHumble(result), ...externalReviewMatches, ...rejectedExact];
    const uncertainOwnership = externalPossibleMatches.some(record => !HumbleOwnership.permanent(record));
    let match = externalMatches.length
      ? { state: 'elsewhere', externalMatches }
      : coverage.complete && (resolved.target.complete || coverage.total === 1)
        ? { state: coverage.covered.some(unit => unit.evidence.some(record => record.provider === 'humble')) ? 'owned' : 'elsewhere',
            externalMatches: coverage.covered.flatMap(unit => unit.evidence).filter(record => record.provider !== 'humble'),
            item: coverage.covered.flatMap(unit => unit.evidence).map(record => record.item).filter(Boolean), ownedReason: 'Full reviewed contents coverage with matching run and language.' }
      : coverage.owned > 0 && resolved.match.state !== 'owned'
        ? { state: 'partial', externalMatches: result?.partialMatches ?? [], range: { owned: coverage.owned, total: coverage.total, complete: false,
            items: coverage.covered.flatMap(unit => unit.evidence).map(record => record.item).filter(Boolean) } }
      : externalReviewMatches.length && !['owned', 'partial'].includes(resolved.match.state)
        ? { state: 'possible', externalPossibleMatches: externalReviewMatches, ownershipReview: true, possibleReason: 'This exact title is in Galactic Library, but ownership is unconfirmed or access is temporary.' }
      : externalPossibleMatches.length && !['owned', 'partial'].includes(resolved.match.state)
        ? { state: 'possible', externalPossibleMatches, ownershipReview: uncertainOwnership,
            possibleReason: uncertainOwnership ? 'Related library items found, but ownership is unconfirmed or access is temporary.'
              : 'Galactic Library returned related library items for review.' }
        : coverage.possibleCovered.length && resolved.match.state === 'new'
          ? { state: 'possible', possibleReason: 'Related contents found, but run or language is not sufficiently established.' }
          : resolved.match;
    if (resolved.match.state === 'owned') match = resolved.match;
    const lookup = comparison?.galactic;
    const lookupIncomplete = Boolean(lookup?.enabled && resolved.match.state !== 'owned'
      && ((resolved.item.galacticKey && !result) || (kind === 'software' && lookup.softwareCapabilityFailed)));
    const contentsLookupIncomplete = Boolean(lookup?.enabled && resolved.target.entries.length
      && (kind !== 'software' || lookup.softwareSupported) && !result?.coverage);
    if (lookupIncomplete && match.state === 'new') match = { state: 'unchecked',
      possibleReason: 'No local match found. Galactic Library could not complete the ownership check; this item may already be owned.' };
    match = { ...match, coverage, offered: resolved.item, localMatch: resolved.match, externalResult: result,
      externalPossibleMatches, lookupIncomplete, contentsLookupIncomplete, mappingConflicts: resolved.target.reason || '' };
    resolved.match = match;
    matchesByTitleKey.set(bundleItemKey(resolved.item), match);
    counts[match.state] += 1;
    titlesByState[match.state].push({
      title: resolved.item.title,
      provenance: matchProvenance(match),
      purchaseCount: matchPurchaseCount(match),
      range: match.range ?? null,
      match, offered: resolved.item
    });
    const tier = tiers.get(resolved.item.tier.label) ?? { ...resolved.item.tier, total: 0, owned: 0, elsewhere: 0, partial: 0, possible: 0, unchecked: 0 };
    tier.total += 1;
    if (match.state === 'owned') tier.owned += 1;
    if (match.state === 'elsewhere') tier.elsewhere += 1;
    if (match.state === 'partial') tier.partial += 1;
    if (match.state === 'possible') tier.possible += 1;
    if (match.state === 'unchecked') tier.unchecked += 1;
    tiers.set(resolved.item.tier.label, tier);
  }
  // Tier-detail cards are reliable for item/tier counts, but Humble can show
  // a separate un-tiered gallery as the actual visible card grid. Mirror the
  // already-resolved status onto all cover copies with the same title.
  const identityContext=new Map(identityRows.map(row=>[bundleItemKey(row.item),comparison?.galactic?.resultsByKey.get(row.item.galacticKey)]));
  HumbleOwnership.presentation.reconcileBundle(resolvedItems.map(row=>({...row,
    identityContext:identityContext.get(bundleItemKey(row.item)),
    contextIncomplete:Boolean(comparison?.galactic?.enabled&&identityContext.has(bundleItemKey(row.item))&&!identityContext.get(bundleItemKey(row.item))),overlapProtected:
    (media.productsByTitle.get(HumbleComicLibrary.titleKey(row.item.title))||[]).some(product=>/\b(?:pdf|epub|mobi|cbz|cbr|audiobook)\b/iu.test([product.format,product.formats,product.metadata?.format].flat().filter(Boolean).join(' ')))
    || /\b(?:pdf|epub|mobi|cbz|cbr|audiobook)\b/iu.test(row.item.element?.getAttribute?.('data-format')||row.item.container?.getAttribute?.('data-format')||'')})), {complete:completeBundleMatchContext(resolvedItems, media)});
  for (const entries of Object.values(titlesByState)) for (const entry of entries) entry.provenance = matchProvenance(entry.match);
  annotateAllCoverCopies(matchesByTitleKey, media);
  if (comparison) {
    comparison.lastMatchMs = Math.round(performance.now() - matchStartedAt);
    comparison.resolvedItems = resolvedItems;
    comparison.seriesLimited = seriesQueries.limited;
    comparison.seriesCoverage = HumbleOwnership.seriesCoverage(seriesQueries, localContents, comparison.galactic?.resultsByKey, Boolean(comparison.galactic?.enabled));
  }
  applyBundleNewItemsOnlyFilter(Boolean(comparison?.showNewItemsOnly));
  const summaryKind = items.every((item) => item.kind === 'audiobook') ? 'audiobook'
    : itemKind === 'book' && items.some((item) => item.kind === 'audiobook') ? 'mixed-books' : itemKind;
  renderComparisonSummary(counts, tiers, titlesByState, summaryKind, currentBundlePurchases, comparison);
  diagnostic.renderOutcome='rendered';
  } finally {if(comparison?.job!==job)diagnostic.renderOutcome='superseded';finishGalacticRendering(diagnostic);}
}

function classifyLocalBundleItem(item, matcher, collectionMappings = []) {
  const title = item.lookupTitle ?? item.title;
  const identity = HumbleOwnership.exactCandidate(item, identityCandidates(item, matcher));
  const exact = identity.ownedExact;
  const fallbackRecords = exact ? [] : ownershipFallbackCandidates(item, matcher, collectionMappings);
  const compatible = candidateLibrary(fallbackRecords.filter(record => HumbleOwnership.purchased(record) && !HumbleOwnership.conflicts(item, record, true).length));
  const rangeCandidates = candidateLibrary(fallbackRecords.filter(record => HumbleOwnership.purchased(record) && !HumbleOwnership.conflicts(item, record, true).filter(reason => reason !== 'Different enumerated issues/volumes').length));
  const volumeRange = exact ? null : findOwnedVolumeRange(title, rangeCandidates);
  const bookVariant = exact || volumeRange || item.kind !== 'book' ? null : findOwnedBookVariant(title, createLibraryMatcher(compatible, item.kind), item);
  const collectionIssue = exact || volumeRange || bookVariant || item.kind !== 'book' ? null : findOwnedCollectionIssue(title, compatible, collectionMappings, item);
  const possibleCollection = exact || volumeRange || bookVariant || collectionIssue || item.kind !== 'book'
    ? null : findOwnedCollectionIssue(title, compatible, collectionMappings, item, false);
  const possible = exact || volumeRange || bookVariant || collectionIssue ? null : identity.possible.length
    ? { items: identity.possible, reason: identity.reason } : possibleCollection
      ? { items: possibleCollection.item, reason: `${possibleCollection.reason} Language needs confirmation before contents can prove ownership.` }
      : findPossibleMatch(title, matcher, item.kind, item);
  const match = exact ? { state: 'owned', item: exact }
    : volumeRange ? { state: 'partial', item: volumeRange.items[0], range: volumeRange }
    : bookVariant ? { state: 'owned', item: bookVariant.item, ownedReason: bookVariant.reason }
    : collectionIssue ? { state: 'owned', item: collectionIssue.item, ownedReason: collectionIssue.reason }
    : possible ? { state: 'possible', item: possible.items, possibleReason: possible.reason,
      ...(identity.possible.some(record => !HumbleOwnership.purchased(record)) ? { ownershipReview: true,
        possibleReason: 'A Humble purchase exists, but its key is expired or unavailable. Check destination-library ownership.' } : {}) }
    : { state: 'new' };
  if (match.state === 'owned' || !matcher.historicalMatcher) return match;
  const previous = classifyLocalBundleItem(item, matcher.historicalMatcher, collectionMappings);
  if (previous.state === 'new') return match;
  const historicalItems = [...new Set([previous.item, previous.range?.items ?? []].flat(Infinity).filter(Boolean))]
    .map(record => ({ ...record, historical: true, ownership: 'unknown' }));
  if (!historicalItems.length) return match;
  const reason = 'Previously recorded in this Humble profile, but not observed in the current snapshot. Current ownership needs review.';
  if (match.state === 'partial') return { ...match, historicalItems };
  return { ...match, state: 'possible', ownershipReview: true, historicalItems,
    item: [match.item ?? [], historicalItems].flat(Infinity), possibleReason: [match.possibleReason, reason].filter(Boolean).join(' ') };
}

function yieldToBrowser() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function annotateAllCoverCopies(matchesByTitleKey, media) {
  for (const image of document.querySelectorAll('img.item-image[alt], img[class~="item-image"][alt]')) {
    if (!isBundleCover(image)) continue;
    const item = describeBundleItem({ title: image.alt, element: image, container: productContainer(image) }, media);
    const match = matchesByTitleKey.get(bundleItemKey(item));
    if (!match) continue;
    annotateBundleItem(item, match);
  }
}

function collectBundleItems(media = bundleMediaContext()) {
  const coverItems = collectCoverImageItems(media);
  // On current Humble bundle pages the cover image alt text is the item title.
  // It is much less ambiguous than nearby headings, which can include author,
  // promotion, or cumulative-tier text. Keep the heading strategy solely as a
  // fallback for older layouts without usable cover alt text.
  if (coverItems.length) return coverItems;

  const candidates = new Set();
  const titleSelector = [
    '[data-testid*="product" i] [data-testid*="title" i]',
    '[data-testid*="item" i] [data-testid*="title" i]',
    '[class*="product" i] h2', '[class*="product" i] h3', '[class*="product" i] h4',
    '[class*="item" i] h2', '[class*="item" i] h3', '[class*="item" i] h4',
    '[class*="entity" i] h2', '[class*="entity" i] h3', '[class*="entity" i] h4'
  ].join(', ');
  document.querySelectorAll(titleSelector).forEach((element) => candidates.add(element));

  // The last fallback intentionally requires a product-like ancestor so page
  // headings, navigation and tier names do not become false book titles.
  document.querySelectorAll('h2, h3, h4').forEach((element) => {
    if (element.closest('[data-testid*="product" i], [data-testid*="item" i], [class*="product" i], [class*="item" i], [class*="entity" i]')) candidates.add(element);
  });

  const byKey = new Map();
  for (const element of candidates) {
    if (element.closest('.expanded-info-view')) continue;
    const title = likelyItemTitle(element);
    if (!title) continue;
    const item = describeBundleItem({ title, element, container: productContainer(element), tier: findTier(element) }, media);
    const key = bundleItemKey(item);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, item);
  }
  const items = [...byKey.values()];
  // A bundle detail page may include an un-tiered all-items gallery for
  // browsing. When the same page also exposes priced tier groups, the gallery
  // must not become a fourth tier or double the bundle total.
  const tieredItems = items.filter((item) => item.tier.price !== null);
  return tieredItems.length ? tieredItems : items;
}

function collectCoverImageItems(media = bundleMediaContext()) {
  const byKey = new Map();
  const images = document.querySelectorAll('img.item-image[alt], img[class~="item-image"][alt]');
  for (const image of images) {
    if (!isBundleCover(image)) continue;
    const title = String(image.alt ?? '').replace(/\s+/gu, ' ').trim();
    if (!likelyItemTitle({ textContent: title })) continue;
    if (!HumbleComicLibrary.titleKey(title)) continue;
    const container = productContainer(image);
    // Ignore a campaign/brand image that happens to live in a generic product
    // wrapper. Book covers have a non-empty alt and a reasonably local card.
    if (!container || container === document.body) continue;
    const candidate = describeBundleItem({ title, element: image, container, tier: findTier(image) }, media);
    const key = bundleItemKey(candidate);
    const existing = byKey.get(key);
    // Humble often renders the same cover in an un-tiered gallery and in the
    // paid tier where it belongs. Prefer the paid-tier copy so counts remain
    // correct and a book is counted only once.
    if (!existing || candidate.tier.price !== null && (existing.tier.price === null || candidate.tier.price < existing.tier.price)) byKey.set(key, candidate);
  }
  const items = [...byKey.values()];
  // A bundle detail page may include an un-tiered all-items gallery for
  // browsing. When the same page also exposes priced tier groups, the gallery
  // must not become a fourth tier or double the bundle total.
  const tieredItems = items.filter((item) => item.tier.price !== null);
  return tieredItems.length ? tieredItems : items;
}

function likelyItemTitle(element) {
  const text = element.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
  if (text.length < 2 || text.length > 180) return null;
  const ignored = /^(buy|pay|details|learn more|view all|share|books|games|bundle|choose what you pay|about this bundle)$/iu;
  return ignored.test(text) || /^\$?\d+(?:\.\d{2})?$/u.test(text) ? null : text;
}

function productContainer(element) {
  return element.parentElement?.closest('[data-testid*="product" i], [data-testid*="item" i], [class*="product" i], [class*="item" i], [class*="entity" i], li, article') ?? element.parentElement;
}

function findTier(element) {
  const tierElement = findTierContainer(element);
  const price = tierElement ? extractTierPrice(tierElement) : null;
  const label = price === null ? 'Unresolved tier' : `$${price.toFixed(2)} tier`;
  return { label, price };
}

function findTierContainer(element) {
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    if (node.hasAttribute('data-tier') || /tier(?:[-_](?!item\b)|\b)/iu.test(String(node.className ?? '')) && !/tier[-_]?item/iu.test(String(node.className ?? ''))) return node;
  }
  return null;
}

function extractTierPrice(tierElement) {
  // A real tier heading precedes its item cards. Inspect headings/labels first
  // so Packt's individual ebook retail values cannot be mistaken for the
  // bundle price.
  const preferred = tierElement.querySelectorAll('[data-testid*="tier" i], [class*="tier" i]:not([class*="tier-item" i]), h1, h2, h3, h4');
  for (const element of preferred) {
    const price = extractPagePrice(element.textContent);
    if (price !== null) return price;
  }
  const text = tierElement.textContent ?? '';
  // Only accept a fallback price when the tier explicitly frames it as a
  // bundle threshold rather than merely listing a book's retail price.
  const threshold = text.match(/(?:pay|tier|unlock|get)\D{0,40}(?:\$|USD\s*)(\d+(?:\.\d{1,2})?)/iu);
  return threshold ? Number(threshold[1]) : null;
}

function extractPagePrice(text) {
  const match = String(text).match(/(?:\$|USD\s*)(\d+(?:\.\d{1,2})?)/iu);
  return match ? Number(match[1]) : null;
}

function createLibraryMatcher(libraryByKey, itemKind) {
  const byToken = new Map();
  const bookVariants = new Map();
  const bookVariantCandidates = new Map();
  const byIdentityTitle = new Map();
  const byEditionIdentifier = new Map();
  const byCandidateBase = new Map();
  const byPrimaryTitle = new Map();
  const byPresentationTitle = new Map();
  const byPossibleTitle = new Map();
  const add = (index, key, item) => { if (!key) return; const entries = index.get(key) ?? []; entries.push(item); index.set(key, entries); };
  const currentBundleBookVariants = [];
  for (const [, item] of libraryByKey) {
    add(byIdentityTitle, HumbleComicLibrary.titleKey(item.title), item);
    for (const key of globalThis.LibraryMatchingPolicy.ownershipTitleKeys(item.title,itemKind)) add(byPresentationTitle, key, item);
    for (const key of HumbleComicLibrary.candidateTitleKeys(item.title, itemKind)) add(byPossibleTitle, key, item);
    add(byCandidateBase, HumbleOwnership.editionParts(item.title, itemKind).base, item);
    const fields = HumbleComicLibrary.bibliographicFields(item);
    for (const isbn of fields.isbn ?? []) add(byEditionIdentifier, `isbn:${isbn}`, item);
    for (const field of ['asin', 'editionId']) if (fields[field]) add(byEditionIdentifier, `${field}:${fields[field]}`, item);
    for (const token of significantTokens(item.title)) {
      const entries = byToken.get(token) ?? new Set();
      entries.add(item);
      byToken.set(token, entries);
    }
    if (itemKind === 'book') {
      const parts = bookVariantParts(item.title);
      add(bookVariantCandidates, parts.key, item);
      add(byPrimaryTitle, bookTitleParts(item.title).primaryKey, item);
      if (parts.key && !bookVariants.has(parts.key)) bookVariants.set(parts.key, item);
      if (isFromCurrentBundle(item)) currentBundleBookVariants.push({ item, parts });
    }
  }
  return { libraryByKey, byToken, bookVariants, bookVariantCandidates, currentBundleBookVariants, byIdentityTitle, byEditionIdentifier, byCandidateBase, byPrimaryTitle, byPresentationTitle, byPossibleTitle };
}

function candidateLibrary(records) {
  const index = new Map();
  for (const item of records) {
    const key = HumbleComicLibrary.titleKey(item.title);
    index.set(index.has(key) ? `${key}\u0000${index.size}` : key, item);
  }
  return index;
}

function identityCandidates(item, matcher) {
  const candidates = new Set(matcher.byIdentityTitle.get(HumbleComicLibrary.titleKey(item.lookupTitle ?? item.title)) ?? []);
  for (const record of matcher.byPresentationTitle.get(HumbleComicLibrary.presentationTitle(item.lookupTitle ?? item.title, item.kind)) ?? []) candidates.add(record);
  const fields = HumbleComicLibrary.bibliographicFields(item);
  for (const isbn of fields.isbn ?? []) for (const record of matcher.byEditionIdentifier.get(`isbn:${isbn}`) ?? []) candidates.add(record);
  for (const field of ['asin', 'editionId']) if (fields[field]) for (const record of matcher.byEditionIdentifier.get(`${field}:${fields[field]}`) ?? []) candidates.add(record);
  return [...candidates];
}

function ownershipFallbackCandidates(item, matcher, mappings) {
  if (item.kind !== 'book') return [];
  const title = item.lookupTitle ?? item.title;
  const parts = bookVariantParts(title);
  const records = new Set(matcher.bookVariantCandidates.get(parts.key) ?? []);
  for (const candidate of matcher.currentBundleBookVariants) if (bookVolumeVariantsAlign(parts, candidate.parts)
    && (parts.base === candidate.parts.base || parts.base.startsWith(`${candidate.parts.base} `) || candidate.parts.base.startsWith(`${parts.base} `))) records.add(candidate.item);
  const range = /^(.*?)\s+vol(?:ume)?s?\.?\s*(\d+)\s*[-\u2013\u2014]\s*(\d+)\s*$/iu.exec(String(title).replace(/\b(?:preview|sample|read\s+now)\b/giu, '').trim());
  if (range && Number(range[3]) >= Number(range[2]) && Number(range[3]) - Number(range[2]) <= 1999) {
    for (let number = Number(range[2]); number <= Number(range[3]); number++) for (const record of matcher.byIdentityTitle.get(HumbleComicLibrary.titleKey(`${range[1]} Vol. ${number}`)) ?? []) records.add(record);
  }
  const units = HumbleCollectionMappings.titleContents(title);
  if (units.length === 1 && units[0].run) for (const mapping of mappings) for (const record of matcher.byIdentityTitle.get(HumbleComicLibrary.titleKey(mapping.collectionTitle)) ?? []) records.add(record);
  return [...records];
}

function findPossibleMatch(title, libraryMatcher, itemKind = 'book', offered = { title, kind: itemKind }) {
  const pool = new Set(identityCandidates(offered, libraryMatcher));
  for (const key of HumbleComicLibrary.candidateTitleKeys(title, itemKind)) for (const item of libraryMatcher.byPossibleTitle.get(key) ?? []) pool.add(item);
  for (const token of significantTokens(title)) for (const item of libraryMatcher.byToken.get(token) ?? []) pool.add(item);
  for (const item of libraryMatcher.byCandidateBase.get(HumbleOwnership.editionParts(title, itemKind).base) ?? []) pool.add(item);
  if (itemKind === 'book') {
    for (const item of libraryMatcher.byPrimaryTitle.get(bookTitleParts(title).primaryKey) ?? []) pool.add(item);
    for (const item of libraryMatcher.bookVariantCandidates.get(bookVariantParts(title).key) ?? []) pool.add(item);
  }
  const libraryByKey = candidateLibrary([...pool].filter(item => !HumbleOwnership.conflicts(offered, item).length));
  const byToken = libraryMatcher.byToken;
  const target = HumbleOwnership.editionParts(title, itemKind);
  const related = [...libraryByKey.values()].filter(item => {
    const candidate = HumbleOwnership.editionParts(item.title, itemKind);
    const same = HumbleComicLibrary.normalizeTitle(title) === HumbleComicLibrary.normalizeTitle(item.title);
    return same || (itemKind === 'game' || itemKind === 'book' || itemKind === 'audiobook')
      && candidate.base === target.base && (candidate.edition || target.edition)
      && (target.base.replace(/\s/gu, '').length >= (itemKind === 'game' ? 3 : 4) || HumbleOwnership.sharedIdentity(offered, item));
  }).sort((a, b) => naturalTitleCompare(a.title, b.title));
  if (related.length) return { items: related.length === 1 ? related[0] : related,
    reason: related.map(item => `${item.title}: ${HumbleOwnership.conflicts(offered, item, true).join('; ') || 'Related title/edition; identity requires review'}`).join('\n') };
  const formats = [...libraryByKey.values()].filter(item => itemKind === 'book' && bookVariantParts(item.title).key === bookVariantParts(title).key);
  if (formats.length) return { items: formats.length === 1 ? formats[0] : formats, reason: 'Related book presentation or title identity needs review.' };
  const discovered = [...libraryByKey.values()].map(item => ({ item, reason: HumbleComicLibrary.possibleTitleRelation(title, item.title, itemKind) }))
    .filter(candidate => candidate.reason).sort((a, b) => naturalTitleCompare(a.item.title, b.item.title));
  if (discovered.length) return { items: discovered.length === 1 ? discovered[0].item : discovered.map(candidate => candidate.item),
    reason: discovered.map(candidate => candidate.item.title + ': ' + candidate.reason).join('\n') };
  const numberedBase = numberedTitleBase(title);
  if (numberedBase) {
    const candidate = libraryByKey.get(numberedBase);
    // A listing such as "HAPPY 1" may be an issue-numbered presentation of
    // an imported title such as "Happy!". Keep this conservative: it is a
    // Possible match, never an automatic ownership claim.
    if (candidate) return { items: candidate, reason: 'The listing looks like an issue-numbered version of this library title.' };
  }
  if (itemKind === 'book') {
    const relatedBook = findPossibleBookTitleRelation(title, libraryByKey);
    if (relatedBook) return relatedBook;
  }
  if (itemKind === 'game') {
    const editionBase = gameEditionBase(title);
    const candidate = findGameEditionMatch(editionBase ?? HumbleComicLibrary.normalizeTitle(title), libraryByKey);
    // Store editions and collections often differ only by DLC. Treat this as
    // a Possible match so the user can review it, never as ownership.
    if (candidate) return { items: candidate, reason: 'The game titles differ only by edition wording.' };
    const component = findGameCollectionOrComponentMatch(title, libraryByKey);
    if (component) return { items: component, reason: 'This game may be included in the named library collection or multi-game entry.' };
  }
  if (itemKind === 'software') {
    const relatedSoftware = findPossibleSoftwareVersionRelation(title, libraryByKey);
    if (relatedSoftware) return relatedSoftware;
  }
  const titleTokens = significantTokens(title);
  if (titleTokens.size < 2) return null;
  let best = null;
  const candidates = new Set();
  for (const token of titleTokens) {
    for (const item of byToken.get(token) ?? []) candidates.add(item);
  }
  for (const item of candidates) {
    if (HumbleOwnership.conflicts(offered, item).length) continue;
    const key = HumbleComicLibrary.titleKey(item.title);
    const candidateTokens = new Set(key.split(' ').filter(Boolean));
    const overlap = [...titleTokens].filter((token) => candidateTokens.has(token)).length;
    const score = overlap / new Set([...titleTokens, ...candidateTokens]).size;
    // Potential matches are never counted as owned. This deliberately high
    // threshold catches trivial title variation while avoiding guesswork.
    if (score >= 0.82 && (!best || score > best.score)) best = { item, score };
  }
  return best ? { items: best.item, reason: 'The titles have a very close normalized word match.' } : null;
}

const BOOK_EDITION_LABEL = /^(?:(?:\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?:\s+(?:revised|updated))?|revised(?:\s+and\s+updated)?|updated(?:\s+and\s+revised)?|new|expanded|annotated)\s+(?:edition|ed\.?)$/iu;
const BOOK_EDITION_SUFFIX = /^(.*?)\s*(?:[\u002c;\u003a\u002d\u2013\u2014]\s*)?((?:(?:\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?:\s+(?:revised|updated))?|revised(?:\s+and\s+updated)?|updated(?:\s+and\s+revised)?|new|expanded|annotated)\s+(?:edition|ed\.?))\s*$/iu;

function bookTitleParts(title) {
  const original = String(title ?? '').replace(/\s+/gu, ' ').trim();
  let remaining = original;
  let hasEdition = false;
  let hasQualifier = false;
  const directEdition = BOOK_EDITION_SUFFIX.exec(remaining);
  if (directEdition?.[1]?.trim()) {
    remaining = directEdition[1].trim();
    hasEdition = true;
  }
  const parenthetical = /^(.*?)\s*\(([^()]*)\)\s*$/u.exec(remaining);
  if (parenthetical?.[1]?.trim()) {
    remaining = parenthetical[1].trim();
    hasQualifier = true;
    hasEdition = hasEdition || BOOK_EDITION_LABEL.test(parenthetical[2].trim());
  }
  const subtitle = /^(.*?)\s*:\s+(.+)$/u.exec(remaining);
  const primary = subtitle?.[1]?.trim() || remaining;
  return {
    key: HumbleComicLibrary.titleKey(original),
    primaryKey: HumbleComicLibrary.titleKey(primary),
    hasSubtitle: Boolean(subtitle),
    hasEdition,
    hasQualifier
  };
}

function hasStrongBookPrimaryTitle(primaryKey) {
  // Unlike generic word-overlap matching, this is a structured primary-title
  // comparison. Keep “book” as a word here so a real three-word title such as
  // “Long Book Title” is not weakened merely by its subject matter.
  const tokens = new Set(HumbleComicLibrary.titleKey(primaryKey).split(' ')
    .filter((token) => token.length > 1 && !['the', 'and', 'of', 'a', 'an', 'vol', 'volume'].includes(token)));
  const letters = [...tokens].join('').length;
  return tokens.size >= 3 || (tokens.size >= 2 && letters >= 14);
}

function findPossibleBookTitleRelation(title, libraryByKey) {
  const target = bookTitleParts(title);
  if (!target.primaryKey || !hasStrongBookPrimaryTitle(target.primaryKey)) return null;
  let best = null;
  for (const [, item] of libraryByKey) {
    const candidate = bookTitleParts(item.title);
    if (candidate.primaryKey !== target.primaryKey || candidate.key === target.key) continue;
    // Two independently subtitled books often share a franchise or a generic
    // main title. Do not infer a relationship unless an edition marker makes
    // that relationship explicit.
    if (target.hasSubtitle && candidate.hasSubtitle && !target.hasEdition && !candidate.hasEdition) continue;
    const hasStructuredDifference = target.hasSubtitle || candidate.hasSubtitle
      || target.hasEdition || candidate.hasEdition || target.hasQualifier || candidate.hasQualifier;
    if (!hasStructuredDifference) continue;
    if (!best || HumbleComicLibrary.titleKey(item.title).localeCompare(HumbleComicLibrary.titleKey(best.item.title)) < 0) best = { item, target, candidate };
  }
  if (!best) return null;
  const editionRelationship = best.target.hasEdition || best.candidate.hasEdition;
  return {
    items: best.item,
    reason: editionRelationship
      ? 'The book titles share a main title but differ by subtitle or edition wording.'
      : 'One book title is a shortened or qualified presentation of the other.'
  };
}

function findOwnedBookVariant(title, libraryMatcher, offered = { title, kind: 'book' }) {
  const target = bookVariantParts(title);
  const formatVariant = libraryMatcher.bookVariants.get(target.key);
  // TP and HC wording describe a presentation rather than a
  // different book. These remain safe exact matches after stripping only
  // those delivery-format labels.
  const formatSuffix = /\s+(?:tp|tpb|hc|hardcover|paperback|trade paperback|digital edition)$/iu;
  const variants = libraryMatcher.bookVariantCandidates.get(target.key) ?? [];
  const ambiguous = variants.length > 1;
  if (formatVariant && (!ambiguous || HumbleOwnership.sharedIdentity(offered, formatVariant))
    && globalThis.LibraryMatchingPolicy.fullTitleMatches(title, formatVariant.title, 'book')
    && (formatSuffix.test(String(title).trim()) || formatSuffix.test(String(formatVariant.title).trim()))
    && HumbleComicLibrary.normalizeTitle(title) !== HumbleComicLibrary.normalizeTitle(formatVariant.title)) return { item: formatVariant, reason: 'Matched after removing a book-format suffix.' };
  for (const { item, parts: candidate } of libraryMatcher.currentBundleBookVariants) {
    if (!bookVolumeVariantsAlign(target, candidate)) continue;
    // Humble sometimes names an entitlement with a volume subtitle while its
    // bundle card uses only the series and volume number. Trust that bridge
    // only when the matching entitlement came from this exact bundle.
    if (target.base === candidate.base || target.base.startsWith(`${candidate.base} `) || candidate.base.startsWith(`${target.base} `)) {
      return { item, reason: 'Matched to this bundle’s title-and-volume variant.' };
    }
  }
  return null;
}

function findOwnedCollectionIssue(title, libraryByKey, collectionMappings, offered = {}, confirmedOnly = true) {
  const requested = HumbleCollectionMappings.titleContents(title, HumbleComicLibrary.bibliographicFields(offered));
  if (requested.length !== 1 || !requested[0].run) return null;
  const target = requested[0];
  for (const ownedCollection of libraryByKey.values()) {
    const reviewed = HumbleOwnership.offerContents(ownedCollection, collectionMappings);
    if (!reviewed.mappings?.length || reviewed.uncertain) continue;
    const mapping = reviewed.mappings[0];
    const containsIssue = reviewed.entries.some(entry =>
      entry.completeness === 'full'
      && HumbleCollectionMappings.scopeKey(entry.series) === HumbleCollectionMappings.scopeKey(target.series)
      && entry.run === target.run && entry.unitType === target.unitType
      && HumbleCollectionMappings.numberKey(entry.number) === HumbleCollectionMappings.numberKey(target.number)
      && (!confirmedOnly || entry.language && target.language)
      && (!entry.language || !target.language || HumbleCollectionMappings.scopeKey(entry.language) === HumbleCollectionMappings.scopeKey(target.language)));
    if (containsIssue) {
      return {
        item: ownedCollection,
        mapping,
        reason: `Included in ${displayTitle(mapping.collectionTitle)} (${mapping.sourceLabel ?? 'collection mapping'}).`
      };
    }
  }
  return null;
}

function parseIssueTitle(title) {
  const pageLabel = String(title)
    .replace(/\b(?:preview|sample|read\s+now)\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const match = /^(.*?)\s*\((\d{4})\)\s*#\s*(\d+)\s*$/u.exec(pageLabel);
  if (!match) return null;
  const number = Number(match[3]);
  return Number.isInteger(number) ? { series: HumbleComicLibrary.titleKey(match[1]), year: Number(match[2]), number } : null;
}

function bookVariantParts(title) {
  const key = HumbleComicLibrary.titleKey(title)
    .replace(/\s+(?:tp|tpb|hc|hardcover|paperback|trade paperback|digital edition)$/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  // Entitlements and bundle cards often disagree about whether the volume
  // subtitle is present. Retain the series and volume for the verified
  // same-bundle bridge even when words follow the number.
  const match = /^(.*?)\s+vol\s*(\d+)(?:\s|$)/u.exec(key);
  return { key, base: match?.[1]?.trim() ?? key, volume: match ? Number(match[2]) : null };
}

function bookVolumeVariantsAlign(target, candidate) {
  if (target.volume !== null && candidate.volume !== null) return target.volume === candidate.volume;
  // A bare card title can describe volume one while Humble's entitlement
  // explicitly labels it Vol. 1. Require the same current bundle below.
  return (target.volume === null && candidate.volume === 1) || (target.volume === 1 && candidate.volume === null);
}

function isFromCurrentBundle(item) {
  return itemProvenance(item).some((record) => isCurrentBundleName(record.sourceBundle));
}

function findCurrentBundlePurchases(purchaseSummaries) {
  return purchaseSummaries
    .filter((purchase) => isCurrentBundleName(purchase.sourceBundle))
    .sort((left, right) => String(right.purchasedAt ?? '').localeCompare(String(left.purchasedAt ?? '')));
}

function isCurrentBundleName(sourceBundle) {
  // A publisher/title prefix can belong to several different bundles. Ignore
  // only the storefront's trailing site name, never substantive bundle words.
  const clean = value => globalThis.LibraryMatchingPolicy.presentationTitle(
    String(value ?? '').replace(/\s*[|\u2013\u2014-]\s*Humble Bundle\s*$/iu, ''), 'bundle');
  const currentBundle = clean(document.title);
  const source = clean(sourceBundle);
  return currentBundle.length >= 12 && currentBundle === source;
}

function numberedTitleBase(title) {
  const key = HumbleComicLibrary.titleKey(title);
  const match = /^(.*?)\s+#?(\d+)$/u.exec(key);
  return match?.[1]?.trim() || null;
}

function gameEditionBase(title) {
  const parts = HumbleOwnership.editionParts(title, 'game');
  return parts.edition ? parts.base : null;
}

function findGameEditionMatch(editionBase, libraryByKey) {
  for (const [key, item] of libraryByKey) {
    const candidateBase = gameEditionBase(item.title) ?? HumbleComicLibrary.normalizeTitle(item.title);
    if (candidateBase === editionBase) return item;
  }
  return null;
}

function findGameCollectionOrComponentMatch(title, libraryByKey) {
  const target = HumbleComicLibrary.titleKey(title);
  const targetTokens = target.split(' ').filter(Boolean);
  if (targetTokens.length < 2) return null;
  for (const [key, item] of libraryByKey) {
    // A purchased entry can explicitly name this game plus other games, as
    // with "XCOM: Enemy Unknown Plus, Civilization Revolution 2 Plus…".
    if (key.startsWith(`${target} `)) return item;
    if (!/\b(?:collection|complete pack|ultimate collection)\b/iu.test(key)) continue;
    const collectionBase = (gameEditionBase(key) ?? key)
      .replace(/\b(?:collection|pack)\b/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const collectionTokens = collectionBase.split(' ').filter(Boolean);
    // A named collection may include entries that start with its franchise
    // name (for example, BioShock: The Collection → BioShock Infinite).
    if (collectionTokens.length && collectionTokens.every((token) => targetTokens.includes(token))) return item;
  }
  return null;
}

function findOwnedVolumeRange(title, libraryByKey) {
  // Humble sometimes sells one card such as "Aftermath Vol. 1-3" while
  // purchases were imported as three separately downloadable volumes. Only
  // treat a range as owned when every numbered volume is present exactly.
  const pageLabel = String(title)
    .replace(/\b(?:preview|sample|read\s+now)\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const match = /^(.*?)\s+vol(?:ume)?s?\.?\s*(\d+)\s*(?:-|–|—|to)\s*(\d+)\s*$/iu.exec(pageLabel);
  if (!match) return null;
  const [, series, firstText, lastText] = match;
  const first = Number(firstText);
  const last = Number(lastText);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last - first > 1999) return null;
  const items = [];
  for (let volume = first; volume <= last; volume += 1) {
    const item = libraryByKey.get(HumbleComicLibrary.titleKey(`${series} Vol. ${volume}`));
    if (item) items.push(item);
  }
  if (!items.length) return null;
  return { complete: items.length === last - first + 1, owned: items.length, total: last - first + 1, items };
}

function significantTokens(title) {
  const ignore = new Set(['the', 'and', 'of', 'a', 'an', 'vol', 'volume', 'book', 'edition']);
  return new Set(HumbleComicLibrary.titleKey(title).split(' ').filter((token) => token.length > 1 && !ignore.has(token)));
}

function annotateBundleItem(bundleItem, match) {
  if (!bundleItem.element.isConnected) return;
  const isOwned = match.state === 'owned';
  const isElsewhere = match.state === 'elsewhere';
  const isPossible = match.state === 'possible';
  const isPartial = match.state === 'partial';
  const isUnchecked = match.state === 'unchecked';
  // The image wrapper scales on Humble hover, which turns a label attached to
  // it into a giant pill. Anchor the status to the stable item card instead.
  const badgeHost = bundleItem.container ?? bundleItem.element.parentElement;
  const provenance = matchProvenance(match);
  const purchaseCount = matchPurchaseCount(match);
  const localRecords=[match.item].flat(Infinity).filter(Boolean);
  const purchasedKey=isOwned&&localRecords.some(record=>(record.provenance?.length?record.provenance:[record])
    .some(origin=>origin.entitlement==='third-party-key')||record.kind==='game'&&record.source==='humble');
  badgeHost?.classList.add('hcl-badge-host');
  if (badgeHost) {
    badgeHost.dataset.hclBadge = isOwned
      ? purchasedKey ? `Purchased${purchaseCount>1?` ×${purchaseCount}`:''}` : purchaseCount > 1 ? `Owned ×${purchaseCount}` : 'Owned'
      : isElsewhere ? 'Owned elsewhere' : isPartial ? `Partial (${match.range.owned}/${match.range.total})` : isPossible ? (match.ownershipReview ? 'Check ownership' : 'Possible') : isUnchecked ? 'Check incomplete' : 'New';
    if (provenance) badgeHost.title = provenance;
    else badgeHost.removeAttribute('title');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hcl-status-button';
    button.dataset.state = match.state;
    button.textContent = badgeHost.dataset.hclBadge;
    button.title = 'Show ownership evidence and differences';
    button.setAttribute('aria-label', `${button.textContent}: explain ${bundleItem.title}`);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      showMatchInspector(match.offered ? match : { ...match, offered: bundleItem });
    });
    badgeHost.classList.add('hcl-interactive-badge');
    badgeHost.append(button);
    if(isPossible||isPartial){const noteHost=bundleItem.container??badgeHost;appendRelatedTitles(noteHost,match);}
  }
  const stateClass = isOwned ? 'owned' : isElsewhere ? 'elsewhere' : isPartial ? 'partial' : isPossible ? 'possible' : isUnchecked ? 'unchecked' : 'new';
  bundleItem.container?.classList.add(`hcl-${stateClass}-item`);
  bundleItem.element.classList.add(`hcl-cover-${stateClass}`);
  const card = findSingleCoverCard(bundleItem.element);
  card?.classList.add(`hcl-card-${stateClass}`);
  colorExactCardTitle(card, bundleItem.title, stateClass);
  applyVisibleCardStatus(bundleItem.container, stateClass);
  applyCoverStatus(bundleItem.element, stateClass);
}

function matchProvenance(match) {
  const tooltip=HumbleOwnership.presentation.tooltip(match.offered || {},match);
  const purchases=matchPurchaseCount(match);
  return tooltip+(purchases>1?`\nRecorded purchases: ${purchases} Humble purchases.`:'');
}

function matchLibraryItems(match) {
  const entries = match.range ? match.range.items : match.item ? [match.item] : [];
  return entries.flatMap((entry) => Array.isArray(entry) ? entry : [entry]).filter(Boolean);
}

function showMatchInspector(match, trigger = document.activeElement) {
  document.querySelector('#hcl-match-inspector')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'hcl-match-inspector';
  dialog.className = 'hcl-match-inspector';
  dialog.setAttribute('aria-labelledby', 'hcl-inspector-title');
  const heading = document.createElement('h2');
  heading.id = 'hcl-inspector-title';
  heading.textContent = match.offered?.title || 'Ownership evidence';
  dialog.append(heading);
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.autofocus=true;
  close.addEventListener('click', () => dialog.close());
  dialog.append(close);
  const plain=document.createElement('p'); plain.className='hcl-explanation'; plain.textContent=HumbleOwnership.presentation.explanation(match.offered || {}, match); dialog.append(plain);
  HumbleOwnership.presentation.renderCandidates(dialog,match.offered||{},match);
  const technical=document.createElement('details'); technical.className='hcl-technical-details'; const technicalTitle=document.createElement('summary'); technicalTitle.textContent='Match details'; technical.append(technicalTitle);
  const list = document.createElement('ul');
  for (const line of HumbleOwnership.explanationLines(match)) {
    const row = document.createElement('li');
    row.textContent = line;
    list.append(row);
  }
  HumbleOwnership.presentation.renderDeferred(technical,match.offered||{},match);
  technical.append(list); dialog.append(technical);
  const review = document.createElement('button');
  review.type = 'button';
  review.textContent = 'Review in Galactic Library';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const refreshEvidence=document.createElement('button');refreshEvidence.type='button';refreshEvidence.textContent='Refresh central evidence';refreshEvidence.addEventListener('click',()=>{dialog.close();window.dispatchEvent(new Event('hcl-refresh-central'));});
  review.addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'HCL_OPEN_GALACTIC_REVIEW' });
      status.textContent = response?.ok ? 'Opened Galactic Library. Use its ownership inspector or series coverage to review these titles.' : response?.error || 'Configure the Galactic Library link in Extension options.';
    } catch (error) { status.textContent = `Could not open review: ${error.message}`; }
  });
  if (match.externalResult || match.lookupIncomplete || match.contentsLookupIncomplete || match.state === 'elsewhere') dialog.append(review, refreshEvidence, status);
  dialog.addEventListener('close', () => {dialog.remove();if(trigger?.isConnected)trigger.focus();});
  document.body.append(dialog);
  dialog.showModal();
}

function matchPurchaseCount(match) {
  // A completed volume range represents several different owned works, rather
  // than duplicate purchases of one work. Only label a direct exact ownership
  // match as a duplicate.
  if (match.state !== 'owned' || match.range) return 0;
  const purchaseKeys = new Set();
  for (const item of matchLibraryItems(match)) {
    for (const record of itemProvenance(item)) {
      if (record.purchaseKey) purchaseKeys.add(record.purchaseKey);
    }
  }
  return purchaseKeys.size;
}

function itemProvenance(item) {
  const records = Array.isArray(item.provenance) && item.provenance.length
    ? item.provenance
    : [{
        title: item.title,
        sourceBundle: item.sourceBundle,
        purchaseKey: item.purchaseKey,
        purchasedAt: item.purchasedAt,
        ...(item.providerItemId ? { providerItemId: item.providerItemId } : {}),
        ...HumbleComicLibrary.entitlementFields(item),
        ...(Array.isArray(item.formats) ? { formats: item.formats } : {}),
        ...(item.delivery ? { delivery: item.delivery } : {}),
        ...(item.streaming ? { streaming: item.streaming } : {})
      }];
  return records.map((record) => ({
    ...record,
    title: record.title ?? item.title,
    ...(Array.isArray(record.formats) ? { formats: record.formats } : (Array.isArray(item.formats) ? { formats: item.formats } : {})),
    ...(record.delivery ? { delivery: record.delivery } : (item.delivery ? { delivery: item.delivery } : {})),
    ...(record.streaming || item.streaming ? { streaming: true } : {})
  }));
}

function formatPurchaseDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : `purchased ${date.toLocaleDateString()}`;
}

function applyCoverStatus(cover, state) {
  const color = statusColor(state);
  cover.style.setProperty('outline', `2px solid ${color}`, 'important');
  cover.style.setProperty('outline-offset', '2px', 'important');
  cover.style.removeProperty('box-shadow');
}

function applyVisibleCardStatus(card, state) {
  if (!card) return;
  const color = statusColor(state);
  // Humble attaches component CSS after the content script on some pages.
  // Inline !important styles are intentional here: this is the visible,
  // report-verified tier-item-details-view node, not an inferred wrapper.
  card.style.removeProperty('border-left');
  card.style.removeProperty('box-shadow');
  card.style.removeProperty('background-color');
  for (const text of card.querySelectorAll('h1, h2, h3, h4, h5, p, a, span')) {
    if (!text.textContent?.trim()) continue;
    text.style.setProperty('color', color, 'important');
  }
}

function findSingleCoverCard(cover) {
  let candidate = null;
  for (let node = cover.parentElement; node && node !== document.body; node = node.parentElement) {
    const covers = node.querySelectorAll('img.item-image[alt], img[class~="item-image"][alt]');
    if (covers.length !== 1) break;
    candidate = node;
  }
  return candidate;
}

function colorExactCardTitle(card, title, state) {
  if (!card) return;
  const expected = displayTitle(title).toLocaleLowerCase();
  const color = statusColor(state);
  const candidates = [...card.querySelectorAll('*')].filter((element) => {
    const text = displayTitle(element.textContent ?? '').toLocaleLowerCase();
    return text === expected;
  });
  // Use the deepest exact match to avoid coloring the card wrapper when a
  // smaller title element exists.
  const titleElement = candidates.at(-1);
  if (!titleElement) return;
  titleElement.classList.add('hcl-title-colored');
  titleElement.style.setProperty('color', color, 'important');
  titleElement.style.setProperty('font-weight', '700', 'important');
}

function statusColor(state) {
  return state === 'owned' ? 'var(--gh-owned-border, #0a7a42)' : state === 'elsewhere' ? 'var(--gh-elsewhere-border, #0f766e)' : state === 'new' ? 'var(--gh-new-border, #1769aa)' : state === 'partial' ? 'var(--gh-partial-border, #7c3fb0)' : state === 'unchecked' ? 'var(--gh-neutral-fill, #666666)' : 'var(--gh-possible-border, #b06d00)';
}

const SOFTWARE_VERSION_SUFFIX = /^(.*?)\s*(?:[,;:\-\u2013\u2014]\s*)?(?:(?:v(?:ersion)?\.?\s*)(\d+(?:\.\d+){0,3})|((?:19|20)\d{2}))\s*$/iu;

function softwareTitleParts(title) {
  const original = String(title ?? '').replace(/\s+/gu, ' ').trim();
  const match = SOFTWARE_VERSION_SUFFIX.exec(original);
  const base = match?.[1]?.trim() || original;
  return {
    key: HumbleComicLibrary.titleKey(original),
    baseKey: HumbleComicLibrary.titleKey(base),
    hasVersion: Boolean(match?.[1]?.trim())
  };
}

function hasStrongSoftwareBaseTitle(baseKey) {
  const tokens = new Set(HumbleComicLibrary.titleKey(baseKey).split(' ')
    .filter((token) => token.length > 1 && !['the', 'and', 'of', 'a', 'an', 'software', 'tool', 'tools'].includes(token)));
  const letters = [...tokens].join('').length;
  return tokens.size >= 2 && letters >= 8;
}

function findPossibleSoftwareVersionRelation(title, libraryByKey) {
  const target = softwareTitleParts(title);
  if (!target.baseKey || !hasStrongSoftwareBaseTitle(target.baseKey)) return null;
  let best = null;
  for (const [, item] of libraryByKey) {
    const candidate = softwareTitleParts(item.title);
    if (candidate.baseKey !== target.baseKey || candidate.key === target.key) continue;
    if (!target.hasVersion && !candidate.hasVersion) continue;
    if (!best || HumbleComicLibrary.titleKey(item.title).localeCompare(HumbleComicLibrary.titleKey(best.title)) < 0) best = item;
  }
  return best
    ? { items: best, reason: 'The software titles share a base name but have different version labels.' }
    : null;
}

function applyBundleNewItemsOnlyFilter(enabled) {
  document.querySelectorAll('.hcl-bundle-filtered').forEach((card) => card.classList.remove('hcl-bundle-filtered'));
  if (!enabled) return;
  document.querySelectorAll('.hcl-card-owned, .hcl-card-elsewhere').forEach((card) => card.classList.add('hcl-bundle-filtered'));
}

function appendRelatedTitles(host, match) {
  if (!['possible','partial'].includes(match.state)) return;
  const caption=HumbleOwnership.presentation.relatedCaption(match.offered||{},match);
  if (!caption) return;
  const note=document.createElement('small'); note.className='hcl-related-titles';
  note.textContent=(match.state==='partial'?'Overlap: ':match.ownershipReview?'Check ownership: ':'Possible match: ')+caption; host.append(note);
}

function appendBundleSummaryControls(summary) {
  const controls = document.createElement('div');
  controls.className = 'hcl-summary-controls';
  const minimize = document.createElement('button');
  minimize.type = 'button';
  minimize.className = 'hcl-summary-minimize';
  minimize.textContent = 'Minimize';
  minimize.setAttribute('aria-label', 'Minimize Humble Library bundle summary');
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'hcl-summary-expand';
  expand.textContent = 'Humble Library — Expand';
  expand.setAttribute('aria-label', 'Expand Humble Library bundle summary');
  const position=document.createElement('select');position.setAttribute('aria-label','Bundle summary position');
  for(const [value,label]of [['bottom-right','Bottom right'],['bottom-left','Bottom left'],['top-right','Top right'],['top-left','Top left']]){const option=document.createElement('option');option.value=value;option.textContent=label;position.append(option);}
  const status=document.createElement('small');status.setAttribute('role','status');status.hidden=true;
  const persist=()=>HumbleComicLibrary.storageSet({bundleSummaryPreferences:{...bundleSummaryPreferences}}).catch(error=>{status.hidden=false;status.textContent='Could not save panel preferences: '+error.message;});
  position.addEventListener('change',()=>{bundleSummaryPreferences.position=position.value;update();persist();});
  summary.addEventListener('hcl-summary-preferences',()=>update());
  const update = () => {
    summary.classList.toggle('hcl-summary-minimized', bundleSummaryPreferences.minimized);
    summary.dataset.position=bundleSummaryPreferences.position;position.value=bundleSummaryPreferences.position;position.hidden=bundleSummaryPreferences.minimized;
    minimize.hidden = bundleSummaryPreferences.minimized;
    expand.hidden = !bundleSummaryPreferences.minimized;
    minimize.setAttribute('aria-expanded', String(!bundleSummaryPreferences.minimized));
    expand.setAttribute('aria-expanded', String(!bundleSummaryPreferences.minimized));
  };
  minimize.addEventListener('click', () => {
    bundleSummaryPreferences.minimized = true;
    update();persist();
    expand.focus();
  });
  expand.addEventListener('click', () => {
    bundleSummaryPreferences.minimized = false;
    update();persist();
    minimize.focus();
  });
  controls.append(position,minimize, expand,status);
  summary.prepend(controls);
  update();
}

function renderComparisonSummary(counts, tiers, titlesByState, itemKind, currentBundlePurchases = [], comparison = null) {
  const viewState=captureSummaryState(document.querySelector('#hcl-summary')) ?? comparison?.summaryView;
  if (comparison) comparison.summaryView = null;
  if(comparison) comparison.renderSummary=()=>renderComparisonSummary(counts,tiers,titlesByState,itemKind,currentBundlePurchases,comparison);
  const summary = document.createElement('aside');
  summary.id = 'hcl-summary';
  summary.className = 'hcl-summary';
  const headline = document.createElement('strong');
  const title = document.createElement('strong'); title.textContent = 'Bundle ownership'; summary.append(title);
  headline.className = 'hcl-summary-counts';
  headline.textContent = `Owned ${counts.owned} · Owned elsewhere ${counts.elsewhere} · New ${counts.new} · Partial ${counts.partial} · Possible ${counts.possible}${counts.unchecked ? ` · Check incomplete ${counts.unchecked}` : ''}`;
  summary.append(headline);
    const countHelp=document.createElement('p');countHelp.className='library-ui-muted';countHelp.textContent='Possible needs review; Partial overlaps some known contents. New means no match in available data.';summary.append(countHelp);
  const highestTierPrice = Math.max(...[...tiers.values()].map((tier) => tier.price ?? 0));
  appendPurchasedBundleStatus(summary, currentBundlePurchases, highestTierPrice || null);
  const legend = document.createElement('div');
  legend.className = 'hcl-legend';
  legend.innerHTML = '<span class="hcl-legend-owned">Owned</span><span class="hcl-legend-elsewhere">Owned elsewhere</span><span class="hcl-legend-new">New</span><span class="hcl-legend-partial">Partial</span><span class="hcl-legend-possible">Possible</span><span class="hcl-legend-unchecked">Check incomplete</span>';
  summary.append(legend);
  if ((GALACTIC_LIBRARY_MEDIA_TYPES.has(itemKind) || itemKind === 'mixed-books') && comparison?.galactic?.enabled) {
    const galactic = document.createElement('p');
    galactic.className = comparison.galactic.error ? 'library-ui-warning' : 'library-ui-muted';
    galactic.textContent = comparison.galactic.error
      ? 'Galactic Library: check incomplete. Local results are retained.'
      : comparison.galactic.resultsByKey.size ? 'Galactic Library: checked linked libraries.' : 'Galactic Library: linked; no central checks completed on this page.';
    galactic.title = 'GL receives current bundle titles, media types, available catalog evidence, and explicit requested contents. Exact confirmed ownership and full reviewed contents are distinct from related editions or uncertain access.';
    summary.append(galactic);
    if ((comparison.galactic.error || comparison.galactic.softwareCapabilityFailed) && comparison.retryGalactic) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'hcl-retry-galactic';
      retry.textContent = 'Retry Galactic Library checks';
      retry.addEventListener('click', () => {
        if (retry.disabled) return;
        retry.disabled = true;
        comparison.retryGalactic();
      });
      summary.append(retry);
    }
  }
  if (!comparison?.galactic?.enabled) { const status=document.createElement('p'); status.className='library-ui-muted';status.textContent='Galactic Library: not linked — local library only.'; summary.append(status); }
  appendWishlistNotice(summary, comparison);
  appendBundleNewItemsOnlyFilter(summary, comparison);
  if (tiers.size > 1 || [...tiers.values()][0]?.price !== null) {
    const tierList = document.createElement('ul');
    const orderedTiers = [...tiers.values()].sort((left, right) => (left.price ?? Number.POSITIVE_INFINITY) - (right.price ?? Number.POSITIVE_INFINITY));
    let cumulativeTotal = 0;
    let cumulativeOwned = 0;
    let cumulativeElsewhere = 0;
    let cumulativePartial = 0;
    let cumulativePossible = 0;
    let cumulativeUnchecked = 0;
    for (const tier of orderedTiers) {
      // Humble's price levels are cumulative: the $15 level includes $5 items,
      // and so on. Each visual group contains the items first unlocked at that
      // price, so display the total actually received at each tier.
      cumulativeTotal += tier.total;
      cumulativeOwned += tier.owned;
      cumulativeElsewhere += tier.elsewhere;
      cumulativePartial += tier.partial;
      cumulativePossible += tier.possible;
      cumulativeUnchecked += tier.unchecked ?? 0;
      const newItems = confirmedNewItemCount({ total: cumulativeTotal, owned: cumulativeOwned, elsewhere: cumulativeElsewhere, partial: cumulativePartial, possible: cumulativePossible, unchecked: cumulativeUnchecked });
      const row = document.createElement('li');
      const priceText = tier.price === null ? tier.label : `${tier.label}: `;
      const perNew = tier.price !== null && newItems ? ` · $${(tier.price / newItems).toFixed(2)}/new` : '';
      row.textContent = `${priceText}${newItems} new / ${cumulativeTotal}${perNew}`;
      tierList.append(row);
    }
    summary.append(tierList);
  }
  const advanced=document.createElement('details'); advanced.className='hcl-advanced'; advanced.dataset.section='advanced';
  const advancedHeading=document.createElement('summary'); advancedHeading.textContent='Advanced'; advanced.append(advancedHeading);
  if (comparison?.resolvedItems) appendContentsSummary(advanced, comparison);
  if (comparison?.resolvedItems?.length) appendBundlePlan(advanced, comparison);
  if (comparison?.seriesCoverage?.length) appendSeriesCoverage(advanced, comparison);
  appendGalacticDetails(advanced, comparison);
  for (const state of ['owned', 'elsewhere', 'new', 'partial', 'possible', 'unchecked']) {
    if (!titlesByState[state]?.length) continue;
    const detail = document.createElement('details');
    detail.className = 'hcl-title-list'; detail.dataset.section=state;
    const heading = document.createElement('summary');
    heading.textContent = `${state === 'owned' ? 'Owned' : state === 'elsewhere' ? 'Owned elsewhere' : state === 'new' ? 'New' : state === 'partial' ? 'Partial' : state === 'unchecked' ? 'Check incomplete' : 'Possible matches'} (${titlesByState[state].length})`;
    detail.append(heading);
    const list = document.createElement('ol');
    for (const item of titlesByState[state].sort((left, right) => naturalTitleCompare(left.title, right.title))) {
      const row = document.createElement('li');
      row.textContent = `${displayTitle(item.title)}${item.purchaseCount > 1 ? ` — purchased ${item.purchaseCount} times` : ''}`;
      const view = HumbleOwnership.presentation.row(item.offered || item, item.match || {state});
      if(view.fraction)row.append(' — '+view.fraction);
      if (state === 'elsewhere' && view.providers.length) row.append(' — '+view.providers.join(', '));
      if (item.match && view.why) {
        const explain = document.createElement('button');
        explain.type = 'button';
        explain.textContent = 'Why?';explain.setAttribute('aria-label','Why '+item.title);
        explain.addEventListener('click', () => showMatchInspector(item.match));
        row.append(' ', explain);
      }
      if(item.match)appendRelatedTitles(row,item.match);
      if (item.offered && comparison) appendWishlistControl(row, item.offered, comparison);
      list.append(row);
    }
    detail.append(list);
    summary.append(detail);
  }
  if (comparison?.showDiagnostics) appendComparisonDiagnostics(advanced, comparison);
  if (advanced.children.length > 1) summary.append(advanced);
  const diagnostic = document.createElement('button');
  diagnostic.className = 'hcl-diagnostic-button';
  diagnostic.textContent = 'Download complete item list';
  diagnostic.title = 'Downloads Humble’s complete tier data without changing your selected tier.';
  diagnostic.addEventListener('click', async () => {
    diagnostic.disabled = true;
    const originalLabel = diagnostic.textContent;
    diagnostic.textContent = 'Preparing tier list…';
    try {
      const tierTitles = await tierTitlesFromPageData();
      if (!tierTitles.size) throw new Error('This page does not expose complete tier data.');
      downloadTierTitleList(tierTitles);
    } catch (error) {
      diagnostic.textContent = error.message;
      setTimeout(() => { diagnostic.textContent = originalLabel; diagnostic.disabled = false; }, 2500);
      return;
    }
    diagnostic.textContent = originalLabel;
    diagnostic.disabled = false;
  });
  summary.append(diagnostic);

  appendBundleSummaryControls(summary);
  removeComparisonProgress();
  const previous = document.querySelector('#hcl-summary');
  if (previous) previous.replaceWith(summary);
  else document.body.append(summary);
  restoreSummaryState(summary,viewState);
}

function appendBuyRecommendation(summary, tiers) {
  const orderedTiers = [...tiers.values()]
    .filter((tier) => tier.price !== null)
    .sort((left, right) => left.price - right.price);
  let recommendation = null;
  for (const tier of orderedTiers) {
    const confirmedNew = confirmedNewItemCount(tier);
    if (confirmedNew > 0) recommendation = tier;
  }
  if (!recommendation) return;
  const message = document.createElement('p');
  message.className = 'hcl-buy-recommendation';
  message.textContent = `Lowest tier containing all confirmed-new items: $${recommendation.price.toFixed(2)}`;
  message.title = 'Possible and partially owned items are excluded from this recommendation.';
  summary.append(message);
}

function appendBundleNewItemsOnlyFilter(summary, comparison) {
  if (!comparison) return;
  const label = document.createElement('label');
  label.className = 'hcl-bundle-filter';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = comparison.showNewItemsOnly;
  input.addEventListener('change', () => {
    comparison.showNewItemsOnly = input.checked;
    HumbleComicLibrary.storageSet({ showNewItemsOnly: input.checked }).catch(() => {});
    applyBundleNewItemsOnlyFilter(input.checked);
  });
  label.append(input, ' Hide owned items');
  label.title = 'Hides confirmed-owned items. Possible and partially owned items stay visible for review.';
  summary.append(label);
}

function appendComparisonDiagnostics(summary, comparison) {
  const details = document.createElement('details');
  details.className = 'hcl-diagnostics';
  const heading = document.createElement('summary');
  heading.textContent = 'Diagnostics';
  details.append(heading);
  const list = document.createElement('ul');
  const elapsed = Math.round(performance.now() - comparison.startedAt);
  const rows = [
    `Local library read: ${comparison.storageMs ?? 'unknown'} ms`,
    `Bundle items detected: ${comparison.itemCount}`,
    `Library records compared: ${comparison.libraryCount}`,
    `Last comparison: ${comparison.lastMatchMs ?? 'unknown'} ms`,
    `Comparison refreshes: ${comparison.refreshes}`,
    comparison.sorting ? `Bundle sorting: ${comparison.sorting.distinctCards}/${comparison.sorting.sourceItems} distinct card candidates in ${comparison.sorting.directParents} parent container${comparison.sorting.directParents === 1 ? '' : 's'}; ${comparison.sorting.directGroups} card group${comparison.sorting.directGroups === 1 ? '' : 's'} (${comparison.sorting.directCardsMoved} cards moved); ${comparison.sorting.rowSections} multi-row section${comparison.sorting.rowSections === 1 ? '' : 's'} (${comparison.sorting.rowCardsMoved} cards moved)` : 'Bundle sorting: not run yet',
    `Extension elapsed time: ${elapsed} ms`
  ];
  for (const text of rows) {
    const row = document.createElement('li');
    row.textContent = text;
    list.append(row);
  }
  details.append(list);
  summary.append(details);
}

function renderPurchasedBundleSummary(currentBundlePurchases) {
  if (!currentBundlePurchases.length) return;
  document.querySelector('#hcl-summary')?.remove();
  const summary = document.createElement('aside');
  summary.id = 'hcl-summary';
  summary.className = 'hcl-summary';
  appendPurchasedBundleStatus(summary, currentBundlePurchases);
  appendBundleSummaryControls(summary);
  document.body.append(summary);
}

function appendPurchasedBundleStatus(summary, purchases, highestTierPrice = null) {
  if (!purchases.length) return;
  const paidAmounts = purchases.map((purchase) => Number(purchase.pricePaid)).filter(Number.isFinite);
  const hasTopTier = highestTierPrice === null || !paidAmounts.length || paidAmounts.some((amount) => amount >= highestTierPrice);
  const status = document.createElement('p');
  status.className = `hcl-purchased-bundle ${hasTopTier ? 'hcl-purchased-full library-ui-status-owned' : 'hcl-purchased-partial library-ui-status-partial'}`;
  const label = hasTopTier ? 'Already purchased' : 'Partially purchased';
  status.textContent = `${label}${purchases.length > 1 ? ` (${purchases.length} times)` : ''}: ${purchases.map(formatBundlePurchase).join(' · ')}`;
  summary.append(status);
}

function formatBundlePurchase(purchase) {
  const date = formatPurchaseDate(purchase.purchasedAt)?.replace(/^purchased\s+/u, '');
  const amount = Number(purchase.pricePaid);
  const price = Number.isFinite(amount) && purchase.currency
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency: purchase.currency }).format(amount)
    : '';
  return [date, price].filter(Boolean).join(' · ') || 'purchase recorded';
}

function displayTitle(title) {
  return String(title).replace(/\s+preview$/iu, '').trim();
}

function downloadTierTitleList(tierTitles) {
  const lines = [document.title, location.href, ''];
  const ordered = [...tierTitles.values()].sort((left, right) => left.price - right.price);
  for (const tier of ordered) {
    const titles = [...tier.titles.values()];
    lines.push(`${tier.label} — ${titles.length} title${titles.length === 1 ? '' : 's'}`);
    for (const title of titles.sort((left, right) => globalThis.LibraryTitleSort.compare(left,right))) lines.push(`- ${title}`);
    lines.push('');
  }
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: 'humble-bundle-tier-titles.txt' });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function tierTitlesFromPageData() {
  // Some Humble page variants hydrate this JSON after the content script runs,
  // so read the DOM first and then use a same-origin page fetch as a fallback.
  let source = document.querySelector('#webpack-bundle-page-data')?.textContent?.trim();
  if (!source) {
    try {
      const response = await fetch(location.href, { credentials: 'same-origin' });
      const html = await response.text();
      source = html.match(/<script\s+id=["']webpack-bundle-page-data["'][^>]*>\s*([\s\S]*?)\s*<\/script>/iu)?.[1];
    } catch {
      // The page DOM may still provide tier data; the download button gives the
      // user a visible error if neither source is available.
    }
  }
  if (!source) return new Map();
  try {
    const bundle = JSON.parse(source).bundleData;
    if (!bundle?.tier_display_data || !bundle?.tier_pricing_data || !bundle?.tier_item_data) return new Map();
    const tierTitles = new Map();
    for (const identifier of bundle.tier_order ?? Object.keys(bundle.tier_display_data)) {
      const display = bundle.tier_display_data[identifier];
      const price = Number(bundle.tier_pricing_data[identifier]?.['price|money']?.amount);
      if (!display || !Number.isFinite(price)) continue;
      const titles = new Map();
      for (const itemId of display.tier_item_machine_names ?? []) {
        const title = bundle.tier_item_data[itemId]?.human_name;
        if (title) titles.set(HumbleComicLibrary.titleKey(title), displayTitle(title));
      }
      tierTitles.set(identifier, { label: `$${price.toFixed(2)} tier`, price, titles });
    }
    return tierTitles;
  } catch {
    return new Map();
  }
}

function ensurePurchaseImporter() {
  if (!document.body) {
    setTimeout(ensurePurchaseImporter, 50);
    return;
  }
  addPurchaseImporter();
}

function appendWishlistControl(row, offered, comparison) {
  const label = document.createElement('label');
  label.className = 'hcl-wishlist-control';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox'; toggle.setAttribute('aria-label','Wishlist '+offered.title);
  toggle.disabled = offered.kind === 'unknown';
  toggle.checked = (comparison.wishlistItems ?? []).some(item => HumbleOwnership.wishlistMatches(item, offered));
  toggle.addEventListener('change', async () => {
    try {
      const entry={title:offered.title,kind:offered.kind==='unknown'?'book':offered.kind,weight:1,...HumbleComicLibrary.bibliographicFields(offered)};
      toggle.disabled=true;
      const matches=(comparison.wishlistItems||[]).filter(wish=>HumbleOwnership.wishlistMatches(wish,offered));
      let wanted=comparison.wishlistItems;
      if(toggle.checked)wanted=await HumbleComicLibrary.storageRequest('wishlist','add',[matches[0]||entry]);
      else for(const wish of matches)wanted=await HumbleComicLibrary.storageRequest('wishlist','remove',HumbleComicLibrary.catalogItemKey(wish));
      comparison.wishlistItems = wanted;
      document.querySelector('#hcl-bundle-plan')?.dispatchEvent(new Event('hcl-plan-update'));
    } catch (error) { toggle.checked = !toggle.checked; status.textContent=error.message; } finally { toggle.disabled=false; }
  });
  const status=document.createElement('small');status.setAttribute('role','status');
  label.append(toggle, ' Wishlist');
  row.append(' ', label,status);
}

function appendBundlePlan(summary, comparison) {
  const panel = document.createElement('details');
  panel.id = 'hcl-bundle-plan';
  panel.className = 'hcl-bundle-plan library-ui-planning';
  panel.open = false;
  const heading = document.createElement('summary');
  heading.textContent = 'Wishlist and purchase planning';
  panel.append(heading);
  const label = document.createElement('label');
  label.textContent = 'Goal ';
  const goal = document.createElement('select');
  goal.id = 'hcl-plan-goal';
  goal.setAttribute('aria-label','Purchase planning goal');
  for (const [value, text] of [['items', 'Confirmed-new products'], ['contents', 'Additional full issues/volumes'], ['wishlist', 'Wishlist items']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = text; goal.append(option);
  }
  goal.value = comparison.planGoal || 'items';
  label.append(goal); panel.append(label);
  const uncertainLabel = document.createElement('label');
  const uncertain = document.createElement('input'); uncertain.type = 'checkbox'; uncertain.id = 'hcl-plan-uncertain'; uncertain.checked = Boolean(comparison.planIncludeUncertain);
  uncertainLabel.append(uncertain, ' Include Possible items');
  panel.append(uncertainLabel);
  const output = document.createElement('div'); output.className = 'hcl-plan-output'; output.setAttribute('aria-live', 'polite'); panel.append(output);
  const update = () => {
    comparison.planGoal = goal.value; comparison.planIncludeUncertain = uncertain.checked;
    output.replaceChildren();
    let plan;
    try { plan = HumbleOwnership.planBundle(comparison.resolvedItems, comparison.wishlistItems ?? [], goal.value, uncertain.checked); }
    catch (error) { output.textContent = `Could not calculate this plan: ${error.message}`; return; }
    const recommendation = document.createElement('p'); recommendation.className = 'hcl-buy-recommendation';
    recommendation.textContent = plan.lowest ? `Lowest tier satisfying this goal: $${plan.lowest.price.toFixed(2)}`
      : plan.goalCount ? 'No known priced tier satisfies every target in this goal.' : 'No eligible targets for this goal in the bundle.';
    output.append(recommendation);
    const list = document.createElement('ul');
    for (const tier of plan.tiers) {
      const row = document.createElement('li');
      row.textContent = `$${tier.price.toFixed(2)}: ${tier.confirmedNewItems} confirmed-new items · ${tier.newUnits} new known units (${tier.addedUnits} added at this tier) · wishlist priority ${tier.wishlistValue} across ${tier.wishlistCount} items${tier.uncertainItems ? ` · ${tier.uncertainItems} uncertain selections` : ''}${tier.costPerNewUnit !== null ? ` · $${tier.costPerNewUnit.toFixed(2)} per known new unit` : ''}`;
      list.append(row);
    }
    output.append(list);
    const note = document.createElement('p');
    note.textContent = `Overlapping contents count once. Wishlist priority is your weight, not a monetary appraisal. Unconfirmed units and incomplete checks have no verified new-unit value.${plan.excludedUncertain && !uncertain.checked ? ` ${plan.excludedUncertain} Possible or unconfirmed Partial matches are excluded from the plan.` : ''} Manage wishes below or in Extension options.`;
    output.append(note);
  };
  goal.addEventListener('change', update); uncertain.addEventListener('change', update); panel.addEventListener('hcl-plan-update', update);
  update(); appendWishManager(panel,comparison); summary.append(panel);
}

function appendWishManager(panel, comparison) {
  const details=document.createElement('details');details.dataset.section='wishlist-manager';
  const heading=document.createElement('summary');heading.textContent='Manage wishes for this bundle';details.append(heading);
  const count=document.createElement('p'),previous=document.createElement('button'),next=document.createElement('button'),list=document.createElement('ul'),status=document.createElement('p');
  previous.type=next.type='button';previous.textContent='Previous items';next.textContent='Next items';status.setAttribute('role','status');status.dataset.wishlistStatus='true';
  const products=[...new Map(comparison.resolvedItems.map(row=>[HumbleComicLibrary.catalogItemKey(row.item),row.item])).values()];
  const paint=()=>{
    comparison.wishPage=Math.min(comparison.wishPage||0,Math.max(0,Math.ceil(products.length/50)-1));
    previous.disabled=comparison.wishPage===0;next.disabled=(comparison.wishPage+1)*50>=products.length;
    count.textContent=`Page ${comparison.wishPage+1}; showing up to 50 of ${products.length} offers.`;list.replaceChildren();
    for(const product of products.slice(comparison.wishPage*50,(comparison.wishPage+1)*50)){
      const wishes=(comparison.wishlistItems||[]).filter(wish=>HumbleOwnership.wishlistMatches(wish,product)).sort((a,b)=>b.weight-a.weight),wish=wishes[0];
      const row=document.createElement('li');row.dataset.title=product.title;row.append(product.title+' ');
      const weight=document.createElement('input');weight.type='number';weight.min='1';weight.max='100';weight.value=String(wish?.weight||1);weight.setAttribute('aria-label','Wishlist priority for '+product.title);
      const save=document.createElement('button'),remove=document.createElement('button');save.type=remove.type='button';save.textContent=wish?'Save priority':'Add to wishlist';remove.textContent='Remove wish';remove.disabled=!wish;
      const change=async deleting=>{save.disabled=remove.disabled=true;try{
        if(deleting)for(const entry of wishes)comparison.wishlistItems=await HumbleComicLibrary.storageRequest('wishlist','remove',HumbleComicLibrary.catalogItemKey(entry));
        else comparison.wishlistItems=await HumbleComicLibrary.storageRequest('wishlist','add',[{...(wish||{title:product.title,kind:product.kind,...HumbleComicLibrary.bibliographicFields(product)}),weight:Number(weight.value)}]);
        const output=document.querySelector('#hcl-bundle-plan [data-wishlist-status]')||status;output.textContent='Wishlist saved; ownership was not changed.';
      }catch(error){status.textContent=error.message;save.disabled=false;remove.disabled=!wish;}};
      save.addEventListener('click',()=>change(false));remove.addEventListener('click',()=>change(true));row.append(weight,save,remove);list.append(row);
    }
  };
  previous.addEventListener('click',()=>{comparison.wishPage--;paint();});next.addEventListener('click',()=>{comparison.wishPage++;paint();});details.append(count,previous,next,list,status);paint();panel.append(details);
}


function appendContentsSummary(summary, comparison) {
  const content=HumbleOwnership.bundleContents(comparison.resolvedItems||[]);
  if(!content.additional.length&&!content.covered.length&&!content.uncertain.length)return;
  const details=document.createElement('details');details.id='hcl-bundle-contents';details.dataset.section='contents';
  const heading=document.createElement('summary');heading.textContent=`Bundle contents and overlap — ${content.additional.length} additional · ${content.covered.length} covered · ${content.uncertain.length} uncertain`;details.append(heading);
  const note=document.createElement('p');note.textContent='Distinct full issues/volumes across checked libraries; overlapping offers count once. Additional means not found within known run/language scope.';details.append(note);
  if(content.noContentsProducts){const note=document.createElement('p');note.textContent=`${content.noContentsProducts} offers have no enumerable contents; they are outside these unit counts.`;details.append(note);}
  if(content.incompleteProducts){const note=document.createElement('p');note.textContent=`${content.incompleteProducts} offers need a complete check before their added units can be assessed.`;details.append(note);}
  for(const tier of content.tiers){const note=document.createElement('p');note.textContent=`$${tier.price.toFixed(2)} tier: ${tier.additional} distinct additional units (cumulative).`;details.append(note);}
  for(const [label,entries]of [['Additional',content.additional],['Already covered',content.covered],['Needs review',content.uncertain]]){
    if(!entries.length)continue;
    const units=appendPagedUnits(details,entries,entry=>{const row=document.createElement('li');row.textContent=HumbleOwnership.unitLabel(entry);return row;},'contents-'+label);
    units.querySelector('summary').textContent=`${label} (${entries.length})`;
  }
  summary.append(details);
}
function appendGalacticDetails(summary, comparison) {
  if(!comparison?.galactic?.enabled)return;
  const details=document.createElement('details');details.className='hcl-galactic-details';details.dataset.section='galactic';
  const heading=document.createElement('summary');heading.textContent='Galactic Library details';details.append(heading);
  const status=document.createElement('p');status.className=comparison.galactic.error?'library-ui-warning':'library-ui-muted';status.textContent=comparison.galactic.error||`${comparison.galactic.resultsByKey.size} checks completed. Humble copies in Galactic Library are excluded.`;details.append(status);
  const hint=document.createElement('p');hint.className='library-ui-muted';hint.textContent='Retry checks missing or failed results. Refresh fetches fresh central evidence, including successful checks. Local evidence is retained.';details.append(hint);
  const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh central evidence';refresh.addEventListener('click',()=>comparison.refreshGalactic?.());details.append(refresh);
  if(comparison.galactic.error&&comparison.retryGalactic){const retry=document.createElement('button');retry.type='button';retry.textContent='Retry Galactic Library checks';retry.addEventListener('click',()=>comparison.retryGalactic());details.append(retry);}
  const review=document.createElement('button');review.type='button';review.textContent='Review in Galactic Library';const output=document.createElement('p');output.setAttribute('role','status');
  review.addEventListener('click',async()=>{try{const response=await chrome.runtime.sendMessage({type:'HCL_OPEN_GALACTIC_REVIEW'});output.textContent=response?.ok?'Opened Galactic Library.':response?.error||'Configure the Galactic Library link in Extension options.';}catch(error){output.textContent=error.message;}});details.append(review,output);
  const reminders=HumbleOwnership.centralReminders([...(comparison.resolvedItems||[]).map(row=>row.match),...(comparison.seriesCoverage||[])]);
  if(reminders.length){const list=appendPagedUnits(details,reminders,reminder=>{const row=document.createElement('li');row.textContent=`${reminder.title} · ${displayProviderName(reminder.provider)}: ${reminder.text}`;return row;},'central-reminders');list.querySelector('summary').textContent=`Evidence reminders (${reminders.length})`;}
  summary.append(details);
}
function appendSeriesCoverage(summary, comparison) {
  const panel=document.createElement('details');panel.id='hcl-series-coverage';panel.className='hcl-series-coverage';panel.dataset.section='series';
  const heading=document.createElement('summary');heading.textContent='Series coverage and gaps';panel.append(heading);
  const note=document.createElement('p');note.textContent='Issues and volumes are compared within the same series version and language. Gaps describe this range, not a complete reading order. Annuals and specials appear only when explicitly identified.';panel.append(note);
  if(comparison.seriesLimited){const note=document.createElement('p');note.textContent='Comparison bounded to 100 series, 2,000 units per series and 20,000 units total. Unchecked ranges need review.';panel.append(note);}
  for(const group of comparison.seriesCoverage){
    const section=document.createElement('details');section.dataset.section='series-'+HumbleOwnership.seriesKey(group);
    const heading=document.createElement('summary');heading.textContent=`${group.series} · ${group.run||'unknown run'} · ${group.language||'unknown language'} · ${group.unitType}: ${group.covered}/${group.entries.length} covered`;section.append(heading);
    const described=[['Compared range',group.entries],['Offered here',group.entries.filter(entry=>group.offeredKeys?.has(HumbleCollectionMappings.contentKey(entry)))],['Owned elsewhere',group.entries.filter(entry=>entry.state==='covered'&&entry.evidence.some(record=>record.provider!=='humble'))],['Missing in compared range',group.gaps]];
    for(const [label,entries]of described)if(entries.length){const text=document.createElement('p');text.textContent=`${label}: ${conciseUnitNumbers(entries)}${label==='Missing in compared range'?` (Gaps: ${conciseUnitNumbers(entries)})`:''}`;section.append(text);}
    if(group.lookupIncomplete||group.uncertain.length){const text=document.createElement('p');text.className='library-ui-warning';text.textContent=`Needs review: ${group.uncertain.length} units. Unconfirmed scope or incomplete checks cannot establish gaps.`;section.append(text);}
    if(group.enumerationLimited){const text=document.createElement('p');text.textContent='Large spans show only the bounded explicit units; missing numbers outside the compared range are unknown.';section.append(text);}
    appendPagedUnits(section,group.entries,entry=>{const row=document.createElement('li');row.dataset.coverage=entry.state;row.textContent=`${entry.unitType} ${entry.number}: ${entry.state==='covered'?'Owned':entry.state==='uncertain'?'Needs review':'Gap'}${group.offeredKeys?.has(HumbleCollectionMappings.contentKey(entry))?' · offered here':' · not offered here'}`;const sources=[...new Set(entry.evidence.map(record=>`${record.title} (${displayProviderName(record.provider)})`))];if(sources.length)row.append(' — '+sources.join('; '));return row;},section.dataset.section+'-units');panel.append(section);
  }
  summary.append(panel);
}

function schedulePurchaseFocus() {
  clearTimeout(purchaseFocusTimer);
  purchaseFocusTimer = setTimeout(focusRequestedPurchase, 125);
}

async function focusRequestedPurchase() {
  const { hclPurchaseFocus: request = null } = await chrome.storage.local.get({ hclPurchaseFocus: null });
  const purchaseKey = String(request?.purchaseKey ?? '').trim();
  const requestedAt = Number(request?.requestedAt);
  if (!purchaseKey) return;
  if (!Number.isFinite(requestedAt) || Date.now() - requestedAt > PURCHASE_FOCUS_MAX_AGE_MS) {
    await HumbleComicLibrary.storageRemove('hclPurchaseFocus');
    return;
  }
  const target = findPurchaseFocusTarget(purchaseKey, request);
  if (!target) return;
  if (target.tagName === 'A') {
    // Follow Humble's own individual-purchase link when the current page
    // exposes one. Navigate this same tab rather than programmatically
    // clicking a target=_blank link, which browsers rightly treat as a
    // popup outside the original Options-page user gesture.
    const destination = safePurchaseLinkDestination(target);
    if (destination) {
      await HumbleComicLibrary.storageRemove('hclPurchaseFocus');
      location.assign(destination);
      return;
    }
  }
  if (target.hasAttribute('data-hb-gamekey')) {
    // Humble's current Purchases cards retain the order identifier as a data
    // attribute instead of putting it in an individual-order URL. Activating
    // the matching card follows Humble's normal signed-in detail flow.
    await HumbleComicLibrary.storageRemove('hclPurchaseFocus');
    target.click();
    return;
  }
  const card = target.closest('article, li, [data-purchase-key], [data-order-key], [data-gamekey], [data-hb-gamekey], [class*="purchase" i], [class*="order" i]') ?? target;
  card.classList.add('hcl-purchase-focus');
  card.setAttribute('tabindex', '-1');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.focus({ preventScroll: true });
  showPurchaseFocusNotice('Purchase highlighted. Open it in Humble to reveal or redeem its entitlement.');
  setTimeout(() => card.classList.remove('hcl-purchase-focus'), 20000);
  await HumbleComicLibrary.storageRemove('hclPurchaseFocus');
}

function findPurchaseFocusTarget(purchaseKey, request = {}) {
  for (const link of document.querySelectorAll('a[href]')) {
    if (purchaseLinkMatches(link, purchaseKey)) return link;
  }
  for (const element of document.querySelectorAll('[data-purchase-key], [data-order-key], [data-gamekey], [data-hb-gamekey], [data-key]')) {
    if (['data-purchase-key', 'data-order-key', 'data-gamekey', 'data-hb-gamekey', 'data-key'].some((name) => element.getAttribute(name) === purchaseKey)) return element;
  }
  const bundleName = normalisePurchaseFocusText(request.sourceBundle);
  if (!bundleName) return null;
  for (const link of document.querySelectorAll('a[href]')) {
    if (normalisePurchaseFocusText(link.textContent).includes(bundleName)) return link;
  }
  return null;
}

function purchaseLinkMatches(link, purchaseKey) {
  const href = link.getAttribute('href') ?? '';
  try {
    const url = new URL(href, location.href);
    return [...url.searchParams.values()].includes(purchaseKey) || url.pathname.split('/').includes(purchaseKey);
  } catch {
    return href.includes(encodeURIComponent(purchaseKey)) || href.includes(purchaseKey);
  }
}

function safePurchaseLinkDestination(link) {
  try {
    const url = new URL(link.getAttribute('href') ?? '', location.href);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === location.origin ? url.href : null;
  } catch {
    return null;
  }
}

function normalisePurchaseFocusText(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

function showPurchaseFocusNotice(message) {
  document.querySelector('#hcl-purchase-focus-notice')?.remove();
  const notice = document.createElement('div');
  notice.id = 'hcl-purchase-focus-notice';
  notice.className = 'hcl-purchase-focus-notice';
  notice.setAttribute('role', 'status');
  notice.textContent = message;
  document.body.append(notice);
  setTimeout(() => notice.remove(), 8000);
}

function addPurchaseImporter() {
  if (document.querySelector('#hcl-importer')) return;
  const panel = document.createElement('section');
  panel.id = 'hcl-importer';
  panel.className = 'hcl-importer';
  panel.innerHTML = `
    <div class="library-import-description"><strong>Humble Comic Library</strong> <span>Import purchases from the Humble account signed in to this browser.</span><details><summary>How account nicknames work</summary><p>Choose a local nickname, such as personal. It does not sign you in or detect your account. Only the active account is checked for ownership. Use Saved accounts below to switch back to a saved snapshot, then Import new purchases to refresh it. Rename account keeps its purchases and scan history. For a new account, sign in on the website, enter a new nickname, select Save a new account, and rescan all purchases once.</p></details></div>
    <div class="library-import-profile">
      <label>Account nickname <input data-profile-label maxlength="100" placeholder="e.g. personal"></label>
      <label><input type="checkbox" data-profile-confirm> The signed-in account matches this nickname</label>
      <label><input type="checkbox" data-profile-switch> Save a new account on full rescan</label>
    </div>
    <div class="library-import-footer"><output aria-live="polite"></output>
    <div class="hcl-import-actions">
      <button type="button" data-import-mode="new" title="Imports new purchases, updates older saved purchases automatically, and rechecks unresolved key status.">Import new purchases</button>
      <button type="button" data-import-mode="all" title="Reprocesses every purchase, rebuilds Humble items, and establishes complete key reminders.">Rescan all purchases</button>
      <button type="button" data-import-mode="software-discovery" data-hcl-debug-action hidden title="Downloads a local diagnostic report of non-book product classification signals for Software support.">Inspect Software product data</button>
      <button type="button" data-import-mode="key-discovery" data-hcl-debug-action hidden title="Creates a safe, aggregate report of Humble's key-status fields without saving keys or purchase details.">Inspect key reminder data</button>
      <button type="button" data-import-mode="purchase-navigation-discovery" data-hcl-debug-action hidden title="Downloads a safe structural report of purchase-page links and attributes. It never includes titles, URLs, purchase identifiers, or redemption keys.">Inspect purchase navigation</button>
    </div>
    </div>`;
  LibraryAccountProfiles.mount(panel.querySelector('.library-import-description'),{request:HumbleComicLibrary.storageRequest,keys:['humbleProfileLabel','profileArchives'],onActiveChange:(label,previous)=>{const input=panel.querySelector('[data-profile-label]');if(previous===undefined&&input.value)return;const changed=input.value!==label;input.value=label;if(changed){panel.querySelector('[data-profile-confirm]').checked=false;if(previous!==undefined)panel.querySelector('.library-import-footer > output').textContent='Active account: '+(label||'Not yet named')+'. Import new purchases checks for updates.';}panel.querySelector('[data-profile-switch]').checked=false;}});
  panel.querySelector('[data-profile-label]').addEventListener('input',()=>{panel.querySelector('[data-profile-confirm]').checked=false;});
  const buttons = [...panel.querySelectorAll('[data-import-mode]')];
  const debugButtons = [...panel.querySelectorAll('[data-hcl-debug-action]')];
  const status = panel.querySelector('output');
  chrome.storage.local.get({ showDiagnostics: false, keyReminderScan: null, humbleProfileLabel:'' })
    .then(({ showDiagnostics, keyReminderScan, humbleProfileLabel }) => {
      if(!panel.querySelector('[data-profile-label]').value)panel.querySelector('[data-profile-label]').value=humbleProfileLabel;
      debugButtons.forEach((button) => { button.hidden = !showDiagnostics; });
      const reminderNotice = keyReminderSyncNotice(keyReminderScan);
      if (reminderNotice) status.textContent = reminderNotice;
    })
    .catch(() => {});
  for (const button of buttons) button.addEventListener('click', async () => {
    const mode = button.dataset.importMode;
    const fullRescan = mode === 'all';
    const keyDiscovery = mode === 'key-discovery';
    const softwareDiscovery = mode === 'software-discovery';
    const purchaseNavigationDiscovery = mode === 'purchase-navigation-discovery';
    if (fullRescan && !confirm('Rescan every Humble purchase? This can take a while.')) return;
    if (softwareDiscovery && !confirm('Inspect non-book product classification metadata in every Humble purchase? This can take a while. The downloaded local report includes product titles and bundle names, but never redemption keys, purchase identifiers, URLs, or cookies.')) return;
    if (keyDiscovery && !confirm('Inspect third-party key reminder metadata in every Humble purchase? This can take a while. The downloaded report contains only aggregate field names and counts; it saves no key values, titles, bundle names, or purchase identifiers.')) return;
    if (purchaseNavigationDiscovery && !confirm('Inspect the rendered Purchases page structure? The downloaded local report contains only aggregate tag names, attribute names, and link shapes; it contains no titles, URLs, purchase identifiers, redemption keys, dates, or text content.')) return;
    buttons.forEach((control) => { control.disabled = true; });
    try {
      if (keyDiscovery) {
        const result = await discoverKeyReminderMetadata((message) => { status.textContent = message; });
        downloadJsonFile('humble-key-reminder-discovery.json', result.report);
        status.textContent = `Inspected ${result.scannedPurchases} purchase${result.scannedPurchases === 1 ? '' : 's'} and found ${result.keyRecords} third-party key record${result.keyRecords === 1 ? '' : 's'}; downloaded a safe aggregate report${result.failures ? ` (${result.failures} purchase${result.failures === 1 ? '' : 's'} could not be inspected)` : ''}.`;
        return;
      }
      if (softwareDiscovery) {
        const result = await discoverSoftwareProductMetadata((message) => { status.textContent = message; });
        downloadJsonFile('humble-software-product-discovery.json', result.report);
        status.textContent = `Inspected ${result.scannedPurchases} purchase${result.scannedPurchases === 1 ? '' : 's'} and recorded ${result.candidateProducts} non-book/non-audiobook product${result.candidateProducts === 1 ? '' : 's'}; downloaded a local Software classification report${result.failures ? ` (${result.failures} purchase${result.failures === 1 ? '' : 's'} could not be inspected)` : ''}.`;
        return;
      }
      if (purchaseNavigationDiscovery) {
        const result = inspectPurchaseNavigation();
        downloadJsonFile('humble-purchase-navigation-discovery.json', result.report);
        status.textContent = 'Inspected ' + result.anchorCount + ' link' + (result.anchorCount === 1 ? '' : 's') + ' and ' + result.candidateCount + ' possible purchase element' + (result.candidateCount === 1 ? '' : 's') + '; downloaded a safe structural navigation report.';
        return;
      }
      const result = await importPurchases((message) => { status.textContent = message; }, { fullRescan, profileLabel:panel.querySelector('[data-profile-label]').value, confirmed:panel.querySelector('[data-profile-confirm]').checked, switchProfile:panel.querySelector('[data-profile-switch]').checked });
      const scope = purchaseImportScope(result);
      const reminders = result.keyReminders;
      const reminderStatus = reminders.complete
        ? `${reminders.unrevealed} pending key reminder${reminders.unrevealed === 1 ? '' : 's'}${reminders.expiringSoon ? `, ${reminders.expiringSoon} expiring within 30 days` : ''}`
        : `${reminders.unrevealed} pending key reminder${reminders.unrevealed === 1 ? '' : 's'}; older purchases have not been checked yet—use Rescan all purchases for complete reminders`;
      status.textContent = `${scope}; imported ${result.added} new item${result.added === 1 ? '' : 's'} (${result.addedGames} game${result.addedGames === 1 ? '' : 's'}${result.addedSoftware ? `, ${result.addedSoftware} software item${result.addedSoftware === 1 ? '' : 's'}` : ''}${result.addedAudiobooks ? `, ${result.addedAudiobooks} audiobook${result.addedAudiobooks === 1 ? '' : 's'}` : ''})${result.datesBackfilled ? ` and backfilled ${result.datesBackfilled === 1 ? '' : 's'} purchase date${result.datesBackfilled === 1 ? '' : 's'}` : ''}${result.failures ? `; ${result.failures} purchase${result.failures === 1 ? '' : 's'} could not be imported and will be retried next time` : ''}; ${reminderStatus}${reminders.failures ? `; ${reminders.failures} key-reminder check${reminders.failures === 1 ? '' : 's'} will be retried` : ''}; ${result.total} total items.`;
    } catch (error) {
      if (/kQuotaBytes/iu.test(error.message)) {
        status.textContent = 'Import failed (Storage Quota Exceeded): Chrome storage quota exceeded. Your existing library and manual corrections were preserved. Try exporting a backup or clearing unused archived accounts.';
      } else {
        status.textContent = `Import failed: ${error.message}`;
      }
    } finally {
      buttons.forEach((control) => { control.disabled = false; });
    }
  });
  document.body.prepend(panel);
}

async function importPurchases(report, { fullRescan = false, profileLabel='', confirmed=false, switchProfile=false } = {}) {
  const scan=await HumbleComicLibrary.storageRequest('begin',{fullRescan,profileLabel,confirmed,switchProfile});
  fullRescan=fullRescan||scan.forceFull;
  // This endpoint is used by Humble's purchase pages. Fetching occurs in the
  // authenticated Humble tab, so no cookie is read, copied, or stored by us.
  report('Loading your purchase list…');
  const orders = await fetchJson('/api/v1/user/order?all=true');
  const orderList = Array.isArray(orders) ? orders : orders?.data ?? orders?.orders;
  if (!Array.isArray(orderList)) throw new Error('Humble returned an unexpected purchase list. Please report this page format.');
  const {
    libraryItems = [],
    purchaseSummaries: existingPurchases = [],
    historicalLibraryItems = [],
    historicalPurchaseSummaries = [],
    lastImport: priorImport = null,
    mediaImportVersion = 1,
    keyReminders: existingReminders = [],
    keyReminderScan: priorReminderScan = null,
    mediaTypeOverrides = {},
    rejectedPurchaseItems = []
  } = scan.state;
  const priorPurchases = new Map();
  for (const purchase of historicalPurchaseSummaries) {
    const previous = priorPurchases.get(purchase.purchaseKey);
    if (!previous || (purchase.importVersion ?? 0) >= (previous.importVersion ?? 0)) priorPurchases.set(purchase.purchaseKey, purchase);
  }
  for (const purchase of existingPurchases) priorPurchases.set(purchase.purchaseKey, purchase);
  const previouslyScanned = new Set([...priorPurchases.keys(), ...[...libraryItems, ...historicalLibraryItems].flatMap(itemProvenance).map(origin=>origin.purchaseKey)].filter(Boolean));
  // Only a per-purchase stamp certifies the complete extraction + local migration.
  // A global marker cannot certify purchases later restored or synced into it.
  const needsUpgrade = key => previouslyScanned.has(key) && (priorPurchases.get(key)?.importVersion ?? 0) < CURRENT_IMPORT_VERSION;
  // Version 4 recognizes Humble's audio download platform, generic audio
  // category, and audio download formats. One complete backfill lets established installations
  // discover audio from purchases previously marked
  // as scanned, after which normal incremental import resumes.
  const audioBackfill = mediaImportVersion < 4;
  // Version 6 recognizes positively identified Software deliveries and
  // Software-bundle entitlements in addition to explicit product types.
  // Reprocess existing entitlement-like records once so earlier entries can
  // be corrected from the live Humble metadata.
  const softwareBackfill = mediaImportVersion < 6;
  const entitlementBackfill = mediaImportVersion < 7;

  const purchaseKey = (order) => order?.gamekey ?? order?.key ?? order?.order_key;
  if (orderList.some((order) => typeof purchaseKey(order) !== 'string' || !purchaseKey(order).trim())) {
    throw new Error('Humble returned a purchase without a valid identifier. No scan data was changed.');
  }
  const priorFailedPurchaseKeys = new Set(priorImport?.failedPurchaseKeys ?? []);
  const titlePurchaseKeys = new Set(orderList.filter((order) => {
    const key = purchaseKey(order);
    return key && (fullRescan || needsUpgrade(key) || priorFailedPurchaseKeys.has(key) || !previouslyScanned.has(key));
  }).map(purchaseKey));
  const allPurchaseKeys = new Set(orderList.map(purchaseKey).filter(Boolean));
  const newPurchaseKeys = new Set([...allPurchaseKeys].filter((key) => !previouslyScanned.has(key)));
  const successfullyChecked = new Set(priorReminderScan?.purchaseKeys ?? []);
  const failedReminderKeys = new Set(priorReminderScan?.failedPurchaseKeys ?? []);
  const pendingReminderKeys = new Set(existingReminders.map((record) => record.purchaseKey).filter(Boolean));
  const dueKeyPurchaseKeys = new Set(libraryItems.flatMap(itemProvenance)
    .filter(record=>record.entitlement==='third-party-key'&&record.expiresAt&&Date.parse(record.expiresAt)<=Date.now())
    .map(record=>record.purchaseKey).filter(Boolean));
  // A normal import only refreshes newly discovered purchases and entries that
  // still need attention. An explicit full rescan is the deliberate, complete
  // reminder baseline for purchases imported before this feature existed.
  const reminderPurchaseKeys = fullRescan
    ? allPurchaseKeys
    : new Set([...newPurchaseKeys, ...pendingReminderKeys, ...failedReminderKeys, ...dueKeyPurchaseKeys]);
  // Refresh ownership evidence whenever a pending purchase is revisited, and
  // establish reminders while backfilling older key evidence.
  for (const key of reminderPurchaseKeys) if (allPurchaseKeys.has(key)) titlePurchaseKeys.add(key);
  for (const key of titlePurchaseKeys) if ((priorPurchases.get(key)?.importVersion ?? mediaImportVersion) < 7) reminderPurchaseKeys.add(key);
  const purchasesToInspect = orderList.filter((order) => {
    const key = purchaseKey(order);
    return key && (titlePurchaseKeys.has(key) || reminderPurchaseKeys.has(key));
  });
  // The removed recovery tool could revisit saved orders absent from the index.
  // Keep that recovery in the normal upgrade, without making retired items current.
  if (!fullRescan) for (const key of previouslyScanned) if (!allPurchaseKeys.has(key) && needsUpgrade(key)) {
    purchasesToInspect.push({gamekey:key}); titlePurchaseKeys.add(key);
  }
  // Keep new purchases distinct from known orders fetched to refresh safe key
  // evidence. Their detail request is shared, but they are different user actions.
  const retriedPurchases = [...allPurchaseKeys].filter((key) => previouslyScanned.has(key) && priorFailedPurchaseKeys.has(key)).length;
  const refreshedKeyPurchases = [...reminderPurchaseKeys].filter((key) => allPurchaseKeys.has(key) && previouslyScanned.has(key) && !priorFailedPurchaseKeys.has(key)).length;
  const scope = {
    fullRescan, audioBackfill, softwareBackfill, entitlementBackfill,
    metadataUpgrades: fullRescan ? 0 : purchasesToInspect.filter(order=>needsUpgrade(purchaseKey(order))).length,
    scannedPurchases: purchasesToInspect.length,
    newPurchases: newPurchaseKeys.size, retriedPurchases, refreshedKeyPurchases,
    skippedKnown: orderList.filter(order=>!titlePurchaseKeys.has(purchaseKey(order))).length
  };
  report(purchaseImportScope(scope, true) + '\u2026');

  let imported = [];
  const metadataEvidence = [];
  const historicalUpgrades = [];
  const purchaseSummaries = [];
  const failures = [];
  const reminders = new Map(existingReminders.map((record) => [record.id, record]));
  let reminderFailures = 0;
  const rejected = fullRescan ? [] : [...rejectedPurchaseItems];
  for (let index = 0; index < purchasesToInspect.length; index += 1) {
    const order = purchasesToInspect[index];
    const key = purchaseKey(order);
    const importTitles = titlePurchaseKeys.has(key);
    const refreshReminders = reminderPurchaseKeys.has(key);
    const action = fullRescan ? 'Rescanning all purchases'
      : needsUpgrade(key) ? 'Updating older saved purchases (one-time update)'
      : newPurchaseKeys.has(key) ? 'Importing new purchases'
      : priorFailedPurchaseKeys.has(key) ? 'Retrying previously failed purchases'
      : newPurchaseKeys.size ? 'Rechecking key status in existing purchases'
      : 'No new purchases; rechecking key status in existing purchases';
    report(`${action}: purchase ${index + 1} of ${purchasesToInspect.length}\u2026`);
    try {
      const detail = await fetchOrderDetail(key);
      if (!detail || typeof detail !== 'object' || Array.isArray(detail)
        || !['subproducts', 'products', 'tpkd_dict', 'all_tpks', 'all_tpkds', 'downloads', 'product', 'human_name'].some((field) => Object.hasOwn(detail, field))) {
        throw new Error('Unexpected purchase detail.');
      }
      if (['subproducts', 'products', 'all_tpks', 'all_tpkds'].some((field) => Object.hasOwn(detail, field) && !Array.isArray(detail[field]))
        || ['all_tpks', 'all_tpkds'].some((field) => detail.tpkd_dict && Object.hasOwn(detail.tpkd_dict, field) && !Array.isArray(detail.tpkd_dict[field]))) {
        throw new Error('Unexpected purchase product list.');
      }
      const items = importTitles ? extractLibraryItems(detail, order, key, mediaTypeOverrides, rejected) : [];
      const summary = importTitles ? createPurchaseSummary(detail, order, key, items) : null;
      if (refreshReminders) {
        const nextReminders = extractKeyReminderRecords(detail, order, key);
        for (const [id, record] of reminders) if (record.purchaseKey === key) reminders.delete(id);
        nextReminders.forEach((record) => reminders.set(record.id, record));
        successfullyChecked.add(key);
        failedReminderKeys.delete(key);
      }
      if (summary) {
        metadataEvidence.push(...items);
        if (allPurchaseKeys.has(key)) { imported.push(...items); purchaseSummaries.push(summary); }
        else historicalUpgrades.push({...priorPurchases.get(key), purchaseKey:key, importVersion:CURRENT_IMPORT_VERSION});
      }
    } catch {
      if (importTitles) failures.push(key);
      if (refreshReminders) {
        reminderFailures += 1;
        failedReminderKeys.add(key);
        successfullyChecked.delete(key);
      }
    }
    // Avoid piling up requests against Humble for accounts with long histories.
    await new Promise((resolve) => setTimeout(resolve, 175));
  }

  // Only a complete explicit rescan can prune the current Humble snapshot.
  // Media backfills continue to correct entitlement classification separately.
  const reconciled = fullRescan && failures.length === 0 && reminderFailures === 0;
  const upgraded = HumbleComicLibrary.enrichMissingProductIds({libraryItems,historicalLibraryItems}, metadataEvidence, {legacyImport:true});
  // Carry user classifications onto newly recovered IDs before merging imports.
  const migratedOverrides = {...mediaTypeOverrides};
  for (const item of [...upgraded.libraryItems, ...upgraded.historicalLibraryItems]) if (item.manualKind) for (const origin of itemProvenance(item)) {
    if (origin.purchaseKey && origin.providerItemId) migratedOverrides[`${origin.purchaseKey}:${origin.providerItemId}`] = item.manualKind;
  }
  imported = imported.map(item=>{
    const override=migratedOverrides[`${item.purchaseKey}:${item.providerItemId}`];
    return override ? {...item,kind:override,manualKind:override} : item;
  });
  const retainedItems = reconciled
    ? libraryItems.filter((item) => item.source !== 'humble').map(retainManualLibraryItem)
    : fullRescan ? libraryItems : refreshImportedClassifications(upgraded.libraryItems, metadataEvidence);
  const merged = new Map();
  for (let item of retainedItems) {
    const overrideKey = HumbleComicLibrary.mediaOverrideKey?.(item);
    const override = mediaTypeOverrides[overrideKey] || (item.providerItemId && mediaTypeOverrides[item.providerItemId]);
    if (override && item.kind !== override) {
      item = { ...item, kind: override, automaticKind: item.automaticKind || item.kind, manualKind: override };
    }
    const key=libraryItemKey(item);
    merged.set(key,merged.has(key)?mergeLibraryItem(merged.get(key),item):item);
  }
  let added = 0;
  let addedGames = 0;
  let addedSoftware = 0;
  let addedAudiobooks = 0;
  let datesBackfilled = 0;
  const priorItemsByKey = new Map(libraryItems.map((item) => [libraryItemKey(item), item]));
  for (const item of imported) {
    const key = libraryItemKey(item);
    if (!key) continue;
    const existing = merged.get(key);
    if (existing) {
      // Re-imports are safe and let us enrich older entries when Humble reveals
      // more purchase metadata than an earlier response exposed.
      if (!existing.purchasedAt && item.purchasedAt) {
        datesBackfilled += 1;
      }
      merged.set(key, mergeLibraryItem(existing, item));
      continue;
    }
    merged.set(key, withProvenance(item));
    if (!priorItemsByKey.has(key)) {
      added += 1;
      if (item.kind === 'game') addedGames += 1;
      if (item.kind === 'software') addedSoftware += 1;
      if (item.kind === 'audiobook') addedAudiobooks += 1;
    }
  }
  const importSummary = {
    importedAt: new Date().toISOString(),
    scannedPurchases: titlePurchaseKeys.size,
    skippedKnown: orderList.filter(order=>!titlePurchaseKeys.has(purchaseKey(order))).length,
    addedTitles: added,
    addedGames,
    addedSoftware,
    addedAudiobooks,
    datesBackfilled,
    pricedPurchases: purchaseSummaries.filter((purchase) => purchase.pricePaid !== null).length,
    skippedPurchases: failures.length,
    fullRescan,
    reconciled,
    failedPurchaseKeys: failures
  };
  const allPurchases = new Map((reconciled ? [] : existingPurchases).map((purchase) => [purchase.purchaseKey, purchase]));
  for (const purchase of purchaseSummaries) allPurchases.set(purchase.purchaseKey, purchase);
  const checkedAt = new Date().toISOString();
  if (reconciled) {
    for (const [id, record] of reminders) if (!allPurchaseKeys.has(record.purchaseKey)) reminders.delete(id);
    for (const key of successfullyChecked) if (!allPurchaseKeys.has(key)) successfullyChecked.delete(key);
    for (const key of failedReminderKeys) if (!allPurchaseKeys.has(key)) failedReminderKeys.delete(key);
  }
  const reminderRecords = [...reminders.values()];
  const baselinePurchaseKeys = fullRescan
    ? [...allPurchaseKeys]
    : Array.isArray(priorReminderScan?.baselinePurchaseKeys)
      ? priorReminderScan.baselinePurchaseKeys.filter((key) => allPurchaseKeys.has(key))
      : priorReminderScan?.complete
        // The original reminder scan recorded all successful keys in
        // purchaseKeys. Keep existing complete scans complete when upgrading.
        ? [...allPurchaseKeys]
        : [];
  const baselineComplete = (reconciled || baselinePurchaseKeys.length > 0)
    && baselinePurchaseKeys.every((key) => successfullyChecked.has(key) && !failedReminderKeys.has(key));
  const expiringSoon = reminderRecords.filter((record) => {
    const days = keyReminderDaysRemaining(record, checkedAt);
    return days !== null && days >= 0 && days <= 30;
  }).length;
  const keyReminders = {
    complete: baselineComplete,
    checkedAt,
    purchaseKeys: [...successfullyChecked],
    baselinePurchaseKeys,
    failedPurchaseKeys: [...failedReminderKeys]
  };
  const importedKeys = new Set([...merged.values()].map(item => `${item.purchaseKey}:${item.providerItemId || item.title}`));
  const dedupedRejected = [];
  const seenRejected = new Set();
  for (const item of rejected) {
    const rKey = `${item.purchaseKey}:${item.providerItemId || item.title}`;
    if (importedKeys.has(rKey) || importedKeys.has(`${item.purchaseKey}:${item.title}`)) continue;
    if (!seenRejected.has(rKey)) {
      seenRejected.add(rKey);
      const rec = { ...item };
      if (Array.isArray(rec.formats) && !rec.formats.length) delete rec.formats;
      if (!rec.delivery) delete rec.delivery;
      if (!rec.streaming) delete rec.streaming;
      dedupedRejected.push(rec);
    }
  }
  await HumbleComicLibrary.storageRequest('commit',scan.token,{
    rejectedPurchaseItems: dedupedRejected,
    libraryItems: [...merged.values()],
    purchaseSummaries: [...allPurchases.values()],
    historicalLibraryItems: reconciled ? archivePrunedLibraryItems(upgraded.historicalLibraryItems, upgraded.libraryItems, merged) : upgraded.historicalLibraryItems,
    historicalPurchaseSummaries: mergeHistoricalPurchases(historicalPurchaseSummaries, existingPurchases, purchaseSummaries, historicalUpgrades),
    mediaTypeOverrides: migratedOverrides,
    lastImport: importSummary,
    keyReminders: reminderRecords,
    keyReminderScan: keyReminders,
    ...(!failures.length && orderList.every(order=>(allPurchases.get(purchaseKey(order))?.importVersion??0)>=CURRENT_IMPORT_VERSION)
      ? { mediaImportVersion: CURRENT_IMPORT_VERSION } : {})
  });
  return {
    ...scope,
    added,
    addedGames,
    addedSoftware,
    addedAudiobooks,
    audioBackfill,
    softwareBackfill,
    entitlementBackfill,
    datesBackfilled,
    pricedPurchases: importSummary.pricedPurchases,
    total: merged.size,
    failures: failures.length,
    scannedPurchases: titlePurchaseKeys.size,
    skippedKnown: importSummary.skippedKnown,
    reconciled,
    keyReminders: {
      complete: baselineComplete,
      scannedPurchases: reminderPurchaseKeys.size,
      failures: reminderFailures,
      unrevealed: reminderRecords.length,
      expiringSoon
    }
  };
}

function purchaseImportScope(result, inProgress = false) {
  const purchases = (count) => `${count} purchase${count === 1 ? '' : 's'}`;
  if (result.fullRescan) {
    if (inProgress) return `Rescanning all ${purchases(result.scannedPurchases)}`;
    return `Rescanned ${purchases(result.scannedPurchases)}; ${result.reconciled ? 'current snapshot reconciled; historical evidence archived' : 'scan incomplete; prior entries retained—repeat a full rescan to reconcile'}`;
  }
  const parts = [result.newPurchases
    ? `${inProgress ? 'Found' : 'Checked'} ${result.newPurchases} new purchase${result.newPurchases === 1 ? '' : 's'}`
    : 'No new purchases'];
  if (result.metadataUpgrades) {
    parts.push(`${inProgress ? 'updating saved details for' : result.failures ? 'attempted to update saved details for' : 'updated saved details for'} ${purchases(result.metadataUpgrades)} (one-time update)${!inProgress&&result.failures?'; failed purchases will be retried next time':''}`);
  } else {
    if (result.retriedPurchases) parts.push(`${inProgress ? 'retrying' : 'retried'} ${result.retriedPurchases} previously failed purchase${result.retriedPurchases === 1 ? '' : 's'}`);
    if (result.refreshedKeyPurchases) parts.push(`${inProgress ? 'rechecking' : 'rechecked'} key status in ${result.refreshedKeyPurchases} existing purchase${result.refreshedKeyPurchases === 1 ? '' : 's'}`);
    if (!result.scannedPurchases) parts.push('no key-status refreshes or failed purchases to check');
    if (result.skippedKnown) parts.push(`skipped ${result.skippedKnown} unchanged purchase${result.skippedKnown === 1 ? '' : 's'}`);
  }
  return parts.join('; ');
}

function keyReminderSyncNotice(scan) {
  return scan?.complete ? '' : 'Key reminders have not been checked across older purchases. Use Rescan all purchases to establish complete reminders.';
}

function inspectPurchaseNavigation() {
  const linkShapes = new Map();
  const candidateShapes = new Map();
  const dataAttributeNames = new Map();
  const buttonShapes = new Map();
  const signalName = /(?:^|[-_])(purchase|order|gamekey|game|key)(?:[-_]|$)/iu;
  const anchors = [...document.querySelectorAll('a[href]')];
  for (const link of anchors) incrementCount(linkShapes, JSON.stringify(safePurchaseLinkShape(link)));

  const elements = [...document.querySelectorAll('*')];
  let candidateCount = 0;
  for (const element of elements) {
    const attributes = safeAttributeNames(element);
    for (const name of attributes) if (name.startsWith('data-')) incrementCount(dataAttributeNames, name);
    const signalAttributes = attributes.filter((name) => signalName.test(name));
    if (signalAttributes.length) {
      candidateCount += 1;
      incrementCount(candidateShapes, JSON.stringify({ tag: element.tagName.toLowerCase(), signalAttributes }));
    }
  }
  for (const element of document.querySelectorAll('button, [role="button"]')) {
    incrementCount(buttonShapes, JSON.stringify({ tag: element.tagName.toLowerCase(), attributes: safeAttributeNames(element) }));
  }
  return {
    anchorCount: anchors.length,
    candidateCount,
    report: {
      version: 1,
      generatedAt: new Date().toISOString(),
      purpose: 'Safe structural diagnostic for targeting a Humble individual-purchase page.',
      privacy: 'This report contains only aggregate tag names, attribute names, link shapes, and counts. It contains no text content, titles, URLs, purchase identifiers, redemption keys, dates, cookies, or raw API responses.',
      links: Object.fromEntries([...linkShapes].sort(([left], [right]) => left.localeCompare(right))),
      possiblePurchaseElements: Object.fromEntries([...candidateShapes].sort(([left], [right]) => left.localeCompare(right))),
      dataAttributeNames: Object.fromEntries([...dataAttributeNames].sort(([left], [right]) => left.localeCompare(right))),
      buttons: Object.fromEntries([...buttonShapes].sort(([left], [right]) => left.localeCompare(right)))
    }
  };
}

function safePurchaseLinkShape(link) {
  const href = link.getAttribute('href') ?? '';
  const attributes = safeAttributeNames(link);
  try {
    const url = new URL(href, location.href);
    return {
      sameOrigin: url.origin === location.origin,
      pathDepth: url.pathname.split('/').filter(Boolean).length,
      queryParameterNames: [...url.searchParams.keys()].map((name) => name.toLowerCase()).sort(),
      hasFragment: Boolean(url.hash),
      attributes
    };
  } catch {
    return { sameOrigin: null, pathDepth: null, queryParameterNames: [], hasFragment: false, attributes };
  }
}

function safeAttributeNames(element) {
  return [...element.attributes].map((attribute) => attribute.name.toLowerCase()).sort();
}

async function discoverSoftwareProductMetadata(report) {
  report('Loading your purchase list for Software discovery\u2026');
  const orders = await fetchJson('/api/v1/user/order?all=true');
  const orderList = Array.isArray(orders) ? orders : orders?.data ?? orders?.orders;
  if (!Array.isArray(orderList)) throw new Error('Humble returned an unexpected purchase list. Please report this page format.');

  const products = [];
  let failures = 0;
  for (let index = 0; index < orderList.length; index += 1) {
    const order = orderList[index];
    const purchaseKey = order.gamekey ?? order.key ?? order.order_key;
    if (!purchaseKey) continue;
    report(`Inspecting Software signals ${index + 1} of ${orderList.length}\u2026`);
    try {
      const detail = await fetchOrderDetail(purchaseKey);
      const sourceBundle = extractBundleName(order, detail);
      for (const product of directOrderProducts(detail)) {
        const kind = productKind(product, sourceBundle);
        // Books and audiobooks already use delivery-specific import paths.
        // This report focuses on the ambiguous products that could plausibly
        // represent Software without logging an entire purchase response.
        if (kind === 'book' || kind === 'comic' || kind === 'audiobook') continue;
        products.push(softwareDiscoveryRecord(product, sourceBundle, kind, 'direct-product'));
      }
      // Subscription/tool products can be delivered as Humble third-party
      // entitlement records rather than direct downloads. Normal import calls
      // these games today, so include their non-secret metadata in the report
      // instead of silently omitting the most relevant Software evidence.
      for (const { record } of thirdPartyKeyRecords(detail)) {
        products.push(softwareDiscoveryRecord(record, sourceBundle, thirdPartyEntitlementKind(record, sourceBundle), 'third-party-entitlement'));
      }
    } catch {
      failures += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 175));
  }
  const kindCounts = new Map();
  for (const product of products) incrementCount(kindCounts, product.currentClassification);
  return {
    scannedPurchases: orderList.length,
    candidateProducts: products.length,
    failures,
    report: {
      version: 1,
      generatedAt: new Date().toISOString(),
      purpose: 'Local diagnostic for refining Humble Software product classification.',
      privacy: 'This report includes product titles and bundle names, plus non-secret category/type/platform values and file extensions. It contains no redemption keys, purchase identifiers, purchase dates, URLs, cookies, or raw purchase responses.',
      purchasesScanned: orderList.length,
      purchasesFailed: failures,
      candidateProducts: products.length,
      classifications: Object.fromEntries([...kindCounts].sort(([left], [right]) => left.localeCompare(right))),
      products
    }
  };
}

const SOFTWARE_DISCOVERY_TYPE_FIELDS = new Set(['category', 'content_type', 'item_content_type', 'product_type', 'key_type']);
const SOFTWARE_DISCOVERY_PLATFORM_FIELDS = new Set(['platform', 'platform_name', 'platforms', 'platforms_and_oses', 'storefront']);
const SOFTWARE_DISCOVERY_SECRET_FIELD = /(?:^|_)(?:key(?:_val(?:ue)?)?|token|secret|password|cookie|authorization)(?:$|_)/iu;

function isSoftwareDiscoverySecretField(name) {
  const field = String(name).toLowerCase();
  return field !== 'key_type' && field !== 'key_type_human_name' && SOFTWARE_DISCOVERY_SECRET_FIELD.test(field);
}

function softwareDiscoveryRecord(product, sourceBundle, kind, recordSource) {
  const signals = collectSoftwareDiscoverySignals(product);
  return {
    title: String(product?.human_name ?? product?.product_name ?? product?.title ?? product?.name ?? 'Unnamed direct product').trim() || 'Unnamed direct product',
    sourceBundle,
    recordSource,
    currentClassification: kind ?? 'unknown',
    declaredTypes: signals.declaredTypes,
    platforms: signals.platforms,
    fileExtensions: signals.fileExtensions,
    topLevelFields: signals.topLevelFields
  };
}

function collectSoftwareDiscoverySignals(product) {
  const declaredTypes = new Set();
  const platforms = new Set();
  const fileExtensions = new Set();
  const topLevelFields = Object.keys(product ?? {})
    .filter((field) => !isSoftwareDiscoverySecretField(field))
    .sort();
  const visit = (value, fieldName = '', depth = 0) => {
    if (value === null || value === undefined || depth > 12) return;
    const name = String(fieldName).toLowerCase();
    if (typeof value === 'string') {
      if (SOFTWARE_DISCOVERY_TYPE_FIELDS.has(name)) declaredTypes.add(value.trim());
      if (SOFTWARE_DISCOVERY_PLATFORM_FIELDS.has(name)) platforms.add(value.trim());
      for (const extension of fileExtensionsFromValue(value)) fileExtensions.add(extension);
      return;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      if (SOFTWARE_DISCOVERY_TYPE_FIELDS.has(name)) declaredTypes.add(String(value));
      if (SOFTWARE_DISCOVERY_PLATFORM_FIELDS.has(name)) platforms.add(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, name, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    for (const [childName, childValue] of Object.entries(value)) {
      const child = String(childName).toLowerCase();
      if (isSoftwareDiscoverySecretField(child)) continue;
      // A URL or download field can contribute a file extension, but its
      // value is never retained in the downloaded report.
      if (/(?:url|uri|link|download|file)/iu.test(child) && typeof childValue === 'string') {
        for (const extension of fileExtensionsFromValue(childValue)) fileExtensions.add(extension);
        continue;
      }
      visit(childValue, child, depth + 1);
    }
  };
  visit(product);
  return {
    declaredTypes: [...declaredTypes].filter(Boolean).sort(),
    platforms: [...platforms].filter(Boolean).sort(),
    fileExtensions: [...fileExtensions].sort(),
    topLevelFields
  };
}

function fileExtensionsFromValue(value) {
  const ignored = new Set(['com', 'edu', 'gov', 'io', 'net', 'org']);
  const extensions = new Set();
  for (const match of String(value ?? '').matchAll(/\.([a-z0-9]{1,12})(?=[?#\s"']|$)/giu)) {
    const extension = match[1].toLowerCase();
    if (!ignored.has(extension)) extensions.add(extension);
  }
  return extensions;
}

async function discoverKeyReminderMetadata(report) {
  report('Loading your purchase list for key reminder discovery\u2026');
  const orders = await fetchJson('/api/v1/user/order?all=true');
  const orderList = Array.isArray(orders) ? orders : orders?.data ?? orders?.orders;
  if (!Array.isArray(orderList)) throw new Error('Humble returned an unexpected purchase list. Please report this page format.');

  const fields = new Map();
  const secretValueFields = new Map();
  const recordContainers = new Map();
  let keyRecords = 0;
  let failures = 0;
  for (let index = 0; index < orderList.length; index += 1) {
    const order = orderList[index];
    const key = order.gamekey ?? order.key ?? order.order_key;
    if (!key) continue;
    report(`Inspecting purchase ${index + 1} of ${orderList.length}\u2026`);
    try {
      const detail = await fetchOrderDetail(key);
      const records = thirdPartyKeyRecords(detail);
      for (const { container, record } of records) {
        keyRecords += 1;
        incrementCount(recordContainers, container);
        collectKeyReminderFieldShape(record, '', fields, secretValueFields);
      }
    } catch {
      failures += 1;
    }
    // Match the normal importer's conservative request rate.
    await new Promise((resolve) => setTimeout(resolve, 175));
  }

  return {
    scannedPurchases: orderList.length,
    keyRecords,
    failures,
    report: {
      version: 2,
      generatedAt: new Date().toISOString(),
      purpose: 'Safe discovery of Humble third-party key reminder metadata.',
      privacy: 'This report contains aggregate field names, value types, and counts only. It contains no key values, titles, bundle names, purchase identifiers, purchase dates, or other field values.',
      purchasesScanned: orderList.length,
      purchasesFailed: failures,
      thirdPartyKeyRecords: keyRecords,
      recordContainers: Object.fromEntries(recordContainers),
      fields: Object.fromEntries([...fields].sort(([left], [right]) => left.localeCompare(right))),
      redactedKeyValueFields: Object.fromEntries([...secretValueFields].sort(([left], [right]) => left.localeCompare(right)))
    }
  };
}

async function scanKeyReminders(report, options={}) {
  const result=await importPurchases(report,options);return result.keyReminders;
}

function extractKeyReminderRecords(detail, order, purchaseKey) {
  const sourceBundle = extractBundleName(order, detail);
  const purchasedAt = extractPurchasedAt(order, detail);
  const checkedAt = new Date().toISOString();
  return thirdPartyKeyRecords(detail).flatMap(({ record }) => {
    const evidence = keyEvidence(record);
    if (evidence.keyStatus === 'revealed') return [];
    const status = evidence.keyStatus === 'unrevealed' ? 'unrevealed' : 'needs-review';
    const machineName = String(record.machine_name ?? 'unknown');
    const keyIndex = Number.isInteger(record.keyindex) ? record.keyindex : 0;
    const daysUntilExpiry = typeof record.num_days_until_expired === 'number' && Number.isFinite(record.num_days_until_expired)
      ? record.num_days_until_expired : null;
    return [{
      id: `${purchaseKey}\u0000${machineName}\u0000${keyIndex}`,
      purchaseKey,
      title: String(record.human_name ?? record.product_name ?? record.name ?? 'Unnamed entitlement').trim() || 'Unnamed entitlement',
      sourceBundle,
      purchasedAt,
      keyType: String(record.key_type_human_name ?? record.key_type ?? 'Third-party entitlement').trim(),
      status,
      directRedeem: record.direct_redeem === true,
      isExpired: record.is_expired === true,
      expiresAt: normalizeDate(record.expiration_date ?? record.expiry_date),
      daysUntilExpiry,
      checkedAt
    }];
  });
}

function keyReminderDaysRemaining(record, now = new Date().toISOString()) {
  if (record.isExpired) return -1;
  const expiry = record.expiresAt ? Date.parse(record.expiresAt) : NaN;
  if (!Number.isNaN(expiry)) return Math.ceil((expiry - Date.parse(now)) / 86400000);
  if (!Number.isFinite(record.daysUntilExpiry) || record.daysUntilExpiry < 0) return null;
  const checked = Date.parse(record.checkedAt);
  return Number.isNaN(checked) ? record.daysUntilExpiry : Math.max(-1, Math.ceil(record.daysUntilExpiry - ((Date.parse(now) - checked) / 86400000)));
}

function thirdPartyKeyRecords(detail) {
  const containers = [
    ['tpkd_dict.all_tpks', detail?.tpkd_dict?.all_tpks],
    ['tpkd_dict.all_tpkds', detail?.tpkd_dict?.all_tpkds],
    ['all_tpks', detail?.all_tpks],
    ['all_tpkds', detail?.all_tpkds]
  ];
  return containers.flatMap(([container, records]) => Array.isArray(records)
    ? records.filter((record) => record && typeof record === 'object').map((record) => ({ container, record }))
    : []);
}

function collectKeyReminderFieldShape(value, path, fields, secretValueFields, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectKeyReminderFieldShape(entry, `${path}[]`, fields, secretValueFields, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  for (const [name, fieldValue] of Object.entries(value)) {
    const fieldPath = path ? `${path}.${name}` : name;
    if (isRedemptionKeyValueField(name)) {
      recordRedactedKeyValueShape(secretValueFields, fieldPath, fieldValue);
      continue;
    }
    const summary = fields.get(fieldPath) ?? { present: 0, types: {}, dateLikeStrings: 0 };
    summary.present += 1;
    const type = fieldValue === null ? 'null' : Array.isArray(fieldValue) ? 'array' : typeof fieldValue;
    summary.types[type] = (summary.types[type] ?? 0) + 1;
    if (typeof fieldValue === 'string' && !Number.isNaN(Date.parse(fieldValue))) summary.dateLikeStrings += 1;
    fields.set(fieldPath, summary);
    if (fieldValue && typeof fieldValue === 'object') collectKeyReminderFieldShape(fieldValue, fieldPath, fields, secretValueFields, depth + 1);
  }
}

function recordRedactedKeyValueShape(fields, fieldPath, value) {
  const summary = fields.get(fieldPath) ?? { present: 0, values: { redactedNonEmpty: 0, emptyString: 0, null: 0, other: 0 } };
  summary.present += 1;
  if (value === REDACTED_REDEMPTION_KEY_VALUE) summary.values.redactedNonEmpty += 1;
  else if (value === '') summary.values.emptyString += 1;
  else if (value === null) summary.values.null += 1;
  else summary.values.other += 1;
  fields.set(fieldPath, summary);
}

function isRedemptionKeyValueField(name) {
  return /^(?:redeemed_)?key(?:_val|_value)?$/iu.test(name);
}

function incrementCount(counts, key) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function downloadJsonFile(filename, contents) {
  const blob = new Blob([JSON.stringify(contents, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function withProvenance(item) {
  const automaticKind = item.automaticKind || item.kind || 'unclassified';
  return {
    ...item,
    automaticKind,
    ...(item.manualKind ? { manualKind: item.manualKind } : {}),
    ...(Array.isArray(item.formats) ? { formats: item.formats } : {}),
    provenance: dedupeProvenance(itemProvenance(item))
  };
}

function mergeLibraryItem(existing, incoming) {
  const combinedFormats = Array.isArray(existing.formats) || Array.isArray(incoming.formats)
    ? [...new Set([...(existing.formats || []), ...(incoming.formats || [])])].sort()
    : undefined;
  return {
    ...existing,
    kind: existing.manualKind || incoming.manualKind || existing.kind || incoming.kind,
    automaticKind: incoming.automaticKind || incoming.kind || existing.automaticKind || existing.kind || 'unclassified',
    ...(existing.manualKind || incoming.manualKind ? { manualKind: existing.manualKind || incoming.manualKind } : {}),
    ...HumbleComicLibrary.entitlementFields(incoming),
    delivery: incoming.delivery || existing.delivery,
    ...(incoming.streaming || existing.streaming ? { streaming: true } : {}),
    ...(combinedFormats !== undefined ? { formats: combinedFormats } : {}),
    purchasedAt: existing.purchasedAt || incoming.purchasedAt,
    purchaseKey: existing.purchaseKey || incoming.purchaseKey,
    provenance: dedupeProvenance([...itemProvenance(existing), ...itemProvenance(incoming)])
  };
}

function dedupeProvenance(records) {
  const current = new Map();
  const strongByOrigin = new Map();
  for (const record of records) if(record.purchaseKey && record.entitlementId) {
    const key=JSON.stringify([record.title??'',record.purchaseKey??'']);
    const ids=strongByOrigin.get(key)??new Set();ids.add(record.providerItemId??record.entitlementId);strongByOrigin.set(key,ids);
  }
  for (const record of records) {
    // Replace an old undifferentiated claim only when one explicit delivery
    // exists. Several native products with the same title remain distinct.
    if(record.purchaseKey&&!record.providerItemId&&!record.entitlementId&&strongByOrigin.get(JSON.stringify([record.title??'',record.purchaseKey??'']))?.size===1)continue;
    const origin = `${record.title ?? ''}\u0000${record.purchaseKey ?? ''}${record.purchaseKey ? '' : `\u0000${record.sourceBundle ?? ''}`}`;
    const key = `${origin}\u0000${record.providerItemId ?? ''}\u0000${record.entitlementId ?? ''}`;
    const prev = current.get(key);
    if (!prev) {
      current.set(key, record);
    } else {
      const combinedFormats = Array.isArray(prev.formats) || Array.isArray(record.formats)
        ? [...new Set([...(prev.formats || []), ...(record.formats || [])])].sort()
        : undefined;
      current.set(key, {
        ...prev,
        ...record,
        sourceBundle: prev.sourceBundle || record.sourceBundle,
        purchasedAt: prev.purchasedAt || record.purchasedAt,
        delivery: record.delivery || prev.delivery,
        ...(record.streaming || prev.streaming ? { streaming: true } : {}),
        ...(combinedFormats !== undefined ? { formats: combinedFormats } : {})
      });
    }
  }
  return [...current.values()];
}

async function fetchJson(path) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });
  if (response.status === 401 || response.status === 403) throw new Error('Your Humble login has expired. Sign in and try again.');
  if (!response.ok) throw new Error(`Humble responded with ${response.status}.`);
  return response.json();
}

async function fetchOrderDetail(purchaseKey) {
  const response = await fetch(`/api/v1/order/${encodeURIComponent(purchaseKey)}?all_tpkds=true`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });
  if (response.status === 401 || response.status === 403) throw new Error('Your Humble login has expired. Sign in and try again.');
  if (!response.ok) throw new Error(`Humble responded with ${response.status}.`);
  // Humble returns the entitlement name together with redemption-key fields.
  // Redact those values before parsing so they can never enter extension
  // storage, reports, console output, or the normal import data structure.
  const redacted = (await response.text())
    .replace(/("(?:redeemed_)?key(?:_val|_value)?"\s*:\s*)"((?:[^"\\]|\\.)*)"/giu, (match, prefix, encodedValue) => `${prefix}${encodedValue.length ? `"${REDACTED_REDEMPTION_KEY_VALUE}"` : '""'}`);
  return JSON.parse(redacted);
}

function directOrderProducts(detail) {
  const products = Array.isArray(detail?.subproducts) ? detail.subproducts
    : Array.isArray(detail?.products) ? detail.products : [];
  return products.length ? products : [detail];
}

function retainManualLibraryItem(item) {
  // A manual title can also have Humble provenance from a later import. Keep
  // the manual title, but rebuild its Humble evidence from the current scan.
  const { purchaseKey, purchasedAt, provenance, entitlement, entitlementId, keyType, keyStatus, expiresAt, keyCheckedAt, ...manual } = item;
  return { ...manual, provenance: itemProvenance(item).filter((record) => !record.purchaseKey) };
}


function refreshImportedClassifications(priorItems, imported) {
  // Only a stable product within the same purchase can update an automatic
  // classification. Missing/failed observations and manual copies stay intact.
  const byOrigin=new Map();
  for(const item of imported)if(item.providerItemId&&item.purchaseKey)byOrigin.set(JSON.stringify([item.purchaseKey,item.providerItemId,item.entitlementId??'']),item);
  return priorItems.flatMap(item=>{
    if(item.source!=='humble')return [item];
    const groups=new Map();
    for(const origin of itemProvenance(item)){
      const updated=origin.providerItemId&&byOrigin.get(JSON.stringify([origin.purchaseKey,origin.providerItemId,origin.entitlementId??'']));
      const fields={};
      if(updated) for(const [field,value] of Object.entries(HumbleComicLibrary.bibliographicFields(updated))) {
        if(item[field]===undefined||item[field]===null||item[field]===''||Array.isArray(item[field])&&!item[field].length) fields[field]=value;
      }
      const kind=item.manualKind??updated?.kind??item.kind;
      const candidate={...item,...fields,kind,automaticKind:updated?.automaticKind??item.automaticKind??kind,
        ...(updated?{...(Array.isArray(item.formats)||Array.isArray(updated.formats)?{formats:[...new Set([...(item.formats??[]),...(updated.formats??[])])].sort()}:{}),delivery:item.delivery||updated.delivery,
          purchasedAt:item.purchasedAt||updated.purchasedAt}:{}),provenance:[]};
      const key=libraryItemKey(candidate),entry=groups.get(key)??candidate;
      entry.provenance.push(origin);groups.set(key,entry);
    }
    return [...groups.values()].map(entry=>({...entry,...(entry.provenance[0]?.purchaseKey?{purchaseKey:entry.provenance[0].purchaseKey,providerItemId:entry.provenance[0].providerItemId??entry.providerItemId}:{} )}));
  });
}

function archivePrunedLibraryItems(history, priorItems, currentMerged) {
  const mergedByKey = currentMerged instanceof Map ? currentMerged : new Map((currentMerged || []).map(i => [libraryItemKey(i), i]));
  const cleanedHistory = [];
  for (const item of (history || [])) {
    const key = libraryItemKey(item);
    const active = mergedByKey.get(key);
    if (!active) {
      cleanedHistory.push(item);
    } else {
      const activeOrigins = itemProvenance(active);
      const historicalOrigins = itemProvenance(item).filter(p => p.purchaseKey && !activeOrigins.some(a=>samePurchaseObservation(p,a)));
      if (historicalOrigins.length) {
        cleanedHistory.push({ ...item, provenance: historicalOrigins });
      }
    }
  }

  const toArchive = [];
  for (const item of priorItems) {
    const key = libraryItemKey(item);
    const active = mergedByKey.get(key);
    if (!active) {
      if (item.source === 'humble' || itemProvenance(item).some(p => p.purchaseKey)) {
        toArchive.push({ ...item, provenance: itemProvenance(item) });
      }
    } else {
      const activeOrigins = itemProvenance(active);
      const prunedOrigins = itemProvenance(item).filter(p => p.purchaseKey && !activeOrigins.some(a=>samePurchaseObservation(p,a)));
      if (prunedOrigins.length) {
        toArchive.push({ ...item, provenance: prunedOrigins });
      }
    }
  }

  return mergeHistoricalLibraryItems(cleanedHistory, toArchive);
}

function samePurchaseObservation(left,right){
  return left.purchaseKey===right.purchaseKey&&(left.entitlementId??'')===(right.entitlementId??'')
    && (!left.providerItemId||!right.providerItemId||left.providerItemId===right.providerItemId)
    && HumbleComicLibrary.normalizeTitle(left.title??'')===HumbleComicLibrary.normalizeTitle(right.title??'');
}

function mergeHistoricalLibraryItems(history, ...snapshots) {
  const merged = new Map(history.map((item) => [libraryItemKey(item), item]));
  for (const item of snapshots.flat()) {
    const provenance = itemProvenance(item).filter((record) => item.source === 'humble' || record.purchaseKey);
    if (!provenance.length) continue;
    const evidence = { ...item, source: 'humble', provenance };
    const key = libraryItemKey(evidence);
    const existing = merged.get(key);
    merged.set(key, existing ? mergeLibraryItem(existing, evidence) : evidence);
  }
  return [...merged.values()];
}

function mergeHistoricalPurchases(...snapshots) {
  const seen = new Map();
  for (const purchase of snapshots.flat()) {
    // Preserve changed metadata as historical evidence, without repeatedly
    // appending identical purchase summaries on every scan.
    const identity = JSON.stringify([
      purchase.purchaseKey, purchase.sourceBundle, purchase.purchasedAt,
      purchase.itemCount, purchase.pricePaid, purchase.currency, purchase.pricePerItem
    ]);
    const previous=seen.get(identity);
    seen.set(identity,previous && (previous.importVersion??0)>(purchase.importVersion??0) ? previous : purchase);
  }
  return [...seen.values()];
}

function isConfirmedPurchaseProduct(product, isSubproduct = true) {
  if (!product || typeof product !== 'object') return false;
  const title = String(product.human_name ?? product.product_name ?? product.title ?? product.name ?? '').trim();
  if (!title) return false;
  const promotionalPattern = /^(?:how\s+to\s+redeem|redemption\s+instructions?|getting\s+started(?:\s+guide)?|about\s+this\s+bundle|terms\s+(?:and|&)\s+conditions|terms\s+of\s+service|please\s+read\s+first|instructions|readme|coupon|discount\s+voucher|\d+%\s+off\s+coupon)\b/iu;
  if (promotionalPattern.test(title)) return false;
  const hasStreaming = Boolean(product.streaming || product.video_streams || product.stream_url || product.video_id);
  if (!isSubproduct) {
    const hasDelivery = (Array.isArray(product.downloads) && product.downloads.length > 0)
      || (Array.isArray(product.download_struct) && product.download_struct.length > 0)
      || Boolean(product.machine_name || product.product_key || product.product_id)
      || hasStreaming;
    if (!hasDelivery) return false;
  }
  return Boolean(
    product.machine_name || product.product_key || product.product_id || product.id || product.uuid
    || (Array.isArray(product.downloads) && product.downloads.length > 0)
    || (Array.isArray(product.download_struct) && product.download_struct.length > 0)
    || hasStreaming
    || product.payee
  );
}

function extractProductFormats(product) {
  if (!product || typeof product !== 'object') return [];
  const formats = new Set();
  const GENERIC_CATEGORY_OR_DELIVERY = /^(?:audio|video|ebook|book|comic|software|game|download|direct\s+download|web|torrent|bittorrent|stream|streaming|external\s+key|steam\s+key|key)$/iu;

  const addFormat = (raw, isExplicitFormatField = false) => {
    if (!raw || typeof raw !== 'string') return;
    const trimmed = raw.trim();
    if (!trimmed || GENERIC_CATEGORY_OR_DELIVERY.test(trimmed)) return;

    // Check MIME type first
    const mimeMatch = trimmed.match(/^(?:application|video|audio|image)\/([a-z0-9.+_-]+)$/iu);
    if (mimeMatch) {
      const sub = mimeMatch[1].toLowerCase();
      if (sub === 'pdf') { formats.add('.pdf'); return; }
      if (sub.includes('epub')) { formats.add('.epub'); return; }
      if (sub.includes('cbz') || sub.includes('x-cbz')) { formats.add('.cbz'); return; }
      if (sub.includes('cbr') || sub.includes('x-cbr')) { formats.add('.cbr'); return; }
      if (sub.includes('mobi')) { formats.add('.mobi'); return; }
      if (sub === 'mp4') { formats.add('.mp4'); return; }
      if (sub === 'flac') { formats.add('.flac'); return; }
      if (sub === 'mpeg' || sub === 'mp3') { formats.add('.mp3'); return; }
      if (sub === 'wav' || sub.includes('wave')) { formats.add('.wav'); return; }
      if (sub === 'zip') { formats.add('.zip'); return; }
      if (sub.includes('octet-stream')) return;
    }

    // Check URL or file path
    if (/^https?:\/\//iu.test(trimmed) || trimmed.includes('/') || trimmed.includes('\\')) {
      const queryMatch = trimmed.match(/[?&](?:filename|file|name)=([^&#]+)/iu);
      if (queryMatch) {
        addFormat(decodeURIComponent(queryMatch[1]), isExplicitFormatField);
      }
      const pathPart = trimmed.split(/[?#]/)[0];
      const extMatch = pathPart.match(/\.([a-z0-9]{2,16})$/iu);
      if (extMatch && !GENERIC_CATEGORY_OR_DELIVERY.test(extMatch[1])) {
        formats.add(`.${extMatch[1].toLowerCase()}`);
      }
      return;
    }

    // Check for explicit format in parentheses or brackets: e.g. "PDF (HQ)", "1080p (MP4)", "Source Files (ZIP)", "Blender Project (.blend)"
    const parenMatch = trimmed.match(/\((?:[a-z0-9\s_-]*\.)?([a-z0-9]{2,16})\)/iu)
      || trimmed.match(/\[(?:[a-z0-9\s_-]*\.)?([a-z0-9]{2,16})\]/iu);
    if (parenMatch) {
      const cand = parenMatch[1].toLowerCase();
      if (/^(?:pdf|epub|cbz|cbr|mobi|azw3|djvu|zip|rar|7z|tar|gz|exe|dmg|pkg|deb|rpm|appimage|mp4|mkv|mov|avi|webm|m4v|flv|mp3|flac|wav|m4a|m4b|ogg|opus|blend|unitypackage|uproject|uasset|gmz|yyz)$/iu.test(cand)) {
        formats.add(`.${cand}`);
        return;
      }
    }


    // Check for known format keywords: e.g. "PDF - High Quality", "Lossless FLAC", "MP3 320kbps", "Blender"
    const keywordMatch = trimmed.match(/\b(pdf|epub|cbz|cbr|mobi|azw3|djvu|zip|rar|7z|tar\.gz|exe|dmg|pkg|deb|rpm|appimage|mp4|mkv|mov|avi|webm|m4v|mp3|flac|wav|m4a|m4b|ogg|opus|blend)\b/iu);
    if (keywordMatch) {
      formats.add(`.${keywordMatch[1].toLowerCase()}`);
      return;
    }

    // Check if string is a simple extension or dotted extension: e.g. ".pdf", "pdf", "CBZ"
    let clean = trimmed.toLowerCase();
    if (clean.startsWith('.')) clean = clean.slice(1);
    if (/^[a-z0-9]{2,16}$/iu.test(clean) && !GENERIC_CATEGORY_OR_DELIVERY.test(clean)) {
      formats.add(`.${clean}`);
      return;
    }

    // Only if source metadata explicitly provides a format label without a literal extension (e.g. format: "Unity Package")
    if (isExplicitFormatField && trimmed.length <= 40 && !GENERIC_CATEGORY_OR_DELIVERY.test(trimmed)) {
      formats.add(trimmed);
    }
  };

  const scanDownload = (d) => {
    if (!d || typeof d !== 'object') return;
    addFormat(d.format, true);
    addFormat(d.filetype, true);
    addFormat(d.file_type, true);
    addFormat(d.extension, true);
    addFormat(d.file_extension, true);
    addFormat(d.ext, true);
    addFormat(d.mime_type, true);
    addFormat(d.type, false);
    addFormat(d.name, false);
    addFormat(d.filename, false);
    addFormat(d.file_name, false);
    if (typeof d.url === 'string') addFormat(d.url, false);
    else if (d.url && typeof d.url === 'object') {
      for (const u of Object.values(d.url)) {
        if (typeof u === 'string') addFormat(u, false);
      }
    }
    if (Array.isArray(d.download_struct)) d.download_struct.forEach(scanDownload);
    if (Array.isArray(d.files)) d.files.forEach(scanDownload);
    if (Array.isArray(d.items)) d.items.forEach(scanDownload);
  };

  if (Array.isArray(product.downloads)) product.downloads.forEach(scanDownload);
  if (Array.isArray(product.download_struct)) product.download_struct.forEach(scanDownload);
  if (Array.isArray(product.files)) product.files.forEach(scanDownload);
  if (product.download && typeof product.download === 'object') scanDownload(product.download);
  if (typeof product.download_url === 'string') addFormat(product.download_url, false);
  if (typeof product.format === 'string') addFormat(product.format, true);
  if (Array.isArray(product.formats)) product.formats.forEach(f => addFormat(f, true));

  return [...formats].sort((a, b) => a.localeCompare(b));
}

function extractLibraryItems(detail, order, purchaseKey, mediaTypeOverrides = {}, rejectedList = null) {
  const sourceBundle = extractBundleName(order, detail);
  const purchasedAt = extractPurchasedAt(order, detail);
  const products = directOrderProducts(detail);
  const isSubproducts = Array.isArray(detail?.subproducts) || Array.isArray(detail?.products);
  const directItems = products
    .map((product, index) => {
      const providerItemId = `${purchaseKey}:product:${String(product.machine_name ?? product.product_key ?? product.product_id ?? product.id ?? product.uuid ?? '').trim() || `position-${index}`}`;
      const title = String(product.human_name ?? product.product_name ?? product.title ?? product.name ?? '').trim();
      if (!title) return null;
      const formats = extractProductFormats(product);
      const hasStreaming = Boolean(product.streaming || product.video_streams || product.stream_url || product.video_id);
      let detectedKind = productKind(product, sourceBundle);
      if (!detectedKind) {
        if (isConfirmedPurchaseProduct(product, isSubproducts)) {
          detectedKind = 'unclassified';
        } else {
          if (rejectedList && !rejectedList.some(r => r.purchaseKey === purchaseKey && (r.providerItemId === providerItemId || r.title === title))) {
            const hasDownloads = (Array.isArray(product.downloads) && product.downloads.length > 0)
              || (Array.isArray(product.download_struct) && product.download_struct.length > 0);
            rejectedList.push({
              providerItemId,
              title,
              purchaseKey,
              sourceBundle,
              purchasedAt,
              reason: 'Unclassified promotional or non-product content',
              delivery: hasStreaming ? 'streaming' : (hasDownloads ? 'direct-download' : undefined),
              ...(hasDownloads ? { entitlement: 'direct-download' } : {}),
              formats
            });
          }
          return null;
        }
      }
      const overrideKey = `${purchaseKey}:${providerItemId}`;
      const override = mediaTypeOverrides[overrideKey]
        || mediaTypeOverrides[providerItemId]
        || mediaTypeOverrides[`${purchaseKey}:${HumbleComicLibrary.titleKey(title)}`];
      const kind = override || detectedKind;
      const automaticKind = detectedKind;
      const manualKind = override || undefined;
      return {
        providerItemId,
        title,
        kind,
        automaticKind,
        ...(manualKind ? { manualKind } : {}),
        source: 'humble',
        sourceBundle,
        purchaseKey,
        purchasedAt,
        entitlement: 'direct-download',
        delivery: hasStreaming ? 'streaming' : 'direct-download',
        ...(hasStreaming ? { streaming: true } : {}),
        formats,
        ...HumbleComicLibrary.bibliographicFields(product)
      };
    })
    .filter(Boolean);
  const keys = extractThirdPartyKeyItems(detail, order, purchaseKey, mediaTypeOverrides);
  const keyedTitles = new Set(keys.map(item => HumbleComicLibrary.normalizeTitle(item.title)));
  return [...directItems.filter(item => !['game', 'software'].includes(item.kind) || !keyedTitles.has(HumbleComicLibrary.normalizeTitle(item.title))), ...keys];
}

function extractThirdPartyKeyItems(detail, order, purchaseKey, mediaTypeOverrides = {}) {
  const keyRecords = thirdPartyKeyRecords(detail).map(({ record }) => record);
  const sourceBundle = extractBundleName(order, detail);
  const purchasedAt = extractPurchasedAt(order, detail);
  return keyRecords.flatMap((record, index) => {
    const title = String(record?.human_name ?? record?.product_name ?? record?.name ?? '').trim();
    if (!title) return [];
    const detectedKind = thirdPartyEntitlementKind(record, sourceBundle);
    const entitlementId = `${String(record.machine_name ?? `position-${index}`).slice(0, 450)}:${Number.isInteger(record.keyindex) ? record.keyindex : 0}`;
    const providerItemId = `${purchaseKey}:key:${entitlementId}`;
    const override = mediaTypeOverrides[`${purchaseKey}:${providerItemId}`]
      || mediaTypeOverrides[providerItemId]
      || mediaTypeOverrides[`${purchaseKey}:${HumbleComicLibrary.titleKey(title)}`];
    const kind = override || detectedKind;
    const automaticKind = detectedKind;
    const manualKind = override || undefined;
    return [{
      title,
      kind,
      automaticKind,
      ...(manualKind ? { manualKind } : {}),
      source: 'humble',
      sourceBundle,
      purchaseKey,
      purchasedAt,
      providerItemId,
      entitlement: 'third-party-key',
      entitlementId,
      keyType: String(record.key_type_human_name ?? record.key_type ?? '').trim().slice(0, 500),
      ...keyEvidence(record)
    }];
  });
}

function keyEvidence(record) {
  const keyStatus=record.is_expired===true?'expired':record.is_available===false||record.key_status==='unavailable'?'unavailable':
    ['redeemed_key_val','redeemed_key_value','key_val','key_value','key'].some(field=>record[field]===REDACTED_REDEMPTION_KEY_VALUE)?'revealed':
    !Object.hasOwn(record,'redeemed_key_val')?'unrevealed':'unknown';
  return {keyStatus,expiresAt:normalizeDate(record.expiration_date??record.expiry_date),keyCheckedAt:new Date().toISOString()};
}

function thirdPartyEntitlementKind(record, sourceBundle) {
  // Humble's generic/external entitlement types are shared by games, courses,
  // and tools. Only an order explicitly labelled a Software Bundle provides
  // enough independent context to classify such an entitlement as Software.
  const text = `${sourceBundle ?? ''} ${record?.key_type_human_name ?? ''} ${record?.key_type ?? ''} ${record?.human_name ?? ''} ${record?.product_name ?? ''}`;
  if (/\b(?:software\s+bundle|utility\s+bundle|dev\s+tool|productivity\s+bundle)\b/iu.test(String(sourceBundle ?? ''))
    || /\b(?:jetbrains|magix|vegas|sound\s*forge|corel|painter|ashampoo|stardock|bitdefender|malwarebytes|reallusion|cyberlink|avast|nordvpn)\b/iu.test(text)
    || /\b(?:software|utility|utilities|developer\s+tools?|antivirus|license\s+key)\b/iu.test(String(record?.key_type_human_name ?? record?.key_type ?? ''))) {
    return 'software';
  }
  return 'game';
}

function libraryItemKey(item) {
  return HumbleComicLibrary.catalogItemKey(item);
}

function createPurchaseSummary(detail, order, purchaseKey, items) {
  const price = extractPaidPrice(order, detail);
  const itemCount = items.length;
  return {
    purchaseKey,
    importVersion: CURRENT_IMPORT_VERSION,
    sourceBundle: extractBundleName(order, detail),
    purchasedAt: extractPurchasedAt(order, detail),
    itemCount,
    pricePaid: price.amount,
    currency: price.currency,
    pricePerItem: price.amount !== null && itemCount ? roundMoney(price.amount / itemCount) : null
  };
}

function extractBundleName(order, detail) {
  return String(order.product?.human_name ?? order.product ?? detail?.product?.human_name ?? detail?.product ?? order.name ?? '').trim();
}

function extractPurchasedAt(order, detail) {
  // The purchase-list endpoint has used different names across Humble's site
  // revisions, and some accounts expose the timestamp only in order detail.
  // Inspect only order-level metadata so an e-book's publication date cannot
  // accidentally become its Humble purchase date.
  const records = [
    order,
    order?.order,
    order?.purchase,
    order?.metadata,
    detail,
    detail?.order,
    detail?.purchase,
    detail?.metadata
  ];
  const dateKeys = ['purchased_at', 'purchase_date', 'order_date', 'created_at', 'created', 'date', 'timestamp'];
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    for (const key of dateKeys) {
      const normalized = normalizeDate(record[key]);
      if (normalized) return normalized;
    }
  }
  return null;
}

function extractPaidPrice(order, detail) {
  // Like the date, payment data has changed names over the lifetime of the
  // purchase API. Restrict this search to order/payment metadata: individual
  // books often have a list price, which is not what the customer paid.
  const records = [
    order,
    order?.order,
    order?.purchase,
    order?.payment,
    order?.metadata,
    detail,
    detail?.order,
    detail?.purchase,
    detail?.payment,
    detail?.metadata
  ];
  const priceKeys = ['amount_paid', 'amount_spent', 'price_paid', 'total_amount', 'amount', 'total', 'price'];
  let currency = null;
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    currency ??= normalizeCurrency(record.currency_code ?? record.currency ?? record.iso_currency);
    for (const key of priceKeys) {
      const amount = normalizeMoney(record[key]);
      if (amount !== null) return { amount, currency: currency ?? currencyFromValue(record[key]) };
    }
  }
  return { amount: null, currency };
}

function normalizeMoney(value) {
  if (typeof value === 'object' && value) value = value.amount ?? value.value ?? null;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    // Whole values in the thousands are conventionally minor units. A Humble
    // bundle price above $500 is implausible, so this avoids showing 1500.00
    // when the response means 15.00.
    return roundMoney(value >= 500 ? value / 100 : value);
  }
  if (typeof value !== 'string') return null;
  const match = value.replace(/,/gu, '').match(/-?\d+(?:\.\d+)?/u);
  if (!match) return null;
  const amount = Number(match[0]);
  return Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : null;
}

function normalizeCurrency(value) {
  return typeof value === 'string' && /^[A-Z]{3}$/iu.test(value.trim()) ? value.trim().toUpperCase() : null;
}

function currencyFromValue(value) {
  if (typeof value !== 'string') return null;
  const code = value.match(/\b([A-Z]{3})\b/iu)?.[1];
  if (code) return code.toUpperCase();
  return value.includes('$') ? 'USD' : value.includes('€') ? 'EUR' : value.includes('£') ? 'GBP' : null;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function normalizeDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 100000000000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d{10,13}$/u.test(trimmed)) return normalizeDate(Number(trimmed));
  // Preserve an API-provided date string if the browser can validate it. This
  // keeps the original timezone where Humble supplied one.
  return Number.isNaN(Date.parse(trimmed)) ? null : trimmed;
}

function productKind(product, sourceBundle = '') {
  // An explicit Humble software type is stronger evidence than a bundled
  // executable or platform field. This includes assets/tools that Humble
  // files under Software without guessing from an archive extension.
  if (hasSoftwareEntitlement(product)) return 'software';
  // GameMaker project archives are importable source/project deliveries, not
  // executable games. This is a narrow, format-specific Software signal.
  if (hasSoftwareAssetDelivery(product)) return 'software';
  // Check video delivery before game: Humble often tags video downloads
  // with platforms like windows, mac, linux, or android for player compatibility,
  // which must not cause movies or video courses to be classified as games.
  if (hasVideoDownload(product, sourceBundle)) return 'video';
  // Check game delivery next: game bundles can include PDF manuals or art
  // books, which must not cause the game itself to be filed as a book.
  if (hasGameEntitlement(product)) return 'game';
  // Audiobook products can include a PDF booklet; identify their delivered
  // audio before the broader book-format check below.
  if (hasAudiobookDownload(product)) return 'audiobook';
  // Comic files (CBZ/CBR) or purchases from Comic/Manga bundles
  if (hasComicDownload(product, sourceBundle)) return 'comic';
  return hasBookDownload(product) ? 'book' : null;
}

function hasSoftwareAssetDelivery(product) {
  const serialized = JSON.stringify(product);
  return /\.(?:gmz|gmx|yyz|yymp|yymps|gmez|unitypackage|uproject|uasset|blend)(?:["?\\]|$)/iu.test(serialized)
    || /"(?:format|filetype|extension)"\s*:\s*"(?:gmz|gmx|yyz|yymp|yymps|gmez|unitypackage|uproject|uasset|blend)"/iu.test(serialized);
}

function confirmedNewItemCount({ total = 0, owned = 0, elsewhere = 0, partial = 0, possible = 0, unchecked = 0 }) {
  return total - owned - elsewhere - partial - possible - unchecked;
}

function hasSoftwareEntitlement(product) {
  const serialized = JSON.stringify(product);
  // This deliberately relies on Humble's explicit content classification. A
  // ZIP, Unity package, or other generic asset file by itself is not enough
  // evidence to import an otherwise unknown item as Software.
  return /"(?:category|content_type|item_content_type|product_type)"\s*:\s*"(?:software|utility|utilities|tool|tools|application|dev_tool|development)"/iu.test(serialized);
}

function hasGameEntitlement(product) {
  const serialized = JSON.stringify(product);
  // Humble has used several response shapes, but game products consistently
  // identify a storefront/platform or a game-like content category. Keep the
  // signals narrow to avoid importing arbitrary non-book extras.
  return /"(?:category|content_type|item_content_type|product_type)"\s*:\s*"(?:game|dlc)"/iu.test(serialized)
    || /"(?:platform|platform_name|key_type|storefront)"\s*:\s*"[^"\\]*(?:steam|gog|epic|origin|uplay|ubisoft|ea(?:\s+app)?|itch(?:\.io)?|windows|mac|linux|android|ios)[^"\\]*"/iu.test(serialized)
    || /"(?:platforms|platforms_and_oses)"\s*:\s*(?:\[[^\]]*"(?:steam|gog|epic|windows|mac|linux|android|ios)|\{)/iu.test(serialized)
    || /\.(?:exe|dmg|apk|appimage|x86_64)(?:["?\\]|$)/iu.test(serialized);
}

function hasBookDownload(product) {
  // Humble's responses have changed shape over time. Looking only within each
  // product avoids treating a bundle name as a book, while accepting the PDF,
  // EPUB, CBZ, CBR, and MOBI variants used across Humble book bundles.
  const serialized = JSON.stringify(product);
  return explicitDownloadMedia(product).has('book')
    || /"(?:category|content_type|item_content_type|product_type)"\s*:\s*"(?:book|ebook|e-book)"/iu.test(serialized)
    || /\.(?:pdf|epub|cbz|cbr|mobi)(?:["?\\]|$)/iu.test(serialized)
    || /"(?:format|filetype|extension)"\s*:\s*"(?:pdf|epub|cbz|cbr|mobi)"/iu.test(serialized);
}

function hasComicDownload(product, sourceBundle = '') {
  if (!product || typeof product !== 'object') return false;
  const serialized = JSON.stringify(product);
  if (explicitDownloadMedia(product).has('comic')) return true;
  if (/"(?:category|content_type|item_content_type|product_type)"\s*:\s*"(?:comic|comics|manga|graphic novel)"/iu.test(serialized)) return true;
  const title=String(product.human_name??product.product_name??product.title??product.name??'').trim();
  if (/\bcomic book\s*$/iu.test(title)&&!/\b(?:how to|guide|manual|draw(?:ing)?|creat(?:e|ing)|mak(?:e|ing)|writ(?:e|ing))\b/iu.test(title)) return true;
  if (/\.(?:cbz|cbr)(?:["?\\]|$)/iu.test(serialized)) return true;
  if (/"(?:format|filetype|extension)"\s*:\s*"(?:cbz|cbr)"/iu.test(serialized)) return true;
  if (/\b(?:comics?\s+bundle|manga\s+bundle|graphic\s+novels?\s+bundle)\b/iu.test(sourceBundle)) return true;
  return false;
}

function hasVideoDownload(product, sourceBundle = '') {
  if (!product || typeof product !== 'object') return false;
  const serialized = JSON.stringify(product);
  if (explicitDownloadMedia(product).has('video')) return true;
  const title=String(product.human_name??product.product_name??product.title??product.name??'').trim();
  if (/^(?:making[ -]of|behind[ -]the[ -]scenes)\s+videos?$/iu.test(title)) return true;
  if (/\.(?:mp4|mkv|mov|avi|webm|m4v|wmv|flv|ogv|m3u8|ts)(?:["?\\]|$)/iu.test(serialized)) return true;
  if (/"(?:category|content_type|item_content_type|product_type|format|filetype|extension|platform|platform_name)"\s*:\s*"(?:video|movie|film|mp4|mkv|mov|avi|webm|m4v|streaming|stream)"/iu.test(serialized)) return true;
  if (/"(?:streaming|video_streaming|is_video)"\s*:\s*true/iu.test(serialized)) return true;
  if (/"(?:video_streams?|stream_urls?|streaming_urls?|video_urls?|video_struct|video_id|bento_id)"\s*:/iu.test(serialized)) return true;
  if (/"name"\s*:\s*"(?:watch\s+online|stream|video\s+stream|1080p|720p|480p|4k|hd|sd)(?:\s*\(.*?\))?"/iu.test(serialized)) return true;
  if (/\b(?:video\s+bundle|film\s+bundle|movie\s+bundle|documentary\s+bundle)\b/iu.test(sourceBundle)) {
    if (!hasSoftwareEntitlement(product) && !hasBookDownload(product) && !hasAudiobookDownload(product)) {
      return true;
    }
  }
  return false;
}

function explicitDownloadMedia(product){
  const kinds=new Set(),visit=download=>{
    if(!download||typeof download!=='object')return;
    for(const field of ['name','label']){
      const label=String(download[field]??'').slice(0,250).trim().replace(/\s*\((?:zip|rar|7z)\)\s*$/iu,'').trim();
      if(/^(?:comic(?: book)?|graphic novel|manga)$/iu.test(label))kinds.add('comic');
      if(/^(?:e-?book|book)$/iu.test(label))kinds.add('book');
      if(/^(?:videos?|video episodes|video course|video tutorials?|movie|film)$/iu.test(label))kinds.add('video');
    }
    for(const field of ['download_struct','files','items'])if(Array.isArray(download[field]))download[field].forEach(visit);
  };
  for(const field of ['downloads','download_struct','files'])if(Array.isArray(product?.[field]))product[field].forEach(visit);
  if(product?.download)visit(product.download);
  // Conflicting labels are not evidence for choosing a medium.
  return kinds.size===1?kinds:new Set();
}

function hasAudiobookDownload(product) {
  const serialized = JSON.stringify(product);
  return /\.(?:mp3|m4a|m4b|aac|flac|ogg|opus|wav)(?:["?\\]|$)/iu.test(serialized)
    || /"(?:category|content_type|item_content_type|product_type|format|filetype|extension|platform|platform_name)"\s*:\s*"(?:audio|audiobook|audio[ _-]?book|mp3|m4a|m4b|aac|flac|ogg|opus|wav)"/iu.test(serialized);
}

function appendWishlistNotice(summary, comparison) {
  if (!comparison?.resolvedItems) return;
  const rows=comparison.resolvedItems.map(({item,match})=>({item,match,relation:(comparison.wishlistItems||[]).some(w=>HumbleOwnership.wishlistRelation(w,item)==='match')?'match':(comparison.wishlistItems||[]).some(w=>HumbleOwnership.wishlistRelation(w,item)==='related')?'related':''})).filter(row=>row.relation);
  document.querySelectorAll('.hcl-wish-marker').forEach(node=>node.remove());
  if(!rows.length)return;
  const details=document.createElement('details'); details.className='hcl-wishlist-notice'; const heading=document.createElement('summary');
  heading.textContent=`Wishlist: ${rows.filter(row=>row.relation==='match').length} matches · ${rows.filter(row=>row.relation==='related').length} related`;details.append(heading);
  const list=document.createElement('ul');for(const row of rows){const li=document.createElement('li');li.textContent=`${row.item.title} — ${row.relation==='match'?'Wishlist match':'Related wishlist item'}`;list.append(li);}details.append(list);summary.append(details);
  document.querySelectorAll('.hcl-wish-marker').forEach(node=>node.remove());
  for(const row of rows){const host=row.item.container;if(!host)continue;const marker=document.createElement('span');marker.className='hcl-wish-marker';marker.textContent=row.relation==='match'?'♥ Wishlist':'♡ Related wish';host.append(marker);}
}

function captureSummaryState(panel) {
  if(!panel)return null;
  const active=panel.contains(document.activeElement)?document.activeElement:null;
  return {open:[...panel.querySelectorAll('details')].filter(node=>node.open).map(node=>node.dataset.section||node.id||node.className||node.querySelector('summary')?.textContent),scroll:panel.scrollTop,focus:active?.getAttribute('aria-label')||active?.id};
}
function restoreSummaryState(panel, state) {
  if(!state)return;
  for(const node of panel.querySelectorAll('details'))node.open=state.open.includes(node.dataset.section||node.id||node.className||node.querySelector('summary')?.textContent);
  panel.scrollTop=state.scroll;
  if(state.focus)[...panel.querySelectorAll('button,input,select')].find(node=>node.getAttribute('aria-label')===state.focus||node.id===state.focus)?.focus({preventScroll:true});
}

function appendPagedUnits(host, entries, renderRow, sectionKey) {
  const section=document.createElement('details');section.dataset.section=sectionKey;
  const heading=document.createElement('summary');heading.textContent=`Unit details (${entries.length})`;section.append(heading);
  let page=0,mounted=false;
  const list=document.createElement('ol');list.className='hcl-reading-sequence';
  const controls=document.createElement('div');controls.className='hcl-unit-pages';
  const previous=document.createElement('button'),next=document.createElement('button'),status=document.createElement('span');
  previous.type=next.type='button';previous.textContent='Previous units';next.textContent='Next units';status.setAttribute('role','status');
  const paint=()=>{list.replaceChildren();list.start=page*50+1;for(const entry of entries.slice(page*50,(page+1)*50))list.append(renderRow(entry));previous.disabled=page===0;next.disabled=(page+1)*50>=entries.length;status.textContent=` ${page*50+1}–${Math.min((page+1)*50,entries.length)} of ${entries.length} `;};
  previous.addEventListener('click',()=>{page--;paint();});next.addEventListener('click',()=>{page++;paint();});controls.append(previous,status,next);
  section.addEventListener('toggle',()=>{if(!section.open||mounted)return;mounted=true;section.append(list);if(entries.length>50)section.append(controls);paint();});
  host.append(section);return section;
}
function conciseUnitNumbers(entries) {
  const rows=[...new Set(entries.map(entry=>entry.number))].sort((a,b)=>{const number=value=>Number(globalThis.LibraryMatchingPolicy.unitKey(value));return number(a)-number(b)||String(a).localeCompare(String(b),undefined,{numeric:true});});
  const ranges=[];for(let i=0;i<rows.length;i++){const first=rows[i];let last=first;while(i+1<rows.length&&Number.isInteger(Number(last))&&Number(rows[i+1])===Number(last)+1)last=rows[++i];ranges.push(first===last?String(first):`${first}–${last}`);}
  return ranges.slice(0,12).join(', ')+(ranges.length>12?` … (${rows.length} units)`:'');
}
