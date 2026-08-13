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

  const seen = new Set();
  let owned = 0;
  let candidates = 0;

  function likelyBookTitle(element) {
    const text = element.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
    if (text.length < 2 || text.length > 180) return null;
    const ignored = /^(buy|pay|details|learn more|view all|share|books|bundle)$/iu;
    return ignored.test(text) ? null : text;
  }

  // Humble changes class names regularly. Prefer likely product headings and retain
  // data attributes as a second source when present.
  const selector = [
    '[data-testid*="product" i] h1', '[data-testid*="product" i] h2', '[data-testid*="product" i] h3',
    '[class*="product" i] h1', '[class*="product" i] h2', '[class*="product" i] h3',
    '[class*="item" i] h2', '[class*="item" i] h3'
  ].join(', ');

  for (const heading of document.querySelectorAll(selector)) {
    if (seen.has(heading)) continue;
    seen.add(heading);
    const title = likelyBookTitle(heading);
    if (!title) continue;
    candidates += 1;
    const matches = byKey.get(HumbleComicLibrary.titleKey(title));
    if (!matches?.length) continue;

    owned += 1;
    const item = matches[0];
    const badge = document.createElement('span');
    badge.className = 'hcl-owned-badge';
    badge.textContent = 'Owned';
    badge.title = item.sourceBundle ? `Owned from ${item.sourceBundle}` : 'In your local Humble library';
    heading.insertAdjacentElement('afterend', badge);
    heading.closest('[class*="product" i], [class*="item" i], li, article')?.classList.add('hcl-owned-item');
  }

  if (candidates) {
    const summary = document.createElement('aside');
    summary.className = 'hcl-summary';
    summary.textContent = `Humble Comic Library: ${owned} of ${candidates} detected titles owned`;
    document.body.append(summary);
  }
}()).catch((error) => console.warn('Humble Comic Library failed to initialise:', error));

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
      status.textContent = `Imported ${result.added} new title${result.added === 1 ? '' : 's'}; ${result.total} total in your local library.`;
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
  const failures = [];
  for (let index = 0; index < orderList.length; index += 1) {
    const order = orderList[index];
    const key = order.gamekey ?? order.key ?? order.order_key;
    if (!key) continue;
    report(`Checking purchase ${index + 1} of ${orderList.length}…`);
    try {
      const detail = await fetchJson(`/api/v1/order/${encodeURIComponent(key)}`);
      imported.push(...extractBookItems(detail, order, key));
    } catch (error) {
      failures.push(key);
      console.warn(`Could not import Humble purchase ${key}:`, error);
    }
    // Avoid piling up requests against Humble for accounts with long histories.
    await new Promise((resolve) => setTimeout(resolve, 175));
  }

  const { libraryItems = [] } = await chrome.storage.local.get({ libraryItems: [] });
  const merged = new Map(libraryItems.map((item) => [HumbleComicLibrary.titleKey(item.title), item]));
  let added = 0;
  for (const item of imported) {
    const key = HumbleComicLibrary.titleKey(item.title);
    if (!key || merged.has(key)) continue;
    merged.set(key, item);
    added += 1;
  }
  const importSummary = {
    importedAt: new Date().toISOString(),
    scannedPurchases: orderList.length,
    addedTitles: added,
    skippedPurchases: failures.length
  };
  await chrome.storage.local.set({ libraryItems: [...merged.values()], lastImport: importSummary });
  return { added, total: merged.size, failures: failures.length };
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
  const sourceBundle = String(order.product?.human_name ?? order.product ?? detail?.product?.human_name ?? detail?.product ?? order.name ?? '').trim();
  const purchasedAt = order.created ?? order.created_at ?? order.purchase_date ?? null;
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

function hasBookDownload(product) {
  // Humble's responses have changed shape over time. Looking only within each
  // product avoids treating a bundle name as a book, while accepting the PDF,
  // EPUB, CBZ, CBR, and MOBI variants used across Humble book bundles.
  const serialized = JSON.stringify(product);
  return /\.(?:pdf|epub|cbz|cbr|mobi)(?:["?\\]|$)/iu.test(serialized)
    || /"(?:format|filetype|extension)"\s*:\s*"(?:pdf|epub|cbz|cbr|mobi)"/iu.test(serialized);
}
