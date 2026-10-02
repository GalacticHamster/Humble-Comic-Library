import { wireStore } from './store-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadExtension() {
  const context = {
    Blob,
    URL,
    clearTimeout,
    console,
    document: { title: '' },
    location: { pathname: '/' },
    performance: { now: () => 0 },
    Promise,
    setTimeout
  };
  context.globalThis = context;
  vm.createContext(context);
  for (const file of ['shared.js', 'collection-mappings.js', 'ownership.js', 'content.js']) {
    vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context, { filename: file });
  }
  return context;
}

const extension = loadExtension();
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

function run(expression, values = {}) {
  extension.__softwareTestValues = values;
  return JSON.parse(JSON.stringify(vm.runInContext(`(() => ${expression})()`, extension)));
}

async function runAsync(expression, values = {}) {
  extension.__softwareTestValues = values;
  const result = await vm.runInContext(`(async () => ${expression})()`, extension);
  return JSON.parse(JSON.stringify(result));
}

function productKind(product) {
  return run('productKind(__softwareTestValues.product)', { product });
}

function classifySoftware(title, ownedTitles) {
  const libraryByKey = new Map(ownedTitles.map((ownedTitle) => [extension.HumbleComicLibrary.titleKey(ownedTitle), { title: ownedTitle }]));
  return run(`{
    const { title, libraryByKey } = __softwareTestValues;
    const records = [...libraryByKey.values()].map(item => ({ ...item, kind: 'software' }));
    const match = classifyLocalBundleItem({ title, lookupTitle: title, kind: 'software' }, createBundleLibraryMatcher(records, 'software'));
    const record = Array.isArray(match.item) ? match.item[0] : match.item;
    return { state: match.state, ...(record ? { item: record.title } : {}), ...(match.possibleReason ? { reason: match.possibleReason } : {}) };
  }`, { title, libraryByKey });
}

// These product records are synthetic. The repository has no sanitized Humble
// Software purchase fixtures, so they verify only the explicit metadata rules.
test('positive Humble metadata keeps books, games, and software distinct', () => {
  assert.equal(productKind({ human_name: 'Ebook', downloads: [{ url: 'https://example.invalid/book.epub' }] }), 'book');
  assert.equal(productKind({ human_name: 'Game', product_type: 'game', platform: 'steam' }), 'game');
  assert.equal(productKind({ human_name: 'Asset Pack', product_type: 'software', downloads: [{ url: 'https://example.invalid/asset.unitypackage' }] }), 'software');
  assert.equal(productKind({ human_name: 'GameMaker Source Project', platform: 'windows', downloads: [{ url: 'https://example.invalid/project.gmz' }] }), 'software');
});

test('an unknown archive is not silently imported as software', () => {
  assert.equal(productKind({ human_name: 'Unknown Archive', downloads: [{ url: 'https://example.invalid/unknown.zip' }] }), null);
});

test('mixed purchase records retain their distinct kinds and provenance', () => {
  const detail = {
    subproducts: [
      { human_name: 'Ebook', downloads: [{ url: 'https://example.invalid/book.pdf' }] },
      { human_name: 'Game', category: 'game', platform: 'steam' },
      { human_name: 'Asset Pack', content_type: 'software', downloads: [{ url: 'https://example.invalid/asset.zip' }] },
      { human_name: 'Unknown Archive', downloads: [{ url: 'https://example.invalid/unknown.zip' }] }
    ]
  };
  const items = run('extractLibraryItems(__softwareTestValues.detail, __softwareTestValues.order, "purchase-key")', {
    detail,
    order: { product: { human_name: 'Mixed Humble Bundle' } }
  });
  assert.deepEqual(items.map((item) => [item.title, item.kind, item.source, item.sourceBundle]), [
    ['Ebook', 'book', 'humble', 'Mixed Humble Bundle'],
    ['Game', 'game', 'humble', 'Mixed Humble Bundle'],
    ['Asset Pack', 'software', 'humble', 'Mixed Humble Bundle']
  ]);
});

test('exact owned titles count distinct Humble purchases from provenance', () => {
  const duplicateMatch = {
    state: 'owned',
    item: {
      title: 'Example Book',
      provenance: [
        { title: 'Example Book', purchaseKey: 'order-one', sourceBundle: 'First Bundle' },
        { title: 'Example Book', purchaseKey: 'order-two', sourceBundle: 'Second Bundle' },
        { title: 'Example Book', purchaseKey: 'order-one', sourceBundle: 'First Bundle' }
      ]
    }
  };
  assert.equal(run('matchPurchaseCount(__softwareTestValues.match)', { match: duplicateMatch }), 2);
  assert.match(run('matchProvenance(__softwareTestValues.match)', { match: duplicateMatch }), /2 Humble purchases/u);
  assert.equal(run('matchPurchaseCount(__softwareTestValues.match)', {
    match: { state: 'owned', item: { title: 'Imported without a Humble order' } }
  }), 0);
  assert.equal(run('matchPurchaseCount(__softwareTestValues.match)', {
    match: { state: 'owned', item: duplicateMatch.item, range: { complete: true, items: [duplicateMatch.item] } }
  }), 0);
  assert.equal(run('matchPurchaseCount(__softwareTestValues.match)', {
    match: { state: 'possible', item: duplicateMatch.item }
  }), 0);
});

test('software exact titles are owned while explicit version differences are possible', () => {
  assert.deepEqual(classifySoftware('Forest Builder Pro 2026', ['Forest Builder Pro 2026']), { state: 'owned', item: 'Forest Builder Pro 2026' });
  for (const [owned, bundle] of [
    ['Forest Builder Pro 2025', 'Forest Builder Pro 2026'],
    ['Forest Builder Pro v2', 'Forest Builder Pro v3'],
    ['Forest Builder Pro', 'Forest Builder Pro v2'],
    ['Forest Builder Pro Version 2.1', 'Forest Builder Pro Version 3.0']
  ]) {
    const result = classifySoftware(bundle, [owned]);
    assert.equal(result.state, 'possible', `${owned} -> ${bundle}`);
    assert.match(result.reason, /version/u, `${owned} -> ${bundle}`);
  }
});

test('short software titles do not become possible solely through version labels', () => {
  assert.deepEqual(classifySoftware('It v3', ['It v2']), { state: 'new' });
});

test('backup import keeps a recognized software kind and legacy book rows compatible', () => {
  const normalize = (item) => JSON.parse(JSON.stringify(extension.HumbleComicLibrary.normalizeLibraryImportItem(item)));
  assert.deepEqual(normalize({ title: 'Forest Builder Pro', kind: 'software', sourceBundle: 'Asset Bundle' }), {
    title: 'Forest Builder Pro', kind: 'software', sourceBundle: 'Asset Bundle'
  });
  assert.deepEqual(normalize('Legacy Book'), { title: 'Legacy Book', sourceBundle: '' });
  assert.deepEqual(normalize({ title: 'Unknown', kind: 'mystery' }), { title: 'Unknown', sourceBundle: '' });
});

test('tier new-item arithmetic is shared by software and other supported kinds', () => {
  assert.equal(run('confirmedNewItemCount(__softwareTestValues.tier)', {
    tier: { total: 5, owned: 2, elsewhere: 0, partial: 1, possible: 1 }
  }), 1);
});

test('Software discovery reports only safe classification signals, not URLs or secrets', () => {
  const product = {
    human_name: 'Forest Builder Pro',
    product_type: 'software',
    platform: 'windows',
    download_url: 'https://downloads.example.invalid/forest-builder.unitypackage?token=secret-value',
    redemption_key: 'secret-value'
  };
  const record = run('softwareDiscoveryRecord(__softwareTestValues.product, "Asset Bundle", productKind(__softwareTestValues.product), "direct-product")', { product });
  assert.deepEqual(record, {
    title: 'Forest Builder Pro',
    sourceBundle: 'Asset Bundle',
    recordSource: 'direct-product',
    currentClassification: 'software',
    declaredTypes: ['software'],
    platforms: ['windows'],
    fileExtensions: ['unitypackage'],
    topLevelFields: ['download_url', 'human_name', 'platform', 'product_type']
  });
  assert.doesNotMatch(JSON.stringify(record), /https:|secret-value|redemption_key/u);
});

test('Software discovery covers non-secret third-party entitlement metadata', () => {
  const detail = {
    tpkd_dict: {
      all_tpks: [{ human_name: 'PyCharm Subscription', key_type_human_name: 'JetBrains', key_type: 'jetbrains', key_val: 'secret-value' }]
    }
  };
  const records = run(`thirdPartyKeyRecords(__softwareTestValues.detail)
    .map(({ record }) => softwareDiscoveryRecord(record, 'Software Bundle', thirdPartyEntitlementKind(record, 'Software Bundle'), 'third-party-entitlement'))`, { detail });
  assert.deepEqual(records, [{
    title: 'PyCharm Subscription',
    sourceBundle: 'Software Bundle',
    recordSource: 'third-party-entitlement',
    currentClassification: 'software',
    declaredTypes: ['jetbrains'],
    platforms: [],
    fileExtensions: [],
    topLevelFields: ['human_name', 'key_type', 'key_type_human_name']
  }]);
  assert.doesNotMatch(JSON.stringify(records), /secret-value|key_val/u);
});

test('key-reminder discovery continues after fetch failures and reports safe aggregate counts', async () => {
  // Use an isolated context so this read-only diagnostic cannot rely on the
  // reminder scanner's globals or accidentally write scan state.
  for (const failedKeys of [[], ['private-order-one', 'private-order-two'], ['private-order-one', 'private-order-two', 'private-order-three']]) {
    const discovery = loadExtension();
    const keys = ['private-order-one', 'private-order-two', 'private-order-three'];
    const requests = [];
    discovery.setTimeout = (callback) => { callback(); return 0; };
    discovery.fetch = async (url) => {
      if (url === '/api/v1/user/order?all=true') {
        return { ok: true, json: async () => keys.map((gamekey) => ({ gamekey, product: { human_name: 'Private Bundle' } })) };
      }
      const key = decodeURIComponent(url.match(/\/order\/([^?]+)/u)[1]);
      requests.push(key);
      if (failedKeys.includes(key)) throw new Error(`Fetch failed for ${key}: secret-error-value`);
      return { ok: true, status: 200, text: async () => JSON.stringify({
        tpkd_dict: { all_tpks: [{ human_name: 'Private Product', key_type: 'steam', redeemed_key_val: 'secret-key-value' }] }
      }) };
    };
    const result = plainDiscoveryResult(await vm.runInContext('discoverKeyReminderMetadata(() => {})', discovery));
    const successes = keys.length - failedKeys.length;
    assert.deepEqual(requests, keys, 'all purchases are attempted, including those after a failure');
    assert.equal(result.scannedPurchases, keys.length);
    assert.equal(result.failures, failedKeys.length);
    assert.equal(result.report.purchasesScanned, keys.length);
    assert.equal(result.report.purchasesFailed, failedKeys.length);
    assert.equal(result.keyRecords, successes);
    assert.equal(result.report.thirdPartyKeyRecords, successes);
    assert.deepEqual(result.report.recordContainers, successes ? { 'tpkd_dict.all_tpks': successes } : {});
    if (successes) {
      assert.equal(result.report.fields.human_name.present, successes);
      assert.equal(result.report.redactedKeyValueFields.redeemed_key_val.values.redactedNonEmpty, successes);
    } else {
      assert.deepEqual(result.report.fields, {});
      assert.deepEqual(result.report.redactedKeyValueFields, {});
    }
    assert.doesNotMatch(JSON.stringify(result), /private-order|Private Bundle|Private Product|secret-error-value|secret-key-value/u);
  }
});

function plainDiscoveryResult(value) {
  return JSON.parse(JSON.stringify(value));
}

test('only explicitly labelled Software bundles reclassify generic third-party entitlements', () => {
  assert.equal(run('thirdPartyEntitlementKind(null, "Humble Software Bundle: Development Tools")'), 'software');
  assert.equal(run('thirdPartyEntitlementKind(null, "Humble GameMaker Bundle")'), 'game');
  assert.equal(run('thirdPartyEntitlementKind(null, "Humble Games Bundle")'), 'game');
});

test('Software bundle and catalogue URLs are covered by the extension manifest and page gate', () => {
  assert.ok(manifest.content_scripts[0].matches.includes('https://www.humblebundle.com/software*'));
  extension.location.pathname = '/software';
  assert.equal(run('isBundleCataloguePage()'), true);
});

test('purchase metadata discovery controls are hidden unless diagnostics are enabled', () => {
  const source = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');
  assert.match(source, /data-import-mode="software-discovery" data-hcl-debug-action hidden/u);
  assert.match(source, /data-import-mode="key-discovery" data-hcl-debug-action hidden/u);
  assert.match(source, /data-import-mode="purchase-navigation-discovery" data-hcl-debug-action hidden/u);
  assert.match(source, /chrome\.storage\.local\.get\(\{ showDiagnostics: false, keyReminderScan: null, humbleProfileLabel:'' \}\)/u);
  assert.doesNotMatch(source, /data-import-mode="key-reminders"/u);
});

test('purchase import shares detail requests with key reminders and requires an explicit full baseline', async () => {
  const orders = [
    { gamekey: 'old-purchase', product: { human_name: 'Old Bundle' }, created: '2026-01-01T00:00:00Z' },
    { gamekey: 'new-purchase', product: { human_name: 'New Bundle' }, created: '2026-02-01T00:00:00Z' }
  ];
  const details = Object.fromEntries(orders.map((order) => [order.gamekey, {
    tpkd_dict: {
      all_tpks: [{
        human_name: `${order.product.human_name} entitlement`,
        machine_name: `${order.gamekey}-entitlement`,
        keyindex: 0,
        key_type: 'steam',
        num_days_until_expired: 45
      }]
    }
  }]));
  const storage = {
    libraryItems: [],
    purchaseSummaries: [{ purchaseKey: 'old-purchase', pricePaid: null }],
    mediaImportVersion: 7,
    keyReminders: [],
    keyReminderScan: null
  };
  const requests = [];
  extension.chrome = {
    storage: {
      local: {
        get: async (defaults) => ({ ...defaults, ...storage }),
        set: async (values) => { Object.assign(storage, JSON.parse(JSON.stringify(values))); }
      }
    }
  };
  extension.fetch = async (url) => {
    if (url === '/api/v1/user/order?all=true') return { ok: true, json: async () => orders };
    const key = decodeURIComponent(url.match(/\/order\/([^?]+)/u)[1]);
    requests.push(key);
    return { ok: true, status: 200, text: async () => JSON.stringify(details[key]) };
  };
  extension.setTimeout = (callback) => { callback(); return 0; };

  wireStore(extension);storage.humbleProfileLabel='fixture';
  const incremental = await runAsync('importPurchases(() => {}, { fullRescan: false, profileLabel:"fixture", confirmed:true })');
  assert.deepEqual(requests, ['new-purchase'], 'new import fetches a purchase detail once for both title import and reminders');
  assert.equal(incremental.keyReminders.complete, false);
  assert.deepEqual(storage.keyReminders.map((record) => record.purchaseKey), ['new-purchase']);
  assert.deepEqual(storage.keyReminderScan.baselinePurchaseKeys, []);

  requests.length = 0;
  const full = await runAsync('importPurchases(() => {}, { fullRescan: true, profileLabel:"fixture", confirmed:true })');
  assert.deepEqual(requests.sort(), ['new-purchase', 'old-purchase'], 'full rescan fetches each purchase detail once');
  assert.equal(full.keyReminders.complete, true);
  assert.deepEqual(new Set(storage.keyReminderScan.baselinePurchaseKeys), new Set(['old-purchase', 'new-purchase']));
  assert.deepEqual(new Set(storage.keyReminders.map((record) => record.purchaseKey)), new Set(['old-purchase', 'new-purchase']));

  requests.length = 0;
  await runAsync('importPurchases(() => {}, { fullRescan: false, profileLabel:"fixture", confirmed:true })');
  assert.deepEqual(requests.sort(), ['new-purchase', 'old-purchase'], 'later imports refresh known pending reminders without a second title-import pass');
});

test('purchase-focus lookup accepts exact Humble order links and data attributes without constructing a purchase URL', () => {
  const link = { getAttribute: (name) => name === 'href' ? '/home/purchases?key=order-a' : null };
  extension.document = {
    querySelectorAll: (selector) => selector === 'a[href]' ? [link] : []
  };
  extension.location = { href: 'https://www.humblebundle.com/home/purchases', origin: 'https://www.humblebundle.com', pathname: '/home/purchases' };
  assert.equal(run('findPurchaseFocusTarget("order-a") === __softwareTestValues.link', { link }), true);
  assert.equal(run('safePurchaseLinkDestination(__softwareTestValues.link)', { link }), 'https://www.humblebundle.com/home/purchases?key=order-a');
  assert.equal(run('findPurchaseFocusTarget("other-order") === null'), true);

  const externalLink = { getAttribute: () => 'https://example.invalid/purchase' };
  assert.equal(run('safePurchaseLinkDestination(__softwareTestValues.externalLink)', { externalLink }), null);

  const element = {
    getAttribute: (name) => name === 'data-purchase-key' ? 'order-b' : null
  };
  extension.document = {
    querySelectorAll: (selector) => selector === 'a[href]' ? [] : [element]
  };
  assert.equal(run('findPurchaseFocusTarget("order-b") === __softwareTestValues.element', { element }), true);

  const humbleCard = {
    getAttribute: (name) => name === 'data-hb-gamekey' ? 'order-c' : null
  };
  extension.document = {
    querySelectorAll: (selector) => selector === 'a[href]' ? [] : [humbleCard]
  };
  assert.equal(run('findPurchaseFocusTarget("order-c") === __softwareTestValues.humbleCard', { humbleCard }), true);

  const sourceLink = {
    textContent: 'Example Bundle — purchased January 1, 2026',
    getAttribute: () => '/home/purchases'
  };
  extension.document = {
    querySelectorAll: (selector) => selector === 'a[href]' ? [sourceLink] : []
  };
  assert.equal(run('findPurchaseFocusTarget("missing-order", { sourceBundle: "Example Bundle" }) === __softwareTestValues.sourceLink', { sourceLink }), true);

  const source = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');
  assert.match(source, /hclPurchaseFocus/u);
  assert.doesNotMatch(source, /home\/purchases\?key=/u);
});

test('purchase-navigation diagnostic reports structure without exposing link values or page text', () => {
  const anchor = {
    tagName: 'A',
    attributes: [{ name: 'href' }, { name: 'data-order-key' }],
    getAttribute: (name) => name === 'href' ? '/home/purchases?key=sensitive-purchase-value' : null
  };
  const candidate = {
    tagName: 'DIV',
    attributes: [{ name: 'data-purchase-key' }, { name: 'class' }]
  };
  const button = {
    tagName: 'BUTTON',
    attributes: [{ name: 'type' }, { name: 'class' }]
  };
  extension.document = {
    querySelectorAll: (selector) => {
      if (selector === 'a[href]') return [anchor];
      if (selector === '*') return [anchor, candidate, button];
      if (selector === 'button, [role="button"]') return [button];
      return [];
    }
  };
  extension.location = { href: 'https://www.humblebundle.com/home/purchases', origin: 'https://www.humblebundle.com', pathname: '/home/purchases' };
  const diagnostic = run('inspectPurchaseNavigation()');
  assert.equal(diagnostic.anchorCount, 1);
  assert.equal(diagnostic.candidateCount, 2);
  assert.doesNotMatch(JSON.stringify(diagnostic.report), /sensitive-purchase-value/u);
  assert.doesNotMatch(JSON.stringify(diagnostic.report), /home\/purchases\?key/u);
  assert.match(JSON.stringify(diagnostic.report), /data-order-key/u);
  assert.match(JSON.stringify(diagnostic.report), /data-purchase-key/u);
});

test('direct Humble order links remain an explicit opt-in with a visible URL/history warning', () => {
  const optionsSource = fs.readFileSync(new URL('../options.js', import.meta.url), 'utf8');
  const optionsHtml = fs.readFileSync(new URL('../options.html', import.meta.url), 'utf8');
  assert.match(optionsSource, /openDirectPurchaseLinks/u);
  assert.match(optionsSource, /if \(directPurchaseLinksEnabled\)/u);
  assert.match(optionsSource, /https:\/\/www\.humblebundle\.com\/downloads\?key=/u);
  assert.match(optionsHtml, /Open direct Humble order links/u);
  assert.match(optionsHtml, /purchase identifier appears in the Humble URL and browser history/u);
});
