(async function initialiseHumbleComicLibrary() {
  'use strict';

  if (location.pathname.startsWith('/home/purchases')) {
    addPurchaseImporter();
    return;
  }

  if (!location.pathname.startsWith('/books/')) return;

  const storage = await chrome.storage.local.get({ libraryItems: [] });
  const libraryItems = storage.libraryItems;
  if (!libraryItems.length) return;

  const byKey = new Map();
  for (const item of libraryItems) {
    const key = HumbleComicLibrary.titleKey(item.title);
    if (!key) continue;
    const existing = byKey.get(key) ?? [];
    existing.push(item);
    byKey.set(key, existing);
  }

  const libraryByKey = new Map([...byKey].map(([key, items]) => [key, items[0]]));
  let refreshTimer;
  const refresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => renderBundleComparison(libraryByKey), 150);
  };
  refresh();
  window.addEventListener('resize', refresh, { passive: true });
  let coverCount = document.querySelectorAll('img.item-image[alt], img[class~="item-image"][alt]').length;
  new MutationObserver((records) => {
    // Humble renders covers lazily. Only re-run when its actual cover set
    // changes; observing every DOM mutation reset expandable result lists as
    // the page updated incidental interface elements.
    if (!records.length) return;
    const nextCoverCount = document.querySelectorAll('img.item-image[alt], img[class~="item-image"][alt]').length;
    const coversLostAnnotations = [...document.querySelectorAll('img.item-image[alt], img[class~="item-image"][alt]')]
      .some((cover) => likelyBookTitle({ textContent: cover.alt }) && !cover.classList.contains('hcl-cover-owned') && !cover.classList.contains('hcl-cover-new') && !cover.classList.contains('hcl-cover-possible'));
    if (nextCoverCount !== coverCount || coversLostAnnotations) {
      coverCount = nextCoverCount;
      refresh();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}()).catch((error) => console.warn('Humble Comic Library failed to initialise:', error));

function renderBundleComparison(libraryByKey) {
  document.querySelectorAll('.hcl-owned-badge, .hcl-new-badge, .hcl-possible-badge').forEach((badge) => badge.remove());
  document.querySelectorAll('.hcl-owned-item, .hcl-new-item, .hcl-possible-item').forEach((item) => {
    item.style.removeProperty('border-left');
    item.style.removeProperty('box-shadow');
    item.style.removeProperty('background-color');
    item.querySelectorAll('h1, h2, h3, h4, h5, p, a, span').forEach((text) => text.style.removeProperty('color'));
  });
  document.querySelectorAll('.hcl-cover-owned, .hcl-cover-new, .hcl-cover-possible').forEach((cover) => {
    cover.style.removeProperty('outline');
    cover.style.removeProperty('outline-offset');
    cover.style.removeProperty('box-shadow');
  });
  document.querySelectorAll('.hcl-owned-item, .hcl-new-item, .hcl-possible-item, .hcl-badge-host, .hcl-card-owned, .hcl-card-new, .hcl-card-possible, .hcl-cover-owned, .hcl-cover-new, .hcl-cover-possible').forEach((item) => {
    item.classList.remove('hcl-owned-item', 'hcl-new-item', 'hcl-possible-item', 'hcl-badge-host', 'hcl-card-owned', 'hcl-card-new', 'hcl-card-possible', 'hcl-cover-owned', 'hcl-cover-new', 'hcl-cover-possible');
    delete item.dataset.hclBadge;
  });
  document.querySelectorAll('.hcl-title-colored').forEach((item) => {
    item.classList.remove('hcl-title-colored');
    item.style.removeProperty('color');
    item.style.removeProperty('font-weight');
  });
  document.querySelector('#hcl-summary')?.remove();

  const items = collectBundleItems();
  if (!items.length) return;
  const counts = { owned: 0, possible: 0, new: 0 };
  const titlesByState = { owned: [], possible: [], new: [] };
  const matchesByTitleKey = new Map();
  const tiers = new Map();
  for (const item of items) {
    const exact = libraryByKey.get(HumbleComicLibrary.titleKey(item.title));
    const possible = exact ? null : findPossibleMatch(item.title, libraryByKey);
    const match = exact ? { state: 'owned', item: exact } : possible ? { state: 'possible', item: possible } : { state: 'new' };
    matchesByTitleKey.set(HumbleComicLibrary.titleKey(item.title), match);
    counts[match.state] += 1;
    titlesByState[match.state].push({ title: item.title, sourceBundle: match.item?.sourceBundle ?? null });
    const tier = tiers.get(item.tier.label) ?? { ...item.tier, total: 0, owned: 0, possible: 0 };
    tier.total += 1;
    if (match.state === 'owned') tier.owned += 1;
    if (match.state === 'possible') tier.possible += 1;
    tiers.set(item.tier.label, tier);
  }
  // Tier-detail cards are reliable for item/tier counts, but Humble can show
  // a separate un-tiered gallery as the actual visible card grid. Mirror the
  // already-resolved status onto all cover copies with the same title.
  annotateAllCoverCopies(matchesByTitleKey);
  renderComparisonSummary(counts, tiers, titlesByState);
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
    const title = likelyBookTitle(element);
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
    if (!likelyBookTitle({ textContent: title })) continue;
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

function likelyBookTitle(element) {
  const text = element.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
  if (text.length < 2 || text.length > 180) return null;
  const ignored = /^(buy|pay|details|learn more|view all|share|books|bundle|choose what you pay|about this bundle)$/iu;
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

function findPossibleMatch(title, libraryByKey) {
  const titleTokens = significantTokens(title);
  if (titleTokens.size < 2) return null;
  let best = null;
  for (const [key, item] of libraryByKey) {
    const candidateTokens = new Set(key.split(' ').filter(Boolean));
    const overlap = [...titleTokens].filter((token) => candidateTokens.has(token)).length;
    const score = overlap / new Set([...titleTokens, ...candidateTokens]).size;
    // Potential matches are never counted as owned. This deliberately high
    // threshold catches trivial title variation while avoiding guesswork.
    if (score >= 0.82 && (!best || score > best.score)) best = { item, score };
  }
  return best?.item ?? null;
}

function significantTokens(title) {
  const ignore = new Set(['the', 'and', 'of', 'a', 'an', 'vol', 'volume', 'book', 'edition']);
  return new Set(HumbleComicLibrary.titleKey(title).split(' ').filter((token) => token.length > 1 && !ignore.has(token)));
}

function annotateBundleItem(bundleItem, match) {
  if (!bundleItem.element.isConnected) return;
  const isOwned = match.state === 'owned';
  const isPossible = match.state === 'possible';
  // The image wrapper scales on Humble hover, which turns a label attached to
  // it into a giant pill. Anchor the status to the stable item card instead.
  const badgeHost = bundleItem.container ?? bundleItem.element.parentElement;
  badgeHost?.classList.add('hcl-badge-host');
  if (badgeHost) {
    badgeHost.dataset.hclBadge = isOwned ? 'Owned' : isPossible ? 'Possible' : 'New';
    badgeHost.removeAttribute('title');
  }
  const stateClass = isOwned ? 'owned' : isPossible ? 'possible' : 'new';
  bundleItem.container?.classList.add(`hcl-${stateClass}-item`);
  bundleItem.element.classList.add(`hcl-cover-${stateClass}`);
  const card = findSingleCoverCard(bundleItem.element);
  card?.classList.add(`hcl-card-${stateClass}`);
  colorExactCardTitle(card, bundleItem.title, stateClass);
  applyVisibleCardStatus(bundleItem.container, stateClass);
  applyCoverStatus(bundleItem.element, stateClass);
}

function applyCoverStatus(cover, state) {
  const color = state === 'owned' ? '#0a7a42' : state === 'possible' ? '#b06d00' : '#1769aa';
  cover.style.setProperty('outline', `2px solid ${color}`, 'important');
  cover.style.setProperty('outline-offset', '2px', 'important');
  cover.style.removeProperty('box-shadow');
}

function applyVisibleCardStatus(card, state) {
  if (!card) return;
  const color = state === 'owned' ? '#0a7a42' : state === 'possible' ? '#b06d00' : '#1769aa';
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
  const color = state === 'owned' ? '#0a7a42' : state === 'possible' ? '#b06d00' : '#1769aa';
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

function renderComparisonSummary(counts, tiers, titlesByState) {
  const summary = document.createElement('aside');
  summary.id = 'hcl-summary';
  summary.className = 'hcl-summary';
  const headline = document.createElement('strong');
  headline.textContent = `Your library: ${counts.owned} owned · ${counts.new} new`;
  summary.append(headline);
  const legend = document.createElement('div');
  legend.className = 'hcl-legend';
  legend.innerHTML = '<span class="hcl-legend-owned">Owned</span><span class="hcl-legend-new">New</span><span class="hcl-legend-possible">Possible</span>';
  summary.append(legend);
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
    let cumulativePossible = 0;
    for (const tier of orderedTiers) {
      // Humble's price levels are cumulative: the $15 level includes $5 items,
      // and so on. Each visual group contains the items first unlocked at that
      // price, so display the total actually received at each tier.
      cumulativeTotal += tier.total;
      cumulativeOwned += tier.owned;
      cumulativePossible += tier.possible;
      const newItems = cumulativeTotal - cumulativeOwned - cumulativePossible;
      const row = document.createElement('li');
      const priceText = tier.price === null ? tier.label : `${tier.label}: `;
      const perNew = tier.price !== null && newItems ? ` · $${(tier.price / newItems).toFixed(2)} per confirmed-new item` : '';
      row.textContent = `${priceText}${newItems} confirmed new / ${cumulativeTotal} items${perNew}`;
      tierList.append(row);
    }
    summary.append(tierList);
  }
  for (const state of ['owned', 'new', 'possible']) {
    if (!titlesByState[state].length) continue;
    const detail = document.createElement('details');
    detail.className = 'hcl-title-list';
    const heading = document.createElement('summary');
    heading.textContent = `${state === 'owned' ? 'Owned' : state === 'new' ? 'New' : 'Possible matches'} (${titlesByState[state].length})`;
    detail.append(heading);
    const list = document.createElement('ol');
    for (const item of titlesByState[state].sort((left, right) => left.title.localeCompare(right.title))) {
      const row = document.createElement('li');
      row.textContent = displayTitle(item.title);
      row.title = item.sourceBundle ? `Owned from ${item.sourceBundle}` : '';
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
  document.body.append(summary);
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
    } catch (error) {
      console.warn('Humble Comic Library could not retrieve this bundle page:', error);
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
  } catch (error) {
    console.warn('Humble Comic Library could not read the page tier data:', error);
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
    <span>Import DRM-free book and comic titles from this purchase history into this browser.</span>
    <button type="button">Import book &amp; comic titles</button>
    <output aria-live="polite"></output>`;
  const [button] = panel.querySelectorAll('button');
  const status = panel.querySelector('output');
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const result = await importPurchases((message) => { status.textContent = message; });
      status.textContent = `Imported ${result.added} new title${result.added === 1 ? '' : 's'}${result.datesBackfilled ? ` and backfilled ${result.datesBackfilled} purchase date${result.datesBackfilled === 1 ? '' : 's'}` : ''}; found prices for ${result.pricedPurchases} purchase${result.pricedPurchases === 1 ? '' : 's'}; ${result.total} total titles.`;
    } catch (error) {
      status.textContent = `Import failed: ${error.message}`;
      console.warn('Humble Comic Library import failed:', error);
    } finally {
      button.disabled = false;
    }
  });
  document.body.prepend(panel);
}

async function importPurchases(report) {
  // This endpoint is used by Humble's purchase pages. Fetching occurs in the
  // authenticated Humble tab, so no cookie is read, copied, or stored by us.
  report('Loading your purchase list…');
  const orders = await fetchJson('/api/v1/user/order?all=true');
  const orderList = Array.isArray(orders) ? orders : orders?.data ?? orders?.orders;
  if (!Array.isArray(orderList)) throw new Error('Humble returned an unexpected purchase list. Please report this page format.');

  const imported = [];
  const purchaseSummaries = [];
  const failures = [];
  for (let index = 0; index < orderList.length; index += 1) {
    const order = orderList[index];
    const key = order.gamekey ?? order.key ?? order.order_key;
    if (!key) continue;
    report(`Checking purchase ${index + 1} of ${orderList.length}…`);
    try {
      const detail = await fetchJson(`/api/v1/order/${encodeURIComponent(key)}`);
      const items = extractBookItems(detail, order, key);
      imported.push(...items);
      purchaseSummaries.push(createPurchaseSummary(detail, order, key, items));
    } catch (error) {
      failures.push(key);
      console.warn(`Could not import Humble purchase ${key}:`, error);
    }
    // Avoid piling up requests against Humble for accounts with long histories.
    await new Promise((resolve) => setTimeout(resolve, 175));
  }

  const { libraryItems = [], purchaseSummaries: existingPurchases = [] } = await chrome.storage.local.get({ libraryItems: [], purchaseSummaries: [] });
  const merged = new Map(libraryItems.map((item) => [HumbleComicLibrary.titleKey(item.title), item]));
  let added = 0;
  let datesBackfilled = 0;
  for (const item of imported) {
    const key = HumbleComicLibrary.titleKey(item.title);
    if (!key) continue;
    const existing = merged.get(key);
    if (existing) {
      // Re-imports are safe and let us enrich older entries when Humble reveals
      // more purchase metadata than an earlier response exposed.
      if (!existing.purchasedAt && item.purchasedAt) {
        merged.set(key, { ...existing, purchasedAt: item.purchasedAt, purchaseKey: existing.purchaseKey || item.purchaseKey });
        datesBackfilled += 1;
      }
      continue;
    }
    merged.set(key, item);
    added += 1;
  }
  const importSummary = {
    importedAt: new Date().toISOString(),
    scannedPurchases: orderList.length,
    addedTitles: added,
    datesBackfilled,
    pricedPurchases: purchaseSummaries.filter((purchase) => purchase.pricePaid !== null).length,
    skippedPurchases: failures.length
  };
  const allPurchases = new Map(existingPurchases.map((purchase) => [purchase.purchaseKey, purchase]));
  for (const purchase of purchaseSummaries) allPurchases.set(purchase.purchaseKey, purchase);
  await chrome.storage.local.set({ libraryItems: [...merged.values()], purchaseSummaries: [...allPurchases.values()], lastImport: importSummary });
  return { added, datesBackfilled, pricedPurchases: importSummary.pricedPurchases, total: merged.size, failures: failures.length };
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

function extractBookItems(detail, order, purchaseKey) {
  const products = Array.isArray(detail?.subproducts) ? detail.subproducts
    : Array.isArray(detail?.products) ? detail.products : [];
  const sourceBundle = extractBundleName(order, detail);
  const purchasedAt = extractPurchasedAt(order, detail);
  const candidates = products.length ? products : [detail];
  return candidates
    .filter(hasBookDownload)
    .map((product) => String(product.human_name ?? product.product_name ?? product.title ?? product.name ?? '').trim())
    .filter(Boolean)
    .map((title) => ({
      title,
      source: 'humble',
      sourceBundle,
      purchaseKey,
      purchasedAt
    }));
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

function hasBookDownload(product) {
  // Humble's responses have changed shape over time. Looking only within each
  // product avoids treating a bundle name as a book, while accepting the PDF,
  // EPUB, CBZ, CBR, and MOBI variants used across Humble book bundles.
  const serialized = JSON.stringify(product);
  return /\.(?:pdf|epub|cbz|cbr|mobi)(?:["?\\]|$)/iu.test(serialized)
    || /"(?:format|filetype|extension)"\s*:\s*"(?:pdf|epub|cbz|cbr|mobi)"/iu.test(serialized);
}
