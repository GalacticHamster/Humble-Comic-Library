import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {wireStore} from './store-fixture.mjs';
const plain=value=>JSON.parse(JSON.stringify(value));
const CURRENT=9;
function fixture(initial={}) {
 const state={humbleProfileLabel:'Personal',...structuredClone(initial)},requests=[];let failing=[],quota=false;
 const context={Blob,URL,console,clearTimeout,Promise,setTimeout:fn=>{fn();return 0;},performance:{now:()=>0},document:{title:''},location:{pathname:'/'},chrome:{storage:{local:{get:async defaults=>structuredClone({...defaults,...state}),set:async updates=>{if(quota&&updates.libraryItems)throw Error('Storage quota');Object.assign(state,plain(updates));}}}}};
 context.globalThis=context;wireStore(context);vm.createContext(context);
 for(const file of ['shared.js','collection-mappings.js','ownership.js','content.js'])vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),context,{filename:file});
 return {state,context,requests,setFailures:values=>{failing=values;},setQuota:value=>{quota=value;},async scan(details,listed=Object.keys(details)){
  context.fetch=async url=>{if(url==='/api/v1/user/order?all=true')return {ok:true,json:async()=>listed.map(gamekey=>({gamekey}))};const key=decodeURIComponent(url.match(/\/order\/([^?]+)/u)[1]);requests.push(key);if(failing.includes(key))throw Error('Failed purchase');return {ok:true,text:async()=>JSON.stringify(details[key])};};
  return plain(await vm.runInContext("importPurchases(()=>{},{profileLabel:'Personal',confirmed:true})",context));
 }};
}
const book=(title,id,extra={})=>({human_name:title,machine_name:id,downloads:[{format:'epub'},{format:'pdf'}],authors:['Creator'],publisher:'Publisher',...extra});
const sources={a:{product:{human_name:'Humble Comics Bundle'},created:'2020-01-01T00:00:00Z',subproducts:[book('Comic Volume 1','comic',{isbn:['9780306406157']})]},b:{product:{human_name:'Humble Software Bundle'},created:'2021-01-01T00:00:00Z',subproducts:[book('Reference Book','book'),{human_name:'Audio Book',machine_name:'audio',downloads:[{format:'mp3'}]},{human_name:'Film',machine_name:'film',downloads:[{format:'mp4'}]}],all_tpks:[{human_name:'Software Tool',machine_name:'tool',keyindex:0,key_type:'software',redeemed_key_val:'SYNTHETIC_REVEALED'}]}};
// Public 0e7bffe: title/source/bundle/purchase/date, no kind, summaries or IDs.
// 71becac adds purchase summaries and game records; 2d4195c adds audio (v4),
// 88ea094 software (v6), b1736df key evidence (v7). Earlier versions share v1 defaults.
function legacy(version) {
 const items=[{title:'Comic Volume 1',source:'humble',sourceBundle:'Humble Comics Bundle',purchaseKey:'a',purchasedAt:'2020-01-01T00:00:00.000Z'}, {title:'Software Tool',kind:'game',source:'humble',sourceBundle:'Humble Software Bundle',purchaseKey:'b',purchasedAt:'2021-01-01T00:00:00.000Z'}];
 if(version>=4)items.push({title:'Audio Book',kind:'audiobook',source:'humble',purchaseKey:'b'});
 return {libraryItems:items,...(version===undefined?{}:{mediaImportVersion:version,purchaseSummaries:[{purchaseKey:'a'},{purchaseKey:'b'}]})};
}
const metadata=items=>items.map(item=>({title:item.title,kind:item.kind,authors:item.authors,isbn:item.isbn,publisher:item.publisher,formats:item.formats,origins:(item.provenance??[item]).map(p=>({title:p.title,purchaseKey:p.purchaseKey,providerItemId:p.providerItemId,entitlement:p.entitlement,entitlementId:p.entitlementId,formats:p.formats})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})).sort((a,b)=>a.title.localeCompare(b.title));
for(const version of [undefined,1,2,3,4,5,6,7,8])test(`legacy ${version??'unversioned public release'} upgrades directly to fresh-import metadata and then skips`,async()=>{
 const fresh=fixture();await fresh.scan(sources);
 const h=fixture(legacy(version));await h.scan(sources);
 assert.deepEqual(metadata(h.state.libraryItems),metadata(fresh.state.libraryItems));
 assert.equal(h.state.mediaImportVersion,CURRENT);assert(h.state.purchaseSummaries.every(p=>p.importVersion===CURRENT));
 assert.equal(h.state.libraryItems.length,fresh.state.libraryItems.length);
 const before=metadata(h.state.libraryItems);h.requests.length=0;await h.scan(sources);assert.deepEqual(h.requests,[]);assert.deepEqual(metadata(h.state.libraryItems),before);
 const restored=h.context.HumbleComicLibrary.restoreBackupState(h.context.HumbleComicLibrary.createLibraryBackup(h.state));assert.deepEqual(metadata(plain(restored.libraryItems)),before);
});

test('unnamed public database upgrades additively after confirmation and can retain successful purchases on a partial failure',async()=>{
 const h=fixture({...legacy(undefined),humbleProfileLabel:''});h.setFailures(['b']);await h.scan(sources);
 assert.equal(h.state.humbleProfileLabel,'Personal');assert.equal(h.state.lastImport.fullRescan,false);assert.equal(h.state.purchaseSummaries[0].importVersion,CURRENT);assert(h.state.libraryItems.some(i=>i.title==='Software Tool'));h.setFailures([]);h.requests.length=0;await h.scan(sources);assert.deepEqual(h.requests,['b']);
});

test('historical-only orders are recovered without promoting retired purchases or losing original bundle/date facts',async()=>{
 const original={title:'Retired Book',kind:'book',source:'humble',purchaseKey:'retired',sourceBundle:'Original bundle',purchasedAt:'2010-01-01T00:00:00.000Z',formats:['.mobi']};
 const h=fixture({mediaImportVersion:8,libraryItems:[],historicalLibraryItems:[original],historicalPurchaseSummaries:[{purchaseKey:'retired',sourceBundle:'Original bundle',pricePaid:10}]});
 const details={retired:{subproducts:[book('Retired Book','old')]}};
 h.setFailures(['retired']);await h.scan(details,[]);assert.deepEqual(h.state.historicalLibraryItems,[original]);
 h.setFailures([]);await h.scan(details,[]);assert.equal(h.state.libraryItems.length,0);assert.equal(h.state.purchaseSummaries.length,0);const row=h.state.historicalLibraryItems[0];assert.equal(row.providerItemId,'retired:product:old');assert.equal(row.sourceBundle,'Original bundle');assert.equal(row.purchasedAt,original.purchasedAt);assert.deepEqual(row.formats,['.mobi']);
 h.requests.length=0;await h.scan(details,[]);assert.deepEqual(h.requests,[]);assert.equal(h.state.historicalPurchaseSummaries.length,1);assert.equal(h.state.historicalPurchaseSummaries[0].pricePaid,10);
});

test('legacy manual classification migrates to stable IDs and survives failed saves, reimports, backups and pairing state',async()=>{
 const prior=legacy(1),old=prior.libraryItems[0];old.kind='video';old.manualKind='video';
 const pairing={galacticLibraryExtensionId:'a'.repeat(32),galacticPurchaseAccountIds:{Personal:'account'},galacticPurchaseSync:{relationships:['fixture']}};
 const h=fixture({...prior,...pairing,mediaTypeOverrides:{'a:comic volume 1':'video'}});const before=metadata(h.state.libraryItems);h.setQuota(true);await assert.rejects(h.scan(sources),/quota/i);assert.deepEqual(metadata(h.state.libraryItems),before);assert.equal(h.state.mediaImportVersion,1);
 h.setQuota(false);await h.scan(sources);assert.equal(h.state.libraryItems.filter(i=>i.title===old.title).length,1);assert.equal(h.state.libraryItems.find(i=>i.title===old.title).manualKind,'video');assert.equal(h.state.mediaTypeOverrides['a:a:product:comic'],'video');for(const [key,value] of Object.entries(pairing))assert.deepEqual(h.state[key],value);
 h.requests.length=0;await h.scan(sources);assert.deepEqual(h.requests,[]);
});

test('distinct native products are retained and an ambiguous ID-less legacy row is never assigned an arbitrary identity',async()=>{
 const h=fixture({mediaImportVersion:1,libraryItems:[{title:'Same title',kind:'book',source:'humble',purchaseKey:'a'}],purchaseSummaries:[{purchaseKey:'a'}]});
 await h.scan({a:{subproducts:[book('Same title','first'),book('Same title','second')]}});
 const ids=h.state.libraryItems.flatMap(i=>i.provenance??[i]).map(p=>p.providerItemId).filter(Boolean);assert(ids.includes('a:product:first'));assert(ids.includes('a:product:second'));assert(h.state.libraryItems.flatMap(i=>i.provenance??[i]).some(p=>!p.providerItemId));
 h.requests.length=0;await h.scan({a:{subproducts:[book('Same title','first'),book('Same title','second')]}});assert.deepEqual(h.requests,[]);
});

test('known native identities gain missing bibliography without duplicate entries, and positional fallbacks upgrade only unambiguously',async()=>{
 const h=fixture({mediaImportVersion:8,libraryItems:[{...legacy(1).libraryItems[0],kind:'comic',providerItemId:'a:product:comic'},{title:'Reference Book',kind:'book',source:'humble',purchaseKey:'b',providerItemId:'b:product:position-0'}],purchaseSummaries:[{purchaseKey:'a',importVersion:8},{purchaseKey:'b',importVersion:8}]});await h.scan(sources);
 assert.equal(h.state.libraryItems.filter(i=>i.title==='Comic Volume 1').length,1);assert.deepEqual(h.state.libraryItems.find(i=>i.title==='Comic Volume 1').isbn,['9780306406157']);assert.equal(h.state.libraryItems.find(i=>i.title==='Reference Book').providerItemId,'b:product:book');
});


test('duplicate purchases retain every native observation without inflating repeated imports',async()=>{
 const old={title:'Repeated Book',kind:'book',source:'humble',provenance:[{title:'Repeated Book',purchaseKey:'a',sourceBundle:'First bundle'},{title:'Repeated Book',purchaseKey:'b',sourceBundle:'Second bundle'}]};
 const details={a:{subproducts:[book('Repeated Book','book')]},b:{subproducts:[book('Repeated Book','book')]}};
 const h=fixture({mediaImportVersion:1,libraryItems:[old],purchaseSummaries:[{purchaseKey:'a'},{purchaseKey:'b'}]});await h.scan(details);
 assert.equal(h.state.libraryItems.length,1);assert.equal(h.state.libraryItems[0].provenance.length,2);assert.deepEqual(h.state.libraryItems[0].provenance.map(p=>p.providerItemId),['a:product:book','b:product:book']);assert.deepEqual(h.state.libraryItems[0].provenance.map(p=>p.sourceBundle),['First bundle','Second bundle']);h.requests.length=0;await h.scan(details);assert.deepEqual(h.requests,[]);assert.equal(h.state.libraryItems[0].provenance.length,2);
});


test('a global current marker cannot hide an unstamped or mixed-version purchase added by restore or sync',async()=>{
 const h=fixture({...legacy(1),mediaImportVersion:CURRENT});await h.scan(sources);assert.deepEqual(h.requests,['a','b']);h.requests.length=0;
 h.state.purchaseSummaries.find(p=>p.purchaseKey==='b').importVersion=4;
 await h.scan(sources);assert.deepEqual(h.requests,['b']);assert(h.state.keyReminderScan.purchaseKeys.includes('b'));h.requests.length=0;await h.scan(sources);assert.deepEqual(h.requests,[]);
});
