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
