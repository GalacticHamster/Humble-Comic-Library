(async function initialiseHumbleComicLibrary() {
  'use strict';

  if (location.pathname.startsWith('/home/purchases')) {
    addPurchaseImporter();
    return;
  }

  if (isBundleCataloguePage()) {
    const { purchaseSummaries = [] } = await chrome.storage.local.get({ purchaseSummaries: [] });
    if (!purchaseSummaries.length) return;
    let refreshTimer;
    const refresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => renderCataloguePurchaseMarkers(purchaseSummaries), 150);
    };
    refresh();
    new MutationObserver((records) => {
      if (records.some(recordHasExternalAddition)) refresh();
    }).observe(document.documentElement, { childList: true, subtree: true });
    return;
  }

  const itemKind = location.pathname.startsWith('/books/') ? 'book' : location.pathname.startsWith('/games/') ? 'game' : null;
  if (!itemKind) return;

  const comparison = { startedAt: performance.now(), refreshes: 0, storageMs: null, lastMatchMs: null, itemCount: 0, libraryCount: 0, completedItems: 0, job: 0 };
  showComparisonProgress('Loading your local library…');
  const storage = await chrome.storage.local.get({ libraryItems: [], purchaseSummaries: [], customCollectionMappings: [] });
  const libraryItems = storage.libraryItems.filter((item) => item.kind === itemKind || (itemKind === 'book' && !item.kind));
  comparison.storageMs = Math.round(performance.now() - comparison.startedAt);
  comparison.libraryCount = libraryItems.length;
  const currentBundlePurchases = findCurrentBundlePurchases(storage.purchaseSummaries);
  if (!libraryItems.length) {
    removeComparisonProgress();
    renderPurchasedBundleSummary(currentBundlePurchases);
    return;
  }

  const byKey = new Map();
  for (const item of libraryItems) {
    const key = HumbleComicLibrary.titleKey(item.title);
    if (!key) continue;
    const existing = byKey.get(key) ?? [];
    existing.push(item);
    byKey.set(key, existing);
  }

  const libraryByKey = new Map([...byKey].map(([key, items]) => [key, items[0]]));
  const libraryMatcher = createLibraryMatcher(libraryByKey, itemKind);
  const collectionMappings = [...HumbleCollectionMappings.builtIn, ...(Array.isArray(storage.customCollectionMappings) ? storage.customCollectionMappings : [])];
  let refreshTimer;
  const refresh = (reason = 'update') => {
    clearTimeout(refreshTimer);
    const job = ++comparison.job;
    comparison.refreshes += 1;
    comparison.completedItems = 0;
    showComparisonProgress(reason === 'initial' ? 'Checking your library…' : 'Updating library labels…');
    // Let Humble finish its paint and image work before this potentially
    // expensive comparison. The timeout guarantees it still runs promptly on
    // a continuously busy page.
    refreshTimer = setTimeout(() => runWhenIdle(() => renderBundleComparison(libraryMatcher, itemKind, currentBundlePurchases, collectionMappings, comparison, job), 500), reason === 'initial' ? 0 : 120);
  };
  refresh('initial');
  window.addEventListener('resize', () => refresh('resize'), { passive: true });
  new MutationObserver((records) => {
    // Humble renders covers lazily. Look only at the added/changed local
    // subtree, rather than re-querying every cover after every React update.
    if (records.some(recordHasUnannotatedCover)) refresh('new bundle items');
  }).observe(document.documentElement, { childList: true, subtree: true });
}()).catch((error) => showComparisonFailure(error));

const HCL_COVER_SELECTOR = 'img.item-image[alt], img[class~="item-image"][alt]';

function recordHasExternalAddition(record) {
  return [...record.addedNodes].some((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    return !node.id?.startsWith('hcl-') && !node.classList?.contains('hcl-summary') && !node.classList?.contains('hcl-progress');
  });
}

function runWhenIdle(callback, timeout) {
  const run = () => Promise.resolve(callback()).catch(showComparisonFailure);
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout });
  } else {
    setTimeout(run, 0);
  }
}

function recordHasUnannotatedCover(record) {
  const roots = [...record.addedNodes].filter((node) => node.nodeType === Node.ELEMENT_NODE);
  const hasNonExtensionAddition = roots.some((node) => !node.id?.startsWith('hcl-') && !node.classList?.contains('hcl-summary'));
  // Text/hydration changes can complete a card around an existing cover, so
  // inspect the local target in that case. Do not inspect document.body just
  // because the extension added its own progress or summary panel.
  if (record.target instanceof Element && (hasNonExtensionAddition || !roots.length)) roots.push(record.target);
  return roots.some((root) => {
    const covers = [];
    if (root.matches?.(HCL_COVER_SELECTOR)) covers.push(root);
    covers.push(...(root.querySelectorAll?.(HCL_COVER_SELECTOR) ?? []));
    return covers.some((cover) => likelyItemTitle({ textContent: cover.alt }) && !cover.classList.contains('hcl-cover-owned') && !cover.classList.contains('hcl-cover-new') && !cover.classList.contains('hcl-cover-possible') && !cover.classList.contains('hcl-cover-partial'));
  });
}

function showComparisonProgress(message) {
  let progress = document.querySelector('#hcl-progress');
  if (!progress) {
    progress = document.createElement('aside');
    progress.id = 'hcl-progress';
    progress.className = 'hcl-progress';
    (document.body ?? document.documentElement).append(progress);
  }
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
  return location.pathname === '/bundles' || location.pathname === '/books' || location.pathname === '/games';
}

function renderCataloguePurchaseMarkers(purchaseSummaries) {
  document.querySelectorAll('.hcl-catalog-purchased').forEach((card) => {
    card.classList.remove('hcl-catalog-purchased');
    delete card.dataset.hclCatalogueBadge;
    card.removeAttribute('title');
  });
  const purchasesByTitle = new Map();
  for (const purchase of purchaseSummaries) {
    const key = catalogueTitleKey(purchase.sourceBundle);
    if (!key) continue;
    const existing = purchasesByTitle.get(key) ?? [];
    existing.push(purchase);
    purchasesByTitle.set(key, existing);
  }
  for (const link of document.querySelectorAll('a[href]')) {
    if (!isBundleOfferLink(link)) continue;
    const title = catalogueCardTitle(link);
    const purchases = purchasesByTitle.get(catalogueTitleKey(title));
    if (!purchases?.length) continue;
    const card = catalogueCardContainer(link);
    if (!card) continue;
    const latest = [...purchases].sort((left, right) => String(right.purchasedAt ?? '').localeCompare(String(left.purchasedAt ?? '')))[0];
    card.classList.add('hcl-catalog-purchased');
    card.dataset.hclCatalogueBadge = purchases.length > 1 ? `Purchased ${purchases.length}x` : 'Purchased';
    card.title = `Already purchased${purchases.length > 1 ? ` (${purchases.length} times)` : ''}: ${formatBundlePurchase(latest)}`;
  }
  renderCatalogueSortDiagnostics(sortCatalogueCards());
}

function isBundleOfferLink(link) {
  try {
    const url = new URL(link.href, location.href);
    return url.origin === location.origin && /^\/(?:books|games|software)\/[^/]+/u.test(url.pathname);
  } catch {
    return false;
  }
}

function catalogueCardTitle(link) {
  const imageTitle = link.querySelector('img[alt]')?.alt?.trim();
  if (imageTitle) return imageTitle;
  const heading = link.querySelector('h1, h2, h3, h4, [class*="title" i]');
  return heading?.textContent?.replace(/\s+/gu, ' ').trim() ?? link.getAttribute('aria-label') ?? '';
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
    cards.set(card, { title: catalogueCardTitle(link), endsInMinutes: catalogueEndsInMinutes(card) });
  }
  const sections = new Map();
  for (const [element, data] of cards) {
    const heading = precedingCatalogueSectionHeading(element) ?? document.body;
    const section = sections.get(heading) ?? [];
    section.push({ element, ...data });
    sections.set(heading, section);
  }
  const result = { sections: sections.size, directGroups: 0, directCardsMoved: 0, rowSections: 0, rowCardsMoved: 0, timedCards: [...cards.values()].filter((card) => card.endsInMinutes !== null).length, plannedCrossRowCards: 0, inaccessibleCrossRowCards: 0 };
  for (const section of sections.values()) {
    const sectionResult = sortVisibleCardGroups(section, (left, right) => {
    const leftEnds = left.endsInMinutes;
    const rightEnds = right.endsInMinutes;
    if (leftEnds !== null && rightEnds !== null && leftEnds !== rightEnds) return leftEnds - rightEnds;
    if (leftEnds !== null && rightEnds === null) return -1;
    if (leftEnds === null && rightEnds !== null) return 1;
    return naturalTitleCompare(left.title, right.title);
    }, true);
    result.directGroups += sectionResult.directGroups;
    result.directCardsMoved += sectionResult.directCardsMoved;
    result.rowSections += sectionResult.rowSections;
    result.rowCardsMoved += sectionResult.rowCardsMoved;
    result.plannedCrossRowCards += sectionResult.plannedCrossRowCards;
    result.inaccessibleCrossRowCards += sectionResult.inaccessibleCrossRowCards;
  }
  return result;
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
  message.textContent = `${sorting.sections} section${sorting.sections === 1 ? '' : 's'}; ${sorting.timedCards} card${sorting.timedCards === 1 ? '' : 's'} with an expiry; ${sorting.directGroups} row group${sorting.directGroups === 1 ? '' : 's'} (${sorting.directCardsMoved} cards moved); ${sorting.rowSections} complete section${sorting.rowSections === 1 ? '' : 's'} (${sorting.rowCardsMoved}/${sorting.plannedCrossRowCards} planned cards moved, ${sorting.inaccessibleCrossRowCards} unavailable slots).`;
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
  const text = String(card.textContent ?? '').replace(/\s+/gu, ' ').toLowerCase();
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

function sortVisibleCardGroups(entries, compare, allowDocumentBody = false) {
  const result = { directGroups: 0, directCardsMoved: 0, rowSections: 0, rowCardsMoved: 0, plannedCrossRowCards: 0, inaccessibleCrossRowCards: 0 };
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
  for (const group of chosenGroups.values()) {
    if (group.length < 2) continue;
    result.directGroups += 1;
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

const HCL_NATURAL_TITLE_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function naturalTitleCompare(left, right) {
  return HCL_NATURAL_TITLE_COLLATOR.compare(displayTitle(left), displayTitle(right));
}

async function renderBundleComparison(libraryMatcher, itemKind, currentBundlePurchases = [], collectionMappings = [], comparison = null, job = 0) {
  const { libraryByKey } = libraryMatcher;
  document.querySelectorAll('.hcl-owned-badge, .hcl-new-badge, .hcl-possible-badge, .hcl-partial-badge').forEach((badge) => badge.remove());
  document.querySelectorAll('.hcl-owned-item, .hcl-new-item, .hcl-possible-item, .hcl-partial-item').forEach((item) => {
    item.style.removeProperty('border-left');
    item.style.removeProperty('box-shadow');
    item.style.removeProperty('background-color');
    item.querySelectorAll('h1, h2, h3, h4, h5, p, a, span').forEach((text) => text.style.removeProperty('color'));
  });
  document.querySelectorAll('.hcl-cover-owned, .hcl-cover-new, .hcl-cover-possible, .hcl-cover-partial').forEach((cover) => {
    cover.style.removeProperty('outline');
    cover.style.removeProperty('outline-offset');
    cover.style.removeProperty('box-shadow');
  });
  document.querySelectorAll('.hcl-owned-item, .hcl-new-item, .hcl-possible-item, .hcl-partial-item, .hcl-badge-host, .hcl-card-owned, .hcl-card-new, .hcl-card-possible, .hcl-card-partial, .hcl-cover-owned, .hcl-cover-new, .hcl-cover-possible, .hcl-cover-partial').forEach((item) => {
    item.classList.remove('hcl-owned-item', 'hcl-new-item', 'hcl-possible-item', 'hcl-partial-item', 'hcl-badge-host', 'hcl-card-owned', 'hcl-card-new', 'hcl-card-possible', 'hcl-card-partial', 'hcl-cover-owned', 'hcl-cover-new', 'hcl-cover-possible', 'hcl-cover-partial');
    delete item.dataset.hclBadge;
  });
  document.querySelectorAll('.hcl-title-colored').forEach((item) => {
    item.classList.remove('hcl-title-colored');
    item.style.removeProperty('color');
    item.style.removeProperty('font-weight');
  });
  document.querySelector('#hcl-summary')?.remove();

  const items = collectBundleItems();
  if (!items.length) {
    showComparisonProgress('Waiting for Humble’s bundle items…');
    return;
  }
  const sorting = sortBundleItems(items);
  if (comparison) {
    comparison.itemCount = items.length;
    comparison.sorting = sorting;
  }
  const matchStartedAt = performance.now();
  const counts = { owned: 0, partial: 0, possible: 0, new: 0 };
  const titlesByState = { owned: [], partial: [], possible: [], new: [] };
  const matchesByTitleKey = new Map();
  const tiers = new Map();
  let sliceStartedAt = performance.now();
  for (const [index, item] of items.entries()) {
    const exact = libraryByKey.get(HumbleComicLibrary.titleKey(item.title));
    const volumeRange = exact ? null : findOwnedVolumeRange(item.title, libraryByKey);
    const bookVariant = exact || volumeRange || itemKind !== 'book' ? null : findOwnedBookVariant(item.title, libraryMatcher);
    const collectionIssue = exact || volumeRange || bookVariant || itemKind !== 'book' ? null : findOwnedCollectionIssue(item.title, libraryByKey, collectionMappings);
    const possible = exact || volumeRange || bookVariant || collectionIssue ? null : findPossibleMatch(item.title, libraryMatcher, itemKind);
    const match = exact
      ? { state: 'owned', item: exact }
      : volumeRange?.complete
        ? { state: 'owned', item: volumeRange.items[0], range: volumeRange }
        : volumeRange
          ? { state: 'partial', item: volumeRange.items[0], range: volumeRange }
          : bookVariant ? { state: 'owned', item: bookVariant.item, ownedReason: bookVariant.reason }
          : collectionIssue ? { state: 'owned', item: collectionIssue.item, ownedReason: collectionIssue.reason }
          : possible ? { state: 'possible', item: possible.items, possibleReason: possible.reason } : { state: 'new' };
    matchesByTitleKey.set(HumbleComicLibrary.titleKey(item.title), match);
    counts[match.state] += 1;
    titlesByState[match.state].push({ title: item.title, provenance: matchProvenance(match), range: match.range ?? null });
    const tier = tiers.get(item.tier.label) ?? { ...item.tier, total: 0, owned: 0, partial: 0, possible: 0 };
    tier.total += 1;
    if (match.state === 'owned') tier.owned += 1;
    if (match.state === 'partial') tier.partial += 1;
    if (match.state === 'possible') tier.possible += 1;
    tiers.set(item.tier.label, tier);
    // Large libraries can make an individual card comparison expensive. Yield
    // after a very small CPU slice so Humble can continue painting and loading
    // covers instead of waiting for every title to be checked.
    if (comparison) {
      comparison.completedItems = index + 1;
      if (comparison.job !== job) return;
      if (performance.now() - sliceStartedAt >= 12) {
        showComparisonProgress(`Checking your libraryâ€¦ ${comparison.completedItems}/${items.length} items`);
        await yieldToBrowser();
        if (comparison.job !== job) return;
        sliceStartedAt = performance.now();
      }
    }
  }
  // Tier-detail cards are reliable for item/tier counts, but Humble can show
  // a separate un-tiered gallery as the actual visible card grid. Mirror the
  // already-resolved status onto all cover copies with the same title.
  annotateAllCoverCopies(matchesByTitleKey);
  if (comparison) {
    comparison.lastMatchMs = Math.round(performance.now() - matchStartedAt);
  }
  renderComparisonSummary(counts, tiers, titlesByState, itemKind, currentBundlePurchases, comparison);
}

function yieldToBrowser() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function annotateAllCoverCopies(matchesByTitleKey) {
  for (const image of document.querySelectorAll('img.item-image[alt], img[class~="item-image"][alt]')) {
    const key = HumbleComicLibrary.titleKey(image.alt);
    const match = matchesByTitleKey.get(key);
    if (!match) continue;
    annotateBundleItem({ title: image.alt, element: image, container: productContainer(image) }, match);
  }
}

function collectBundleItems() {
  const coverItems = collectCoverImageItems();
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
    const title = likelyItemTitle(element);
    if (!title) continue;
    const key = HumbleComicLibrary.titleKey(title);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, { title, element, container: productContainer(element), tier: findTier(element) });
  }
  const items = [...byKey.values()];
  // A bundle detail page may include an un-tiered all-items gallery for
  // browsing. When the same page also exposes priced tier groups, the gallery
  // must not become a fourth tier or double the bundle total.
  const tieredItems = items.filter((item) => item.tier.price !== null);
  return tieredItems.length ? tieredItems : items;
}

function collectCoverImageItems() {
  const byKey = new Map();
  const images = document.querySelectorAll('img.item-image[alt], img[class~="item-image"][alt]');
  for (const image of images) {
    const title = String(image.alt ?? '').replace(/\s+/gu, ' ').trim();
    if (!likelyItemTitle({ textContent: title })) continue;
    const key = HumbleComicLibrary.titleKey(title);
    if (!key) continue;
    const container = productContainer(image);
    // Ignore a campaign/brand image that happens to live in a generic product
    // wrapper. Book covers have a non-empty alt and a reasonably local card.
    if (!container || container === document.body) continue;
    const candidate = { title, element: image, container, tier: findTier(image) };
    const existing = byKey.get(key);
    // Humble often renders the same cover in an un-tiered gallery and in the
    // paid tier where it belongs. Prefer the paid-tier copy so counts remain
    // correct and a book is counted only once.
    if (!existing || (existing.tier.price === null && candidate.tier.price !== null)) byKey.set(key, candidate);
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
  const currentBundleBookVariants = [];
  for (const [, item] of libraryByKey) {
    for (const token of significantTokens(item.title)) {
      const entries = byToken.get(token) ?? new Set();
      entries.add(item);
      byToken.set(token, entries);
    }
    if (itemKind === 'book') {
      const parts = bookVariantParts(item.title);
      if (parts.key && !bookVariants.has(parts.key)) bookVariants.set(parts.key, item);
      if (isFromCurrentBundle(item)) currentBundleBookVariants.push({ item, parts });
    }
  }
  return { libraryByKey, byToken, bookVariants, currentBundleBookVariants };
}

function findPossibleMatch(title, libraryMatcher, itemKind = 'book') {
  const { libraryByKey, byToken } = libraryMatcher;
  const numberedBase = numberedTitleBase(title);
  if (numberedBase) {
    const candidate = libraryByKey.get(numberedBase);
    // A listing such as "HAPPY 1" may be an issue-numbered presentation of
    // an imported title such as "Happy!". Keep this conservative: it is a
    // Possible match, never an automatic ownership claim.
    if (candidate) return { items: candidate, reason: 'The listing looks like an issue-numbered version of this library title.' };
  }
  if (itemKind === 'game') {
    const editionBase = gameEditionBase(title);
    const candidate = editionBase ? findGameEditionMatch(editionBase, libraryByKey) : null;
    // Store editions and collections often differ only by DLC. Treat this as
    // a Possible match so the user can review it, never as ownership.
    if (candidate) return { items: candidate, reason: 'The game titles differ only by edition wording.' };
    const component = findGameCollectionOrComponentMatch(title, libraryByKey);
    if (component) return { items: component, reason: 'This game may be included in the named library collection or multi-game entry.' };
  }
  const titleTokens = significantTokens(title);
  if (titleTokens.size < 2) return null;
  let best = null;
  const candidates = new Set();
  for (const token of titleTokens) {
    for (const item of byToken.get(token) ?? []) candidates.add(item);
  }
  for (const item of candidates) {
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

function findOwnedBookVariant(title, libraryMatcher) {
  const target = bookVariantParts(title);
  const formatVariant = libraryMatcher.bookVariants.get(target.key);
  // TP, HC, and Deluxe wording describe a presentation rather than a
  // different book. These remain safe exact matches after stripping only
  // those delivery-format labels.
  if (formatVariant) return { item: formatVariant, reason: 'Matched after removing a book-format suffix.' };
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

function findOwnedCollectionIssue(title, libraryByKey, collectionMappings) {
  const issue = parseIssueTitle(title);
  if (!issue) return null;
  for (const mapping of collectionMappings) {
    const ownedCollection = libraryByKey.get(HumbleComicLibrary.titleKey(mapping.collectionTitle));
    if (!ownedCollection) continue;
    const containsIssue = mapping.contains?.some((entry) => (
      HumbleComicLibrary.titleKey(entry.series) === issue.series
      && Number(entry.year) === issue.year
      && issue.number >= Number(entry.from)
      && issue.number <= Number(entry.to)
    ));
    if (containsIssue) {
      return {
        item: ownedCollection,
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
    .replace(/\b(?:tp|hc|hardcover|paperback|trade paperback|dlx(?: ed)?|deluxe(?: edition)?|digital edition)\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const match = /^(.*?)\s+vol\s*(\d+)$/u.exec(key);
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
  const currentBundle = HumbleComicLibrary.titleKey(document.title);
  const source = HumbleComicLibrary.titleKey(sourceBundle);
  return currentBundle.length >= 12 && source.length >= 12 && (currentBundle.includes(source) || source.includes(currentBundle));
}

function numberedTitleBase(title) {
  const key = HumbleComicLibrary.titleKey(title);
  const match = /^(.*?)\s+#?(\d+)$/u.exec(key);
  return match?.[1]?.trim() || null;
}

function gameEditionBase(title) {
  const key = HumbleComicLibrary.titleKey(title);
  const base = key
    .replace(/\b(?:standard|super|deluxe|ultimate|complete|definitive|collectors?|anniversary|remastered|enhanced|gold|premium|edition)\b/giu, ' ')
    .replace(/\bgame of the year\b|\bgoty\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return base && base !== key ? base : null;
}

function findGameEditionMatch(editionBase, libraryByKey) {
  for (const [key, item] of libraryByKey) {
    const candidateBase = gameEditionBase(item.title) ?? key;
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
  const match = /^(.*?)\s+vol(?:ume)?\.?\s*(\d+)\s*(?:-|–|—|to)\s*(\d+)\s*$/iu.exec(pageLabel);
  if (!match) return null;
  const [, series, firstText, lastText] = match;
  const first = Number(firstText);
  const last = Number(lastText);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last - first > 49) return null;
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
  const isPossible = match.state === 'possible';
  const isPartial = match.state === 'partial';
  // The image wrapper scales on Humble hover, which turns a label attached to
  // it into a giant pill. Anchor the status to the stable item card instead.
  const badgeHost = bundleItem.container ?? bundleItem.element.parentElement;
  const provenance = matchProvenance(match);
  badgeHost?.classList.add('hcl-badge-host');
  if (badgeHost) {
    badgeHost.dataset.hclBadge = isOwned ? 'Owned' : isPartial ? `${match.range.owned}/${match.range.total} Owned` : isPossible ? 'Possible' : 'New';
    if (provenance) badgeHost.title = provenance;
    else badgeHost.removeAttribute('title');
  }
  const stateClass = isOwned ? 'owned' : isPartial ? 'partial' : isPossible ? 'possible' : 'new';
  bundleItem.container?.classList.add(`hcl-${stateClass}-item`);
  bundleItem.element.classList.add(`hcl-cover-${stateClass}`);
  const card = findSingleCoverCard(bundleItem.element);
  card?.classList.add(`hcl-card-${stateClass}`);
  colorExactCardTitle(card, bundleItem.title, stateClass);
  applyVisibleCardStatus(bundleItem.container, stateClass);
  applyCoverStatus(bundleItem.element, stateClass);
}

function matchProvenance(match) {
  const records = matchLibraryItems(match).flatMap((item) => itemProvenance(item));
  if (!records.length) return '';
  const heading = match.state === 'possible'
    ? `Possible match: ${match.possibleReason ?? 'similar library title.'}`
    : match.state === 'partial'
      ? `Partially owned: ${match.range.owned} of ${match.range.total} volumes found.`
      : match.ownedReason ? `Owned in your library: ${match.ownedReason}` : 'Owned in your library:';
  const seen = new Set();
  const lines = [heading];
  for (const record of records) {
    const identity = `${record.title ?? ''}\u0000${record.purchaseKey ?? ''}\u0000${record.sourceBundle ?? ''}\u0000${record.purchasedAt ?? ''}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const source = record.sourceBundle ? `Humble bundle: ${record.sourceBundle}` : 'Imported library title';
    const purchased = formatPurchaseDate(record.purchasedAt);
    lines.push(`• ${displayTitle(record.title)} — ${source}${purchased ? ` (${purchased})` : ''}`);
  }
  return lines.join('\n');
}

function matchLibraryItems(match) {
  const entries = match.range ? match.range.items : match.item ? [match.item] : [];
  return entries.flatMap((entry) => Array.isArray(entry) ? entry : [entry]).filter(Boolean);
}

function itemProvenance(item) {
  const records = Array.isArray(item.provenance) && item.provenance.length
    ? item.provenance
    : [{ title: item.title, sourceBundle: item.sourceBundle, purchaseKey: item.purchaseKey, purchasedAt: item.purchasedAt }];
  return records.map((record) => ({ ...record, title: record.title ?? item.title }));
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
  return state === 'owned' ? '#0a7a42' : state === 'new' ? '#1769aa' : state === 'partial' ? '#7c3fb0' : '#b06d00';
}

function renderComparisonSummary(counts, tiers, titlesByState, itemKind, currentBundlePurchases = [], comparison = null) {
  const summary = document.createElement('aside');
  summary.id = 'hcl-summary';
  summary.className = 'hcl-summary';
  const headline = document.createElement('strong');
  const itemLabel = itemKind === 'game' ? 'games' : 'books';
  headline.textContent = `Your ${itemLabel}: ${counts.owned} owned · ${counts.new} new${counts.partial ? ` · ${counts.partial} partial` : ''}`;
  summary.append(headline);
  const highestTierPrice = Math.max(...[...tiers.values()].map((tier) => tier.price ?? 0));
  appendPurchasedBundleStatus(summary, currentBundlePurchases, highestTierPrice || null);
  const legend = document.createElement('div');
  legend.className = 'hcl-legend';
  legend.innerHTML = '<span class="hcl-legend-owned">Owned</span><span class="hcl-legend-new">New</span><span class="hcl-legend-partial">Partial</span><span class="hcl-legend-possible">Possible</span>';
  summary.append(legend);
  if (counts.partial) {
    const partial = document.createElement('p');
    partial.textContent = `${counts.partial} grouped range${counts.partial === 1 ? ' is' : 's are'} only partly owned — not counted as owned or new.`;
    summary.append(partial);
  }
  if (counts.possible) {
    const possible = document.createElement('p');
    possible.textContent = `${counts.possible} possible match${counts.possible === 1 ? '' : 'es'} — not counted as owned.`;
    summary.append(possible);
  }
  if (tiers.size > 1 || [...tiers.values()][0]?.price !== null) {
    const tierList = document.createElement('ul');
    const orderedTiers = [...tiers.values()].sort((left, right) => (left.price ?? Number.POSITIVE_INFINITY) - (right.price ?? Number.POSITIVE_INFINITY));
    let cumulativeTotal = 0;
    let cumulativeOwned = 0;
    let cumulativePartial = 0;
    let cumulativePossible = 0;
    for (const tier of orderedTiers) {
      // Humble's price levels are cumulative: the $15 level includes $5 items,
      // and so on. Each visual group contains the items first unlocked at that
      // price, so display the total actually received at each tier.
      cumulativeTotal += tier.total;
      cumulativeOwned += tier.owned;
      cumulativePartial += tier.partial;
      cumulativePossible += tier.possible;
      const newItems = cumulativeTotal - cumulativeOwned - cumulativePartial - cumulativePossible;
      const row = document.createElement('li');
      const priceText = tier.price === null ? tier.label : `${tier.label}: `;
      const perNew = tier.price !== null && newItems ? ` · $${(tier.price / newItems).toFixed(2)} per confirmed-new item` : '';
      row.textContent = `${priceText}${newItems} confirmed new / ${cumulativeTotal} items${perNew}`;
      tierList.append(row);
    }
    summary.append(tierList);
  }
  for (const state of ['owned', 'new', 'partial', 'possible']) {
    if (!titlesByState[state].length) continue;
    const detail = document.createElement('details');
    detail.className = 'hcl-title-list';
    const heading = document.createElement('summary');
    heading.textContent = `${state === 'owned' ? 'Owned' : state === 'new' ? 'New' : state === 'partial' ? 'Partially owned' : 'Possible matches'} (${titlesByState[state].length})`;
    detail.append(heading);
    const list = document.createElement('ol');
    for (const item of titlesByState[state].sort((left, right) => naturalTitleCompare(left.title, right.title))) {
      const row = document.createElement('li');
      row.textContent = `${displayTitle(item.title)}${item.range && !item.range.complete ? ` — ${item.range.owned}/${item.range.total} volumes owned` : ''}`;
      row.title = item.provenance;
      list.append(row);
    }
    detail.append(list);
    summary.append(detail);
  }
  const diagnostic = document.createElement('button');
  diagnostic.className = 'hcl-diagnostic-button';
  diagnostic.textContent = 'Download complete tier list';
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
  if (comparison) appendComparisonDiagnostics(summary, comparison);
  removeComparisonProgress();
  document.body.append(summary);
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
  document.body.append(summary);
}

function appendPurchasedBundleStatus(summary, purchases, highestTierPrice = null) {
  if (!purchases.length) return;
  const paidAmounts = purchases.map((purchase) => Number(purchase.pricePaid)).filter(Number.isFinite);
  const hasTopTier = highestTierPrice === null || !paidAmounts.length || paidAmounts.some((amount) => amount >= highestTierPrice);
  const status = document.createElement('p');
  status.className = `hcl-purchased-bundle ${hasTopTier ? 'hcl-purchased-full' : 'hcl-purchased-partial'}`;
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
    for (const title of titles.sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))) lines.push(`- ${title}`);
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

function addPurchaseImporter() {
  if (document.querySelector('#hcl-importer')) return;
  const panel = document.createElement('section');
  panel.id = 'hcl-importer';
  panel.className = 'hcl-importer';
  panel.innerHTML = `
    <strong>Humble Comic Library</strong>
    <span>Import eligible books, comics, and games from this purchase history into this browser.</span>
    <div class="hcl-import-actions">
      <button type="button" data-import-mode="new">Import new purchases</button>
      <button type="button" data-import-mode="all" title="Reprocesses every purchase and rebuilds Humble game entries.">Rescan every purchase</button>
    </div>
    <output aria-live="polite"></output>`;
  const buttons = [...panel.querySelectorAll('[data-import-mode]')];
  const status = panel.querySelector('output');
  for (const button of buttons) button.addEventListener('click', async () => {
    const fullRescan = button.dataset.importMode === 'all';
    if (fullRescan && !confirm('Rescan every Humble purchase? This can take a while.')) return;
    buttons.forEach((control) => { control.disabled = true; });
    try {
      const result = await importPurchases((message) => { status.textContent = message; }, { fullRescan });
      const scope = fullRescan
        ? `Rescanned ${result.scannedPurchases} purchase${result.scannedPurchases === 1 ? '' : 's'}`
        : `Scanned ${result.scannedPurchases} new purchase${result.scannedPurchases === 1 ? '' : 's'} and skipped ${result.skippedKnown} already scanned`;
      status.textContent = `${scope}; imported ${result.added} new item${result.added === 1 ? '' : 's'} (${result.addedGames} game${result.addedGames === 1 ? '' : 's'})${result.datesBackfilled ? ` and backfilled ${result.datesBackfilled} purchase date${result.datesBackfilled === 1 ? '' : 's'}` : ''}${result.failures ? `; ${result.failures} purchase${result.failures === 1 ? '' : 's'} could not be imported and will be retried next time` : ''}; ${result.total} total items.`;
    } catch (error) {
      status.textContent = `Import failed: ${error.message}`;
    } finally {
      buttons.forEach((control) => { control.disabled = false; });
    }
  });
  document.body.prepend(panel);
}

async function importPurchases(report, { fullRescan = false } = {}) {
  // This endpoint is used by Humble's purchase pages. Fetching occurs in the
  // authenticated Humble tab, so no cookie is read, copied, or stored by us.
  report('Loading your purchase list…');
  const orders = await fetchJson('/api/v1/user/order?all=true');
  const orderList = Array.isArray(orders) ? orders : orders?.data ?? orders?.orders;
  if (!Array.isArray(orderList)) throw new Error('Humble returned an unexpected purchase list. Please report this page format.');
  const { libraryItems = [], purchaseSummaries: existingPurchases = [] } = await chrome.storage.local.get({ libraryItems: [], purchaseSummaries: [] });
  const previouslyScanned = new Set(existingPurchases.map((purchase) => purchase.purchaseKey).filter(Boolean));
  const purchasesToScan = orderList.filter((order) => {
    const key = order.gamekey ?? order.key ?? order.order_key;
    return key && (fullRescan || !previouslyScanned.has(key));
  });

  const imported = [];
  const purchaseSummaries = [];
  const failures = [];
  for (let index = 0; index < purchasesToScan.length; index += 1) {
    const order = purchasesToScan[index];
    const key = order.gamekey ?? order.key ?? order.order_key;
    report(`Checking ${fullRescan ? 'purchase' : 'new purchase'} ${index + 1} of ${purchasesToScan.length}…`);
    try {
      const detail = await fetchOrderDetail(key);
      const items = extractLibraryItems(detail, order, key);
      imported.push(...items);
      purchaseSummaries.push(createPurchaseSummary(detail, order, key, items));
    } catch {
      failures.push(key);
    }
    // Avoid piling up requests against Humble for accounts with long histories.
    await new Promise((resolve) => setTimeout(resolve, 175));
  }

  // Full rescans rebuild Humble game entries from the explicit entitlement
  // collection. Incremental scans retain known games and add only new ones.
  const retainedItems = fullRescan
    ? libraryItems.filter((item) => item.kind !== 'game' || item.source !== 'humble')
    : libraryItems;
  const merged = new Map(retainedItems.map((item) => [libraryItemKey(item), item]));
  let added = 0;
  let addedGames = 0;
  let datesBackfilled = 0;
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
    added += 1;
    if (item.kind === 'game') addedGames += 1;
  }
  const importSummary = {
    importedAt: new Date().toISOString(),
    scannedPurchases: purchasesToScan.length,
    skippedKnown: orderList.length - purchasesToScan.length,
    addedTitles: added,
    addedGames,
    datesBackfilled,
    pricedPurchases: purchaseSummaries.filter((purchase) => purchase.pricePaid !== null).length,
    skippedPurchases: failures.length
  };
  const allPurchases = new Map(existingPurchases.map((purchase) => [purchase.purchaseKey, purchase]));
  for (const purchase of purchaseSummaries) allPurchases.set(purchase.purchaseKey, purchase);
  await chrome.storage.local.set({ libraryItems: [...merged.values()], purchaseSummaries: [...allPurchases.values()], lastImport: importSummary });
  return {
    added,
    addedGames,
    datesBackfilled,
    pricedPurchases: importSummary.pricedPurchases,
    total: merged.size,
    failures: failures.length,
    scannedPurchases: purchasesToScan.length,
    skippedKnown: importSummary.skippedKnown
  };
}

function withProvenance(item) {
  return { ...item, provenance: dedupeProvenance(itemProvenance(item)) };
}

function mergeLibraryItem(existing, incoming) {
  return {
    ...existing,
    purchasedAt: existing.purchasedAt || incoming.purchasedAt,
    purchaseKey: existing.purchaseKey || incoming.purchaseKey,
    provenance: dedupeProvenance([...itemProvenance(existing), ...itemProvenance(incoming)])
  };
}

function dedupeProvenance(records) {
  const seen = new Set();
  return records.filter((record) => {
    const key = `${record.title ?? ''}\u0000${record.purchaseKey ?? ''}\u0000${record.sourceBundle ?? ''}\u0000${record.purchasedAt ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    .replace(/("(?:redeemed_)?key(?:_val|_value)?"\s*:\s*)"(?:[^"\\]|\\.)*"/giu, '$1null');
  return JSON.parse(redacted);
}

function extractLibraryItems(detail, order, purchaseKey) {
  const products = Array.isArray(detail?.subproducts) ? detail.subproducts
    : Array.isArray(detail?.products) ? detail.products : [];
  const sourceBundle = extractBundleName(order, detail);
  const purchasedAt = extractPurchasedAt(order, detail);
  const candidates = products.length ? products : [detail];
  const directItems = candidates
    .map((product) => ({ product, kind: productKind(product) }))
    .filter(({ kind }) => kind)
    .map(({ product, kind }) => ({
      title: String(product.human_name ?? product.product_name ?? product.title ?? product.name ?? '').trim(),
      kind,
      source: 'humble',
      sourceBundle,
      purchaseKey,
      purchasedAt
    }))
    .filter(({ title }) => Boolean(title));
  return [...directItems, ...extractThirdPartyKeyItems(detail, order, purchaseKey)];
}

function extractThirdPartyKeyItems(detail, order, purchaseKey) {
  const keyRecords = [
    detail?.tpkd_dict?.all_tpks,
    detail?.tpkd_dict?.all_tpkds,
    detail?.all_tpks,
    detail?.all_tpkds
  ].flatMap((records) => Array.isArray(records) ? records : []);
  const sourceBundle = extractBundleName(order, detail);
  const purchasedAt = extractPurchasedAt(order, detail);
  return keyRecords
    .map((record) => String(record?.human_name ?? record?.product_name ?? record?.name ?? '').trim())
    .filter(Boolean)
    .map((title) => ({ title, kind: 'game', source: 'humble', sourceBundle, purchaseKey, purchasedAt }));
}

function libraryItemKey(item) {
  return `${item.kind ?? 'book'}:${HumbleComicLibrary.titleKey(item.title)}`;
}

function createPurchaseSummary(detail, order, purchaseKey, items) {
  const price = extractPaidPrice(order, detail);
  const itemCount = items.length;
  return {
    purchaseKey,
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

function productKind(product) {
  // Check game delivery first: game bundles can include PDF manuals or art
  // books, which must not cause the game itself to be filed as a book.
  if (hasGameEntitlement(product)) return 'game';
  return hasBookDownload(product) ? 'book' : null;
}

function hasGameEntitlement(product) {
  const serialized = JSON.stringify(product);
  // Humble has used several response shapes, but game products consistently
  // identify a storefront/platform or a game-like content category. Keep the
  // signals narrow to avoid importing arbitrary non-book extras.
  return /"(?:category|content_type|item_content_type|product_type)"\s*:\s*"(?:game|software|dlc)"/iu.test(serialized)
    || /"(?:platform|platform_name|key_type|storefront)"\s*:\s*"[^"\\]*(?:steam|gog|epic|origin|uplay|ubisoft|ea(?:\s+app)?|itch(?:\.io)?|windows|mac|linux|android|ios)[^"\\]*"/iu.test(serialized)
    || /"(?:platforms|platforms_and_oses)"\s*:\s*(?:\[[^\]]*"(?:steam|gog|epic|windows|mac|linux|android|ios)|\{)/iu.test(serialized)
    || /\.(?:exe|dmg|apk|appimage|x86_64)(?:["?\\]|$)/iu.test(serialized);
}

function hasBookDownload(product) {
  // Humble's responses have changed shape over time. Looking only within each
  // product avoids treating a bundle name as a book, while accepting the PDF,
  // EPUB, CBZ, CBR, and MOBI variants used across Humble book bundles.
  const serialized = JSON.stringify(product);
  return /\.(?:pdf|epub|cbz|cbr|mobi)(?:["?\\]|$)/iu.test(serialized)
    || /"(?:format|filetype|extension)"\s*:\s*"(?:pdf|epub|cbz|cbr|mobi)"/iu.test(serialized);
}
