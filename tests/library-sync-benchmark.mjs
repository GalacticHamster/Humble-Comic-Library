// Synthetic full-sync benchmark: legacy 5-row pages against the default 1,000-row pages.
// Network time is modelled from latencies measured live on November 12; pacing runs on a
// virtual clock. CPU time (parsing, validation, worker and storage) is measured for real.
// Run: node tests/library-sync-benchmark.mjs
import {fixture,row,child,frames} from './library-entitlements-fixture.mjs';

const LATENCY = { envelope: 1125, list5: 365, list1000: 986, list50: 358, parent: 483, asset: 108 };
const TOTAL = 8235, BUNDLES = 206, STORES = 20;
const parentOf = i => i < 40 ? 'parent-s' + (i % STORES) : i === 40 ? 'parent-w0' : 'parent-b' + (i % BUNDLES);
const rows = Array.from({length: TOTAL}, (_, i) => ({...row('id-' + i, 'Synthetic game ' + i, i % 19 === 0 ? 'steam' : 'download_drm_free'), productEntitlementId: parentOf(i)}));
const byParent = new Map();
for (const r of rows) { if (!byParent.has(r.productEntitlementId)) byParent.set(r.productEntitlementId, []); byParent.get(r.productEntitlementId).push(child(r.id, r.title, r.type)); }
const typeOf = p => p.startsWith('parent-s') ? 'storefront' : p.startsWith('parent-w') ? 'widget' : 'bundle';

async function run(label, settings) {
  const f = fixture({rows, children: [], groupIds: [...byParent.keys()].filter(p => typeOf(p) === 'bundle')});
  let clock = 0, pacing = 0, pauses = 0, network = 0;
  const counts = {}, latencies = [];
  const fetcher = async (path, init = {}) => {
    const kind = path.startsWith('/_next/') ? 'asset' : init.method === 'POST' ? 'list' + init.body.get('_1_limit') : path === '/home/library' ? 'envelope' : 'parent';
    counts[kind] = (counts[kind] ?? 0) + 1; const ms = LATENCY[kind] ?? LATENCY.list1000; clock += ms; network += ms; latencies.push(ms);
    if (kind !== 'parent') return f.fetcher(path, init);
    const parent = decodeURIComponent(path.split('/').at(-1)), children = byParent.get(parent);
    const body = frames([{name: 'AuthProvider', props: {user: {id: 'principal-A'}}}, {name: 'ProductKeysDownloads', props: {productEntitlementId: parent,
      userLibraryItem: {id: 'detail-' + parent, preOrder: false, type: typeOf(parent), entitlements: {keys: children.filter(c => c.type !== 'download_drm_free'), downloads: children.filter(c => c.type === 'download_drm_free'), redemptionGroups: []}}}}]);
    return {ok: true, status: 200, headers: {get: () => 'text/x-component'}, text: async () => body};
  };
  const config = f.E.syncSettings(settings);
  const sleep = async ms => { clock += ms; if (ms === config.batchDelayMs) pauses += ms; else pacing += ms; };
  const sync = f.E.createSync({fetcher, store: f.store, settings, sleep, now: () => clock});
  const started = performance.now();
  await sync.start({mode: 'full', context: await f.store('entitlementContext'), confirmed: true});
  const cpu = performance.now() - started, scope = f.stored.libraryEntitlements.scopes[0], cp = scope.sync;
  const requests = Object.values(counts).reduce((a, b) => a + b, 0), sorted = [...latencies].sort((a, b) => a - b);
  return { label, status: cp.status, coverage: cp.coverage, observations: scope.observations.length, batches: cp.batches, requests, byKind: counts,
    requestsPer1000Rows: +(requests / TOTAL * 1000).toFixed(1), latencyAvgMs: Math.round(network / requests), latencyP95Ms: sorted[Math.floor(sorted.length * 0.95)],
    networkMin: +(network / 60000).toFixed(1), pacingMin: +(pacing / 60000).toFixed(1), batchPauseMin: +(pauses / 60000).toFixed(1), cpuMin: +(cpu / 60000).toFixed(2),
    projectedMin: +((clock + cpu) / 60000).toFixed(1), storageWrites: f.writes.filter(w => w.libraryEntitlements).length };
}

const legacy = await run('legacy (5-row pages, 10 s batch pause)', { pageSize: 5, batchPages: 10, refreshPages: 6, batchDelayMs: 10000 });
const current = await run('default (1,000-row pages, 5 s batch pause)', {});
console.table([legacy, current].map(({byKind, ...r}) => r));
console.log(JSON.stringify({legacy: legacy.byKind, current: current.byKind}));
