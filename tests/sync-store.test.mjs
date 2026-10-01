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
