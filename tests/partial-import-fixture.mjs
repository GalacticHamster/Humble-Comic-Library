import { wireStore } from './store-fixture.mjs';
import fs from 'node:fs';
import vm from 'node:vm';

const plain = (value) => JSON.parse(JSON.stringify(value));
export const order = (key) => ({ gamekey: key, product: { human_name: `Bundle ${key}` } });
export const bookDetail = (title) => ({ subproducts: [{ human_name: title, downloads: [{ url: 'https://example.invalid/book.pdf' }] }] });
const item = (title, kind = 'book', purchaseKey = 'old') => ({
  title, kind, source: 'humble', purchaseKey, sourceBundle: `Bundle ${purchaseKey}`,
  provenance: [{ title, purchaseKey, sourceBundle: `Bundle ${purchaseKey}` }]
});

export function importer(initial, orders, details, failures = [], onSet = null) {
  const stored = {humbleProfileLabel:'fixture',profileArchives:[],...structuredClone(initial)};
  const requests = [];
  const writes = [];
  const messages = [];
  const context = {
    reportImport: (message) => messages.push(message),
    Blob, URL, clearTimeout, console, document: { title: '' }, location: { pathname: '/' },
    performance: { now: () => 0 }, Promise, setTimeout: (callback) => { callback(); return 0; },
    chrome: { storage: { local: {
      get: async (defaults) => ({ ...structuredClone(defaults), ...structuredClone(stored) }),
      set: async (values) => { if(onSet)await onSet(values,stored); if(Object.hasOwn(values,'libraryItems'))writes.push(plain(values)); Object.assign(stored, plain(values)); }
    } } },
    fetch: async (url) => {
      if (url === '/api/v1/user/order?all=true') return { ok: true, json: async () => orders };
      const key = decodeURIComponent(url.match(/\/order\/([^?]+)/u)[1]);
      requests.push(key);
      if (failures.includes(key)) throw new Error('Fetch failed');
      return { ok: true, status: 200, text: async () => JSON.stringify(details[key]) };
    }
  };
  wireStore(context);
  context.globalThis = context;
  vm.createContext(context);
  for (const file of ['shared.js', 'collection-mappings.js', 'ownership.js', 'content.js']) {
    vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context, { filename: file });
  }
  return { stored, requests, writes, messages, context,
    summary: (result) => { context.importResult = result; return vm.runInContext('purchaseImportScope(importResult)', context); },
    scan: async (full = true, options = {}) => { context.scanOptions={fullRescan:full,profileLabel:'fixture',confirmed:true,...options};return plain(await vm.runInContext(`importPurchases(reportImport, scanOptions)`, context)); } };
}

export function initialState() {
  return {
    libraryItems: [item('Old Book'), item('Old Game', 'game'), item('Old Software', 'software'), item('Old Audio', 'audiobook'), { title: 'Manual book' }],
    purchaseSummaries: [{ purchaseKey: 'old', importVersion:9, sourceBundle: 'Old Bundle', itemCount: 4, pricePaid: 8 }],
    mediaImportVersion: 9,
    keyReminders: [{ id: 'old-reminder', purchaseKey: 'old', title: 'Old Game', status: 'unrevealed' }],
    keyReminderScan: { complete: true, purchaseKeys: ['old'], baselinePurchaseKeys: ['old'] },
    customCollectionMappings: [{ id: 'keep-this-rule' }]
  };
}
