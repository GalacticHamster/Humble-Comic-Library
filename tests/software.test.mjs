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
  for (const file of ['shared.js', 'collection-mappings.js', 'content.js']) {
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

function productKind(product) {
  return run('productKind(__softwareTestValues.product)', { product });
}

function classifySoftware(title, ownedTitles) {
  const libraryByKey = new Map(ownedTitles.map((ownedTitle) => [extension.HumbleComicLibrary.titleKey(ownedTitle), { title: ownedTitle }]));
  return run(`{
    const { title, libraryByKey } = __softwareTestValues;
    const libraryMatcher = createLibraryMatcher(libraryByKey, 'software');
    const exact = libraryByKey.get(HumbleComicLibrary.titleKey(title));
    const possible = exact ? null : findPossibleMatch(title, libraryMatcher, 'software');
    return exact ? { state: 'owned', item: exact.title } : possible ? { state: 'possible', item: possible.items.title, reason: possible.reason } : { state: 'new' };
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
  assert.match(source, /chrome\.storage\.local\.get\(\{ showDiagnostics: false \}\)/u);
});
