import test from 'node:test';import assert from 'node:assert/strict';
import '../purchase-snapshot.js';import '../purchase-adapters.js';import '../shared.js';import '../collection-mappings.js';
const S=globalThis.GalacticPurchaseSnapshot,A=globalThis.GalacticPurchaseAdapters,H=globalThis.HumbleComicLibrary;
const row=(n=0,provider='fanatical')=>({providerItemId:provider==='fanatical'?'product_'+n:'purchase_'+n+':product:native_'+n,title:'Synthetic book '+n,mediaType:'book',metadata:provider==='fanatical'?{bundleId:'bundle_123',bundleTitle:'Synthetic bundle'}:{purchaseId:'purchase_'+n,sourceBundle:'Synthetic bundle'},purchasedAt:null,origins:[]});
const snapshot=(records=[row()],provider='fanatical')=>S.validate({protocolVersion:1,provider,snapshotId:'snapshot-control',accountRef:'source-profile',accountLabel:'Personal',capturedAt:'2026-10-09T12:00:00Z',scope:'historical',completeness:'partial',limitations:[],records});
function memory(values={}){return {values,sets:0,get:async defaults=>structuredClone({...defaults,...values}),async set(updates){this.sets++;Object.assign(values,structuredClone(updates));},remove:async()=>{}};}
for(const role of ['hb'])test(role+' real serialized importer: repeat/restart, overlap, richer fields and separate account',async()=>{
 const provider=role==='hb'?'humble':'fanatical',itemKey=role==='hb'?'libraryItems':'fanaticalLibraryItems',labelKey=role==='hb'?'humbleProfileLabel':'fanaticalProfileLabel',archivesKey=role==='hb'?'profileArchives':'fanaticalProfileArchives';
 const area=memory({[itemKey]:[],[labelKey]:'Personal',[archivesKey]:[]}),make=()=>role==='hb'?H.createSyncStore(area):createFanStore(area);let store=make();
 const ref=async()=>(await store.execute('handoffAccounts'))[0].accountRef;
 const data=snapshot([row(1,provider)],provider);
 assert.equal((await store.execute('handoffImport',[data,{accountRef:await ref()}])).added,1);
 const before=JSON.stringify(area.values),writes=area.sets;
 assert.equal((await store.execute('handoffImport',[data,{accountRef:await ref()}])).unchanged,1);assert.equal(JSON.stringify(area.values),before);assert.equal(area.sets,writes);
 store=make();assert.equal((await store.execute('handoffImport',[data,{accountRef:await ref()}])).unchanged,1);
 const overlap=snapshot([row(1,provider),row(2,provider)],provider);assert.equal((await store.execute('handoffImport',[{...overlap,scope:'incremental'},{accountRef:await ref()}])).added,1);assert.equal(area.values[itemKey].length,2);
 area.values[itemKey][0].publisher='Richer local publisher';const stale=await ref();
 const historical=snapshot([{...row(1,provider),metadata:{...row(1,provider).metadata,publisher:'Historical publisher'}}],provider);
 await store.execute('handoffImport',[historical,{accountRef:stale}]);assert.equal(area.values[itemKey][0].publisher,'Richer local publisher');
 assert.equal((await store.execute('handoffImport',[data,{newLabel:'Separate',expectedActiveLabel:'Personal'}])).added,1);assert.equal(area.values[labelKey],'Personal');assert.equal(area.values[archivesKey].length,1);
 await assert.rejects(store.execute('handoffImport',[data,{accountRef:'not-this-account'}]));assert.equal(area.values[itemKey].length,2);
 const freshRef=await ref();area.values[itemKey].push(role==='hb'?{title:'Native scan item',kind:'book',purchaseKey:'p-native'}:{source:'fanatical',sourceItemId:'native_123',title:'Native scan item',mediaType:'book'});
 await assert.rejects(store.execute('handoffImport',[data,{accountRef:freshRef}]),/changed/);
});
test('HB same-title distinct native products remain distinct; native identity wins over fallback',()=>{
 const data=[row(1,'humble'),{...row(1,'humble'),providerItemId:'purchase_1:product:different'}];
 const first=A.hbMerge([],data);assert.equal(first.items.length,2);
 const again=A.hbMerge(first.items,data);assert.equal(again.items.length,2);assert.equal(again.stats.unchanged,2);
});

test('Named legacy v9 account, restored older archive and empty/manual accounts are visible without native IDs',async()=>{
 const rows=Array.from({length:6321},(_,n)=>({kind:'book',title:'Legacy book '+n,source:'humble',purchaseKey:'legacy_'+Math.floor(n/20),sourceBundle:'Legacy bundle',purchasedAt:null,provenance:[{title:'Legacy book '+n,purchaseKey:'legacy_'+Math.floor(n/20),sourceBundle:'Legacy bundle',purchasedAt:null}]}));
 const archived=H.createLibraryBackup({...H.LIBRARY_STATE_DEFAULTS,humbleProfileLabel:'Old',libraryItems:[{title:'Manual book',kind:'book'}]});const state={humbleProfileLabel:'Personal',libraryItems:rows,profileArchives:[{profileLabel:'Old',backup:archived},{profileLabel:'Empty',backup:H.createLibraryBackup({...H.LIBRARY_STATE_DEFAULTS,humbleProfileLabel:'Empty'})}]};const area=memory(state),store=H.createSyncStore(area);const start=performance.now(),accounts=await store.execute('handoffAccounts');console.log(JSON.stringify({historicalHB:6321,enumerationMs:performance.now()-start}));assert.equal(accounts.length,3);assert.equal(accounts[0].count,6321);assert.equal(accounts[0].eligibleCount,6321);assert.match(accounts[0].limitations.join(' '),/6321 older saved items/);assert.equal(accounts[1].eligibleCount,0);assert.equal(accounts[2].count,0);const snapshot=await store.execute('handoffSnapshot',[accounts[0].accountRef]);assert(snapshot.records.every(row=>row.providerItemId===null));assert.equal(snapshot.records.length,6321);assert.equal(area.sets,0);
});


test('Read-only HB preview distinguishes new names from additional records and qualifies update counts',async()=>{
 const area=memory({libraryItems:[],humbleProfileLabel:'Personal',profileArchives:[]}),store=H.createSyncStore(area),ref=async()=>(await store.execute('handoffAccounts'))[0].accountRef;
 await store.execute('handoffImport',[snapshot([row(1,'humble')],'humble'),{accountRef:await ref()}]);
 const before=JSON.stringify(area.values),writes=area.sets;
 const unchanged=await store.execute('handoffPreview',[snapshot([row(1,'humble')],'humble'),{accountRef:await ref()}]);assert.equal(unchanged.newTitleNames,0);assert.equal(unchanged.additionalRecords,0);assert.equal(unchanged.unchanged,1);assert.equal(unchanged.updateBreakdownKnown,false);
 const extra=await store.execute('handoffPreview',[snapshot([{...row(1,'humble'),providerItemId:'purchase_1:product:second'},row(2,'humble')],'humble'),{accountRef:await ref()}]);assert.equal(extra.newTitleNames,1);assert.equal(extra.additionalRecords,1);assert.equal(extra.added,2);assert.equal(JSON.stringify(area.values),before);assert.equal(area.sets,writes);
});

test('one malformed saved Humble record is withheld from sharing instead of blocking the account',async()=>{
 const good=n=>({title:'Synthetic book '+n,kind:'book',source:'humble',providerItemId:`purchase_${n}:product:native_${n}`,purchaseKey:'purchase_'+n,entitlement:'direct-download',purchasedAt:'2026-01-'+String(n+1).padStart(2,'0')+'T12:00:00Z'});
 const valid=[good(1),good(2),{...good(3),kind:'comic'},{...good(4),kind:'unclassified'}];
 const malformed=[{...good(5),title:'Synthetic\u0008control'},{...good(6),title:'x'.repeat(501)},{...good(7),purchasedAt:'not a date'}];
 const snap=async items=>{const area=memory({libraryItems:items,humbleProfileLabel:'Personal',profileArchives:[]}),store=H.createSyncStore(area),before=structuredClone(area.values),[account]=await store.execute('handoffAccounts');const data=await store.execute('handoffSnapshot',[account.accountRef]);assert.deepEqual(area.values.libraryItems,before.libraryItems,'saved records unchanged');return data;};
 const clean=await snap(valid);
 for(const bad of malformed){
  const data=await snap([...valid.slice(0,2),bad,...valid.slice(2)]);
  assert.deepEqual(data.records,clean.records,bad.title.slice(0,20));
  assert(data.limitations.includes('1 saved record has details that cannot be shared and was left out; it remains saved here.'),JSON.stringify(data.limitations));
 }
 const all=await snap([...valid,...malformed]);assert.deepEqual(all.records,clean.records);assert(all.limitations.some(l=>l.startsWith('3 saved records have details')));
 const linked=await snap([...valid,{...good(8),detailUrl:'https://example.invalid/product'},{...good(9),detailUrl:'https://www.humblebundle.com/books/synthetic'}]);
 assert.equal(linked.records.length,clean.records.length+2,'a record with an unsafe optional link is still shared');
 assert.equal(linked.records.find(r=>r.providerItemId==='purchase_8:product:native_8').metadata.detailUrl,undefined);
 assert.equal(linked.records.find(r=>r.providerItemId==='purchase_9:product:native_9').metadata.detailUrl,'https://www.humblebundle.com/books/synthetic');
 assert(linked.limitations.includes('1 saved store link was not a Humble or Fanatical address and was left out; the purchase is still shared.'),JSON.stringify(linked.limitations));
 assert.deepEqual(Object.fromEntries(clean.records.map(r=>[r.providerItemId,r.mediaType])),{'purchase_1:product:native_1':'book','purchase_2:product:native_2':'book','purchase_3:product:native_3':'book','purchase_4:product:native_4':'other'});
 assert(!clean.limitations.some(l=>/cannot be shared/.test(l)));
});
