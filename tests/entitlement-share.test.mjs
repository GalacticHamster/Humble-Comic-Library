import assert from 'node:assert/strict';
import test from 'node:test';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import '../shared.js';
import '../collection-mappings.js';
import '../entitlement-share.js';

globalThis.crypto??=webcrypto;
const H=globalThis.HumbleComicLibrary,E=globalThis.HumbleEntitlements,salt='12345678-1234-1234-1234-123456789abc';
const origin={purchaseKey:'PRIVATE ORDER',entitlementId:'PRIVATE ID',entitlement:'third-party-key',keyStatus:'unrevealed',keyCheckedAt:'2026-10-01T00:00:00Z',expiresAt:'2026-11-01T00:00:00Z',redeemed_key_val:'PRIVATE KEY'};
const state={...H.LIBRARY_STATE_DEFAULTS,humbleProfileLabel:'personal',libraryItems:[{title:'Synthetic game',kind:'game',source:'humble',provenance:[origin,{...origin,purchaseKey:'SECOND PRIVATE ORDER',keyStatus:'revealed'}]}],keyReminderScan:{complete:true}};

test('entitlement projection preserves separate purchases through opaque references and excludes secret/provenance fields',async()=>{
  const result=await E.project(state,salt);assert.equal(result.entries.length,2);assert.notEqual(result.entries[0].itemRef,result.entries[1].itemRef);assert(result.entries.every(entry=>entry.activationStatus==='unknown'&&entry.purchaseEvidence==='confirmed'));
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|purchaseKey|sourceBundle|redeemed|price|salt/u);assert.equal((await E.project(state,salt)).entries[0].itemRef,result.entries[0].itemRef);
  const other=await E.project(state,'abcdef12-1234-1234-1234-123456789abc');assert.notEqual(other.entries[0].itemRef,result.entries[0].itemRef);
  const reminderOnly=await E.project({...state,libraryItems:[],keyReminders:[{purchaseKey:'PRIVATE ORDER',id:'PRIVATE ID',title:'Unclassified course',status:'needs-review',checkedAt:'2026-10-01'}]},salt);assert.equal(reminderOnly.entries[0].mediaType,'unknown');assert.equal(reminderOnly.entries[0].keyStatus,'unknown');
  await assert.rejects(E.project({...state,humbleProfileLabel:''},salt),/confirmed/);
});

test('sharing sends bounded sequential batches and only commits after source-snapshot verification',async()=>{
  const calls=[],feed={coverage:'partial',sentAt:'2026-10-01',entries:Array.from({length:401},(_,n)=>({itemRef:String(n)}))};let verified=false;
  const runtime={sendMessage:async(id,request)=>{calls.push(request);if(request.type==='GET_STATUS')return {ok:true,apiVersion:1,capabilities:{entitlementFeed:true}};if(request.type==='BEGIN_ENTITLEMENT_FEED')return {ok:true,apiVersion:1,uploadToken:salt};if(request.type==='COMMIT_ENTITLEMENT_FEED')assert(verified);return {ok:true,apiVersion:1,count:401};}};
  const result=await E.send(runtime,'a'.repeat(32),'central-profile',feed,async()=>{verified=true;});assert.equal(result.count,401);assert.deepEqual(calls.filter(call=>call.type==='APPEND_ENTITLEMENT_FEED').map(call=>[call.offset,call.entries.length]),[[0,200],[200,200],[400,1]]);
  calls.length=0;await assert.rejects(E.send(runtime,'a'.repeat(32),'central-profile',feed,async()=>{throw new Error('Source changed');}),/Source changed/);assert(!calls.some(call=>call.type==='COMMIT_ENTITLEMENT_FEED'));
});

test('failed batches, old capabilities and incompatible responses never commit a partial reminder feed',async()=>{
  const feed={coverage:'partial',sentAt:'2026-10-01',entries:[{}]};
  for(const failing of ['GET_STATUS','APPEND_ENTITLEMENT_FEED']){
    const calls=[],runtime={sendMessage:async(id,request)=>{calls.push(request);return request.type===failing?{ok:false,apiVersion:1,error:'Synthetic failure'}:{ok:true,apiVersion:1,capabilities:{entitlementFeed:true},uploadToken:salt};}};
    await assert.rejects(E.send(runtime,'a'.repeat(32),'personal',feed));assert(!calls.some(call=>call.type==='COMMIT_ENTITLEMENT_FEED'));
  }
});

test('source sharing scopes reset on restore/clear/profile changes and reject changed source revisions or links',async()=>{
  const values=structuredClone({...state,galacticLibraryExtensionId:'a'.repeat(32)}),area={get:async defaults=>({...structuredClone(defaults),...structuredClone(values)}),set:async updates=>Object.assign(values,structuredClone(updates)),remove:async keys=>{for(const key of keys)delete values[key];}},store=H.createSyncStore(area);
  const snapshot=await store.execute('shareSnapshot',['personal']);await store.execute('verifyShareSnapshot',[snapshot.scope,'a'.repeat(32)]);
  const scan=await store.execute('begin',[{profileLabel:'personal',confirmed:true,fullRescan:true},1]);await store.execute('commit',[scan.token,{libraryItems:state.libraryItems,lastImport:{reconciled:true}},1]);await assert.rejects(store.execute('verifyShareSnapshot',[snapshot.scope,'a'.repeat(32)]),/changed/);
  const current=await store.execute('shareSnapshot',['personal']);assert.equal(current.scope.salt,snapshot.scope.salt);await store.execute('replace',[H.LIBRARY_STATE_DEFAULTS]);assert.equal(values.hclEntitlementShareScope,null);await assert.rejects(store.execute('verifyShareSnapshot',[current.scope,'a'.repeat(32)]),/changed/);
  assert(!JSON.stringify(H.createLibraryBackup(values)).includes('hclEntitlementShareScope'));
});

test('the actual background handler refuses sharing or private snapshot access from storefront content and foreign senders',async()=>{
  const listeners=[],outgoing=[],id='a'.repeat(32),url='chrome-extension://'+id+'/';
  const context=vm.createContext({crypto:webcrypto,TextEncoder,setTimeout,clearTimeout,chrome:{runtime:{id,getURL:path=>url+path,onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:async(...args)=>{outgoing.push(args);return {ok:true};}},storage:{local:{get:async defaults=>structuredClone(defaults),set:async()=>{},remove:async()=>{}}}}});
  for(const file of ['shared.js','collection-mappings.js','entitlement-share.js','background.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
  const dispatch=(message,sender)=>new Promise(resolve=>{for(const listener of listeners){let responded=false;const pending=listener(message,sender,value=>{responded=true;resolve(value);});if(responded||pending===true)return;}resolve(null);});
  for(const sender of [{id,url:'https://www.humblebundle.com/purchases'},{id:'b'.repeat(32),url:url+'options.html'},{id,url:'https://attacker.example/'}]){
    assert.equal((await dispatch({type:'HCL_SHARE_ENTITLEMENTS',confirmed:true},sender)).ok,false);
    assert.equal((await dispatch({type:'HCL_REMOVE_SHARED_ENTITLEMENTS',confirmed:true},sender)).ok,false);
    assert.equal((await dispatch({type:'HCL_STORE',operation:'shareSnapshot',args:['personal']},sender)).ok,false);
  }
  assert.equal(outgoing.length,0);
});
test('changing the link, switching profiles and clearing the library invalidate existing sharing snapshots',async()=>{
  const values=structuredClone({...state,galacticLibraryExtensionId:'a'.repeat(32)}),area={get:async defaults=>({...structuredClone(defaults),...structuredClone(values)}),set:async updates=>Object.assign(values,structuredClone(updates)),remove:async keys=>{for(const key of keys)delete values[key];}},store=H.createSyncStore(area);
  const old=await store.execute('shareSnapshot',['personal']);await store.execute('patch',[{galacticLibraryExtensionId:'b'.repeat(32)}]);await assert.rejects(store.execute('verifyShareSnapshot',[old.scope,'a'.repeat(32)]),/changed/);
  const scan=await store.execute('begin',[{profileLabel:'work',confirmed:true,fullRescan:true,switchProfile:true},1]);await store.execute('commit',[scan.token,{libraryItems:[],lastImport:{reconciled:true}},1]);assert.equal(values.hclEntitlementShareScope,null);await assert.rejects(store.execute('shareSnapshot',['personal']),/changed/);
  const work=await store.execute('shareSnapshot',['work']);assert.notEqual(work.scope.salt,old.scope.salt);await store.execute('remove',[Object.keys(H.LIBRARY_STATE_DEFAULTS)]);await assert.rejects(store.execute('verifyShareSnapshot',[work.scope,'b'.repeat(32)]),/changed/);assert.equal(values.hclEntitlementShareScope,undefined);
});
