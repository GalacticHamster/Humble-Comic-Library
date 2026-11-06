import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import {importer,order,bookDetail,initialState} from './partial-import-fixture.mjs';
import {fixture as badgeFixture} from './matching-fixture.mjs';

const keys=Array.from({length:500},(_,i)=>`order-${i}`);
const details=Object.fromEntries(keys.map(key=>[key,bookDetail(`Book ${key}`)]));
const plain=value=>JSON.parse(JSON.stringify(value));
const read=f=>plain(f.stored);
const call=(f,expression)=>vm.runInContext(expression,f.context);

test('first 499/500 commits useful purchases; reload and Quick retry only one; clean Full remains normal',async()=>{
  const failures=[keys[499]],f=importer({humbleProfileLabel:''},keys.map(order),details,failures);
  const result=await f.scan();assert.equal(f.stored.libraryItems.length,499);assert.equal(f.stored.purchaseSummaries.length,499);
  assert.equal(result.reconciled,false);assert.deepEqual(f.stored.lastImport.failedPurchaseKeys,failures);
  assert.match(f.summary(result),/Saved 499 purchases; 1 purchase couldn't be loaded/);assert.doesNotMatch(f.summary(result),/repeat a full/);
  const g=importer(read(f),keys.map(order),details);await g.scan(false);assert.deepEqual(g.requests,[keys[499]]);
  assert.equal(g.stored.libraryItems.length,500);assert.equal(g.stored.purchaseSummaries.length,500);assert.equal(g.stored.lastImport.reconciled,false);
  g.requests.length=0;await g.scan(false);assert.equal(g.requests.length,0);
  await g.scan();assert.equal(g.stored.lastImport.reconciled,true);assert.equal(g.stored.libraryItems.length,500);
});

test('clean 500 first import keeps all titles and normal status',async()=>{
  const f=importer({humbleProfileLabel:''},keys.map(order),details),result=await f.scan();
  assert.equal(result.total,500);assert.equal(f.requests.length,500);assert.equal(result.reconciled,true);assert.match(f.summary(result),/current snapshot reconciled/);
});

test('new declared profile partial atomically archives A; saved A restores without B evidence',async()=>{
  const initial={...initialState(),customCollectionMappings:[]},f=importer(initial,keys.map(order),details,[keys[499]]);
  await assert.rejects(f.scan(true,{profileLabel:'B'}),/explicitly/);
  await f.scan(true,{profileLabel:'B',switchProfile:true});assert.equal(f.stored.humbleProfileLabel,'B');
  assert.equal(f.stored.libraryItems.length,500);assert(!f.stored.libraryItems.some(x=>x.title==='Old Book'));
  assert.equal(f.stored.profileArchives[0].backup.items.length,5);
  await call(f,"HumbleComicLibrary.storageRequest('selectProfile',{profileLabel:'fixture',expectedActiveLabel:'B',confirmed:true})");
  assert.equal(f.stored.libraryItems.length,5);assert(f.stored.libraryItems.some(x=>x.title==='Old Book'));
  await call(f,"HumbleComicLibrary.storageRequest('selectProfile',{profileLabel:'B',expectedActiveLabel:'fixture',confirmed:true})");
  const g=importer(read(f),keys.map(order),details);await g.scan(false,{profileLabel:'B'});assert.equal(g.requests.length,1);
});

for(const status of [401,403])test(`explicit ${status} aborts without publishing purchases or profile`,async()=>{
  const f=importer({humbleProfileLabel:''},[order('good'),order('auth')],{good:bookDetail('Good')});
  const original=f.context.fetch;f.context.fetch=async url=>url.includes('/order/auth?')?{ok:false,status}:original(url);
  await assert.rejects(f.scan(),/login has expired/);assert.equal(f.writes.length,0);assert.equal(f.stored.humbleProfileLabel,'');
  assert.equal(f.stored.hclSyncControl,null);
});

test('explicit mismatched gamekey is isolated; optional absent identity still accepted',async()=>{
  const f=importer({humbleProfileLabel:''},[order('good'),order('bad')],{good:bookDetail('Good'),bad:{...bookDetail('Wrong'),gamekey:'different'}});
  await f.scan();assert.deepEqual(f.stored.libraryItems.map(x=>x.title),['Good']);assert.deepEqual(f.stored.lastImport.failedPurchaseKeys,['bad']);
});

test('valid empty succeeds; all-failed does not establish a profile or publish a checkpoint',async()=>{
  const empty=importer({humbleProfileLabel:''},[],{});await empty.scan();assert.equal(empty.stored.lastImport.reconciled,true);
  const f=importer({humbleProfileLabel:''},[order('bad')],{},['bad']);await assert.rejects(f.scan(),/No purchases could be loaded/);assert.equal(f.writes.length,0);
});

for(const message of ['Quota exceeded','Storage write rejected'])test(`partial new-profile ${message} preserves A and corrections`,async()=>{
  const initial={...initialState(),customCollectionMappings:[]},f=importer(initial,[order('good'),order('bad')],{good:bookDetail('Good')},['bad'],values=>{if(values.libraryItems)throw Error(message);});
  await assert.rejects(f.scan(true,{profileLabel:'B',switchProfile:true}),/quota|rejected/i);
  assert.equal(f.stored.humbleProfileLabel,'fixture');assert.deepEqual(f.stored.libraryItems,initial.libraryItems);assert.equal(f.stored.lastImport,undefined);assert.deepEqual(f.stored.profileArchives,[]);
});

test('mixed-media partial and clean imports give identical local matching and purchase evidence',async()=>{
  const mixed={subproducts:[{human_name:'Exact comic',downloads:[{url:'https://example.invalid/book.cbz'}]},{human_name:'Exact audio',downloads:[{url:'https://example.invalid/book.mp3'}]}],all_tpks:[{human_name:'Exact game',machine_name:'game',key_type:'steam',keyindex:0}]};
  const clean=importer({humbleProfileLabel:''},[order('good')],{good:mixed}),partial=importer({humbleProfileLabel:''},[order('good'),order('bad')],{good:mixed},['bad']);
  const stable=value=>JSON.parse(JSON.stringify(value,(key,value)=>key==='keyCheckedAt'?undefined:value));
  await clean.scan();await partial.scan();assert.deepEqual(stable(partial.stored.libraryItems),stable(clean.stored.libraryItems));
  assert(partial.stored.libraryItems.length>=3);
  for(const f of [clean,partial]){
    f.context.matchItems=f.stored.libraryItems;
    f.match=plain(await call(f,`matchItems.map(item=>{
      const match=classifyLocalBundleItem({title:item.title,lookupTitle:item.title,kind:item.kind},createBundleLibraryMatcher(matchItems,item.kind),HumbleCollectionMappings.builtIn);
      return {title:item.title,state:match.state};
    })`));
  }
  assert.deepEqual(partial.match,clean.match);
  assert(partial.match.every(item=>item.state==='owned'));
  for(const item of partial.stored.libraryItems){
    const labels=[];
    for(const imported of [clean,partial]){
      const fixture=badgeFixture(imported.stored.libraryItems,item.kind,{title:item.title});
      const {match}=await fixture.classify();labels.push(fixture.context.HumbleOwnership.presentation.status(fixture.context.offered,match));
    }
    assert.deepEqual(labels,[item.kind==='game'?'Purchased':'Owned',item.kind==='game'?'Purchased':'Owned']);
  }
});

test('validated first partial above 20 MiB commits, reloads and retries without repeating the large order',async()=>{
  const large= {subproducts:Array.from({length:14000},(_,i)=>({human_name:`Book ${i} ${'Long bibliographic title '.repeat(16)}`,machine_name:`large-${i}`,downloads:[{format:'EPUB',url:'https://example.invalid/book.epub'}]}))};
  const orders=[{gamekey:'large',product:{human_name:'Synthetic descriptive bundle '.repeat(14)}},order('bad')];
  const f=importer({humbleProfileLabel:''},orders,{large},['bad']);await f.scan();
  const bytes=Buffer.byteLength(JSON.stringify(f.stored));assert(bytes>20*1024*1024,`${bytes} bytes stored`);
  const g=importer(read(f),orders,{bad:bookDetail('Recovered')});await g.scan(false);
  assert.deepEqual(g.requests,['bad']);assert.equal(g.stored.libraryItems.length,14001);
});

test('lost commit acknowledgement retries idempotently using committed order versions',async()=>{
  const f=importer({humbleProfileLabel:''},[order('good'),order('bad')],{good:bookDetail('Good')},['bad']);
  const send=f.context.chrome.runtime.sendMessage;
  f.context.chrome.runtime.sendMessage=async message=>{const result=await send(message);if(message.operation==='commit'&&result.ok)throw Error('Acknowledgement lost');return result;};
  await assert.rejects(f.scan(),/Acknowledgement lost/);assert.equal(f.stored.libraryItems.length,1);
  const g=importer(read(f),[order('good'),order('bad')],{bad:bookDetail('Recovered')});await g.scan(false);
  assert.deepEqual(g.requests,['bad']);assert.equal(g.stored.libraryItems.length,2);
});

test('partial writer rejects fabricated completions, replay, stale abort and invalid data',async()=>{
  const f=importer({humbleProfileLabel:''},[],{});
  const first=await call(f,"HumbleComicLibrary.storageRequest('begin',{profileLabel:'A',confirmed:true,fullRescan:true})");
  const latest=await call(f,"HumbleComicLibrary.storageRequest('begin',{profileLabel:'A',confirmed:true,fullRescan:true})");
  f.context.oldToken=first.token;assert.equal(await call(f,"HumbleComicLibrary.storageRequest('abort',oldToken)"),false);
  f.context.token=latest.token;
  const update={libraryItems:[{title:'Valid',kind:'book',source:'humble',purchaseKey:'good'}],purchaseSummaries:[{purchaseKey:'good',itemCount:1,importVersion:9}],successfulPurchaseKeys:['good'],lastImport:{fullRescan:true,reconciled:false,scannedPurchases:2,failedPurchaseKeys:['bad']}};
  for(const patch of [{successfulPurchaseKeys:[]},{successfulPurchaseKeys:['good','good']},{lastImport:{...update.lastImport,failedPurchaseKeys:['good']}},{libraryItems:[{title:'Invalid',kind:'invalid'}]}]){
    f.context.update={...update,...patch};await assert.rejects(call(f,"HumbleComicLibrary.storageRequest('commit',token,update)"));assert.equal(f.writes.length,0);
  }
  f.context.update=update;await call(f,"HumbleComicLibrary.storageRequest('commit',token,update)");
  await assert.rejects(call(f,"HumbleComicLibrary.storageRequest('commit',token,update)"),/superseded/);
});

test('companion snapshot contains committed partial purchases and excludes unsaved failures',async()=>{
  let rejectSave=false;
  const f=importer({humbleProfileLabel:''},[order('good'),order('bad')],{good:bookDetail('Good')},['bad'],values=>{if(rejectSave&&values.libraryItems)throw Error('Disk failure');});
  f.context.TextEncoder=TextEncoder;
  for(const file of ['purchase-snapshot.js','purchase-adapters.js','purchase-sync.js'])vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),f.context,{filename:file});
  await f.scan();
  const snapshot=()=>call(f,"(async()=>{const accounts=await HumbleComicLibrary.storageRequest('handoffAccounts');return HumbleComicLibrary.storageRequest('handoffSnapshot',accounts[0].accountRef);})()");
  const committed=plain(await snapshot());assert.equal(committed.records.length,1);assert.equal(committed.records[0].title,'Good');
  assert.notEqual(committed.completeness,'complete');
  rejectSave=true;await assert.rejects(f.scan(),/Disk failure/);
  assert.deepEqual(plain(await snapshot()).records,committed.records);
});
