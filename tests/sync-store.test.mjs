import assert from 'node:assert/strict';
import test from 'node:test';
import '../shared.js';
import '../collection-mappings.js';

const library=globalThis.HumbleComicLibrary;
function fixture(){
  const state={...structuredClone(library.LIBRARY_STATE_DEFAULTS),humbleProfileLabel:'personal',libraryItems:[{title:'Personal book',kind:'book',source:'humble'},{title:'Manual book'}]};
  const area={get:async defaults=>structuredClone({...defaults,...Object.fromEntries(Object.keys(defaults).filter(key=>key in state).map(key=>[key,state[key]]))}),set:async updates=>Object.assign(state,structuredClone(updates)),remove:async keys=>{for(const key of keys)delete state[key];}};
  return {state,area,store:library.createSyncStore(area)};
}
const options={profileLabel:'personal',confirmed:true,fullRescan:true};
const updates={libraryItems:[{title:'Fresh book'}],lastImport:{reconciled:true}};
test('stale scan commits cannot overwrite a newer scan, restore, or clear; leases survive worker restart',async()=>{
  const f=fixture();const begin=()=>f.store.execute('begin',[options,1]);const commit=scan=>f.store.execute('commit',[scan.token,updates,1]);
  const old=await begin();const latest=await begin();await assert.rejects(commit(old),/superseded/);
  f.store=library.createSyncStore(f.area);await commit(latest);
  const beforeRestore=await begin();await f.store.execute('replace',[library.LIBRARY_STATE_DEFAULTS]);await assert.rejects(commit(beforeRestore),/superseded/);
  const beforeClear=await begin();await f.store.execute('remove',[Object.keys(library.LIBRARY_STATE_DEFAULTS)]);await assert.rejects(commit(beforeClear),/superseded/);
});
test('profile switches need explicit full scans, preserve manual records, and retain the prior account in backups',async()=>{
  const f=fixture();await assert.rejects(f.store.execute('begin',[{...options,profileLabel:'work'},1]),/explicitly/);
  const scan=await f.store.execute('begin',[{...options,profileLabel:'work',switchProfile:true},1]);
  assert.deepEqual(scan.state.libraryItems,[{title:'Manual book'}]);
  await assert.rejects(f.store.execute('commit',[scan.token,{...updates,lastImport:{reconciled:false}},1]),/complete successful/);
  assert.equal(f.state.humbleProfileLabel,'personal');
  await f.store.execute('patch',[{showDiagnostics:true}]);
  await f.store.execute('commit',[scan.token,{...updates,libraryItems:[...scan.state.libraryItems,{title:'Work book'}]},1]);
  assert.equal(f.state.showDiagnostics,true);assert.equal(f.state.humbleProfileLabel,'work');
  const restored=library.restoreBackupState(library.createLibraryBackup(f.state));
  assert.equal(restored.profileArchives[0].profileLabel,'personal');
  assert.equal(restored.profileArchives[0].backup.items[0].title,'Personal book');
});
test('concurrent wishlist edits merge in the writer and failed requests do not poison its queue',async()=>{
  const f=fixture();await Promise.all(['First','Second'].map(title=>f.store.execute('wishlist',['add',[{title,kind:'book',weight:1}]])));
  assert.equal(f.state.wishlistItems.length,2);await assert.rejects(f.store.execute('patch',[{libraryItems:[]}]),/Unsupported/);
  await f.store.execute('patch',[{showDiagnostics:true}]);assert.equal(f.state.showDiagnostics,true);
});

test('incomplete full scans retain provenance and history while allowing successful purchases to append',async()=>{
  const f=fixture();f.state.customCollectionMappings=[{id:'unrelated legacy setting'}];
  f.state.libraryItems[0].provenance=[{purchaseKey:'old',entitlementId:'key'}];
  f.state.purchaseSummaries=[{purchaseKey:'old',itemCount:1}];
  f.state.historicalLibraryItems=[{title:'Archived book',kind:'book',source:'humble',purchaseKey:'archive'}];
  f.state.historicalPurchaseSummaries=[{purchaseKey:'archive',itemCount:1}];
  const scan=await f.store.execute('begin',[options,1]),before=structuredClone(f.state);
  const partial={libraryItems:[...f.state.libraryItems,{title:'Successful new book'}],purchaseSummaries:[...f.state.purchaseSummaries,{purchaseKey:'new',itemCount:1}],historicalLibraryItems:[...f.state.historicalLibraryItems,{title:'New history'}],historicalPurchaseSummaries:[...f.state.historicalPurchaseSummaries,{purchaseKey:'new',itemCount:1}],lastImport:{reconciled:false,failedPurchaseKeys:['old']}};
  for(const delta of [{libraryItems:[]},{purchaseSummaries:[]},{historicalLibraryItems:[]},{historicalPurchaseSummaries:[]},{lastImport:{reconciled:false,failedPurchaseKeys:[]}},{libraryItems:[{...f.state.libraryItems[0],provenance:[{purchaseKey:'old',entitlementId:'different'}]},f.state.libraryItems[1]]}]){
    await assert.rejects(f.store.execute('commit',[scan.token,{...partial,...delta},1]),/Incomplete full scan/);assert.deepEqual(f.state,before);
  }
  await f.store.execute('commit',[scan.token,partial,1]);assert.equal(f.state.libraryItems.length,3);assert.deepEqual(f.state.lastImport.failedPurchaseKeys,['old']);assert.deepEqual(f.state.customCollectionMappings,[{id:'unrelated legacy setting'}]);
});
test('the background writer validates every scan record before writing any state',async()=>{
  const f=fixture(),scan=await f.store.execute('begin',[options,1]),before=structuredClone(f.state);
  await assert.rejects(f.store.execute('commit',[scan.token,{libraryItems:[{title:'Valid new title'},{title:'Invalid media',kind:'unsupported'}],lastImport:{reconciled:true}},1]),/kind/);assert.deepEqual(f.state,before);
  await f.store.execute('commit',[scan.token,updates,1]);assert.equal(f.state.libraryItems[0].title,'Fresh book');
});

test('summary preferences merge through the writer, reject invalid patches atomically, and survive restore and clear outside backups',async()=>{
  const f=fixture();await f.store.execute('patch',[{bundleSummaryPreferences:{position:'top-left'}}]);await f.store.execute('patch',[{bundleSummaryPreferences:{minimized:true}}]);assert.deepEqual(f.state.bundleSummaryPreferences,{position:'top-left',minimized:true});const before=structuredClone(f.state);
  for(const value of [{position:'offscreen'},{minimized:'true'},{extra:'private'},null,[]]){await assert.rejects(f.store.execute('patch',[{showDiagnostics:true,bundleSummaryPreferences:value}]),/preferences/);assert.deepEqual(f.state,before);}
  assert.equal(JSON.stringify(library.createLibraryBackup(f.state)).includes('bundleSummaryPreferences'),false);await f.store.execute('replace',[library.LIBRARY_STATE_DEFAULTS]);assert.deepEqual(f.state.bundleSummaryPreferences,before.bundleSummaryPreferences);await f.store.execute('remove',[['libraryItems']]);assert.deepEqual(f.state.bundleSummaryPreferences,before.bundleSummaryPreferences);
});


const choose=(label,expectedActiveLabel)=>({profileLabel:label,expectedActiveLabel,confirmed:true});
test('saved account activation restores its purchase and reminder scan history without a full scan',async()=>{
  const f=fixture();f.state.mediaImportVersion=7;f.state.purchaseSummaries=[{purchaseKey:'personal-order',itemCount:1}];f.state.keyReminderScan={complete:true};f.state.keyReminders=[{id:'personal-key',purchaseKey:'personal-order',title:'Personal game',status:'unrevealed'}];f.state.lastImport={importedAt:'2026-10-02T10:00:00Z',reconciled:true};f.state.wishlistItems=[{title:'Wish',kind:'book',weight:1}];f.state.galacticLibraryExtensionId='a'.repeat(32);
  const personal=structuredClone(f.state),scan=await f.store.execute('begin',[{...options,profileLabel:'work',switchProfile:true},1]);
  await f.store.execute('commit',[scan.token,{...updates,libraryItems:[{title:'Work book',kind:'book',source:'humble'}],purchaseSummaries:[{purchaseKey:'work-order',itemCount:1}],keyReminders:[],keyReminderScan:{complete:true},mediaImportVersion:7},1]);
  const old=await f.store.execute('begin',[{profileLabel:'work',confirmed:true},1]);
  await f.store.execute('selectProfile',[choose('personal','work')]);
  for(const key of ['libraryItems','purchaseSummaries','keyReminders','keyReminderScan','lastImport','mediaImportVersion'])assert.deepEqual(f.state[key],personal[key]);
  assert.equal(f.state.wishlistItems[0].title,'Wish');assert.equal(f.state.galacticLibraryExtensionId,'a'.repeat(32));assert.equal(f.state.hclEntitlementShareScope,null);
  await assert.rejects(f.store.execute('commit',[old.token,updates,1]),/superseded/);
  f.store=library.createSyncStore(f.area);const quick=await f.store.execute('begin',[{profileLabel:'personal',confirmed:true},1]);assert.equal(quick.forceFull,false);assert.equal(quick.state.purchaseSummaries[0].purchaseKey,'personal-order');
  await f.store.execute('selectProfile',[choose('work','personal')]);assert.equal(f.state.libraryItems[0].title,'Work book');assert.equal(f.state.purchaseSummaries[0].purchaseKey,'work-order');
  for(let n=0;n<3;n++){await f.store.execute('selectProfile',[choose('personal','work')]);await f.store.execute('selectProfile',[choose('work','personal')]);}assert.equal(f.state.profileArchives.length,1);
});
test('saved account selection validates confirmation, stale UI, and target before changing storage',async()=>{
  const f=fixture(),scan=await f.store.execute('begin',[{...options,profileLabel:'work',switchProfile:true},1]);await f.store.execute('commit',[scan.token,updates,1]);const before=structuredClone(f.state);
  for(const args of [{...choose('personal','work'),confirmed:false},choose('personal','stale'),choose('missing','work')]){await assert.rejects(f.store.execute('selectProfile',[args]));assert.deepEqual(f.state,before);}
  await assert.rejects(f.store.execute('begin',[{...options,profileLabel:'personal',switchProfile:true},1]),/Use saved account/);assert.deepEqual(f.state,before);
  f.state.humbleProfileLabel='';const unnamed=structuredClone(f.state);await assert.rejects(f.store.execute('selectProfile',[choose('personal','')]),/nickname/);assert.deepEqual(f.state,unnamed);
});
test('renaming active and saved accounts preserves evidence, rejects collisions and invalidates scans',async()=>{
  const f=fixture(),scan=await f.store.execute('begin',[{...options,profileLabel:'work',switchProfile:true},1]);await f.store.execute('commit',[scan.token,updates,1]);
  const pending=await f.store.execute('begin',[{profileLabel:'work',confirmed:true},1]),before=structuredClone(f.state);
  for(const next of ['personal','', 'x'.repeat(101)]){await assert.rejects(f.store.execute('renameProfile',[{...choose('work','work'),newLabel:next}]));assert.deepEqual(f.state,before);}
  await f.store.execute('renameProfile',[{...choose('work','work'),newLabel:'business'}]);assert.deepEqual(f.state.libraryItems,before.libraryItems);assert.equal(f.state.humbleProfileLabel,'business');await assert.rejects(f.store.execute('commit',[pending.token,updates,1]),/superseded/);
  await f.store.execute('renameProfile',[{...choose('personal','business'),newLabel:'home'}]);assert.equal(f.state.profileArchives[0].backup.profileLabel,'home');
  const backup=library.createLibraryBackup(f.state);await f.store.execute('replace',[library.restoreBackupState(backup)]);await f.store.execute('selectProfile',[choose('home','business')]);assert.equal(f.state.libraryItems[0].title,'Personal book');assert.equal((await f.store.execute('begin',[{profileLabel:'home',confirmed:true},1])).forceFull,false);
});
