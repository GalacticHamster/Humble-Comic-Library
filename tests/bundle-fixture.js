const fixtureUnit = number => ({ series: 'Manga', run: '2000', unitType: 'volume', number: String(number), language: 'en', completeness: 'full' });
const fixtureMapping = (collectionTitle, to) => ({ id: collectionTitle, collectionTitle, verified: true, verifiedAt: '2026-10-01T12:00:00Z', contentsComplete: true, language: 'en', sourceLabel: 'Publisher', sourceUrl: 'https://publisher.example/contents', contains: [{ series: 'Manga', run: '2000', unitType: 'volume', from: 1, to }] });
window.fixtureStored = { libraryItems: [{ title: 'Owned collection', kind: 'book', sourceBundle: 'Previous bundle' }], purchaseSummaries: [],
  customCollectionMappings: [fixtureMapping('Owned collection', 1), fixtureMapping('Offered collection', 4), fixtureMapping('Overlapping collection', 4)],
  galacticLibraryExtensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', wishlistItems: [{ title: 'Wishlist book', kind: 'book', weight: 3 }] };
fixtureStored.bundleSummaryPreferences=JSON.parse(sessionStorage.getItem('fixture-summary')||'null')||{};
window.fixtureCalls = []; window.fixtureReviewCalls = [];
const fixtureStorageListeners = [];
window.chrome = { storage: { onChanged: { addListener: listener => fixtureStorageListeners.push(listener) }, local: {
  get: async defaults => structuredClone({...defaults,...Object.fromEntries(Object.keys(defaults).filter(key=>key in fixtureStored).map(key=>[key,fixtureStored[key]]))}),
  set: async value => {
    Object.assign(fixtureStored, structuredClone(value));
    if(value.bundleSummaryPreferences)sessionStorage.setItem('fixture-summary',JSON.stringify(value.bundleSummaryPreferences));
    const changes = Object.fromEntries(Object.entries(value).map(([key, newValue]) => [key, { newValue }]));
    fixtureStorageListeners.forEach(listener => listener(changes, 'local'));
  }
} }, runtime: { sendMessage: async (id, request) => {
  if(id?.type==='HCL_STORE'){
    window.fixtureStore??=HumbleComicLibrary.createSyncStore(chrome.storage.local);
    try{return {ok:true,result:await fixtureStore.execute(id.operation,id.args)};}catch(error){return {ok:false,error:error.message};}
  }
  if (typeof id === 'object') { fixtureReviewCalls.push(id); return { ok: true }; }
  fixtureCalls.push(request);
  if(window.fixtureCentralDelayMs)await new Promise(resolve=>setTimeout(resolve,window.fixtureCentralDelayMs));
  if(window.fixtureCentralFailure)throw Error('Synthetic delayed central failure');
  return { ok: true, apiVersion: 1, results: request.items.map(item => {
    const record = { provider: 'kindle', itemRef: 'opaque', title: 'GL collection', ownership: 'owned', relationship: 'contains', reason: 'Reviewed publisher contents', evidence: { source: 'manual-review', checkedAt: '2026-10-01', language: 'en' }, verifiedAt: '2026-10-01' };
    return { requestId: item.requestId, matches: [], partialMatches: item.contents?.length ? [record] : [],
      possibleMatches: item.title.startsWith('Dune') ? [{ ...record, title: 'Dune, 1st Edition', relationship: 'same-work', reason: 'Different editions', evidence: { isbn: ['9780140328721'], edition: '1st edition' } },{...record,itemRef:'opaque-third-edition',title:'Dune, 3rd Edition',relationship:'same-work',reason:'Different editions',evidence:{edition:'3rd edition'}}] : [],
      coverage: item.contents?.length ? { covered: [2, 4].map(number => ({ ...fixtureUnit(number), evidence: [record] })), possibleCovered: [] } : null };
  }) };
} } };
