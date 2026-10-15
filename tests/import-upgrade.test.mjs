import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {wireStore} from './store-fixture.mjs';
const plain=value=>JSON.parse(JSON.stringify(value));
function harness(initial={},onSet=()=>{}){
 const stored={humbleProfileLabel:'Personal',mediaImportVersion:7,profileArchives:[],...structuredClone(initial)},requests=[],messages=[];
 const context={Blob,URL,console,Promise,clearTimeout,setTimeout:fn=>{fn();return 0;},performance:{now:()=>0},document:{title:''},location:{pathname:'/'},chrome:{storage:{local:{get:async defaults=>({...structuredClone(defaults),...structuredClone(stored)}),set:async updates=>{onSet(updates);Object.assign(stored,plain(updates));}}}}};
 context.globalThis=context;wireStore(context);vm.createContext(context);
 for(const file of ['shared.js','collection-mappings.js','ownership.js','content.js'])vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),context,{filename:file});
 return {stored,context,requests,messages,async scan(details,{fail=[],full=false,interrupt=false}={}){
   context.fetch=async url=>{if(url==='/api/v1/user/order?all=true')return {ok:true,json:async()=>Object.keys(details).map(gamekey=>({gamekey}))};const key=decodeURIComponent(url.match(/\/order\/([^?]+)/u)[1]);requests.push(key);if(fail.includes(key))throw Error('Synthetic failure');return {ok:true,text:async()=>JSON.stringify(details[key])};};
   context.report=message=>{messages.push(message);if(interrupt&&requests.length)throw Error('Synthetic tab interruption');};
   return plain(await vm.runInContext(`importPurchases(report,{profileLabel:'Personal',confirmed:true,fullRescan:${full}})`,context));
 }};
}
const product=(title='Example',extra={})=>({human_name:title,machine_name:title.toLowerCase(),downloads:[{format:'pdf'}],...extra});
const detail=title=>({subproducts:[product(title)]});
const legacy=(key,title)=>({title,kind:'book',source:'humble',purchaseKey:key,providerItemId:key+':product:'+title.toLowerCase(),provenance:[{title,purchaseKey:key,providerItemId:key+':product:'+title.toLowerCase(),entitlement:'direct-download'}]});
const baseline=()=>({libraryItems:[legacy('a','Alpha'),legacy('b','Beta')],purchaseSummaries:[{purchaseKey:'a'},{purchaseKey:'b'}],historicalLibraryItems:[{title:'Retired',kind:'book',source:'humble',purchaseKey:'retired',formats:['.epub']}],mediaTypeOverrides:{}});

test('version 7 to 8 backfills each purchase once, then incremental skips current purchases while full always reads all',async()=>{
 const h=harness(baseline()),details={a:detail('Alpha'),b:detail('Beta'),new:detail('New')};
 const result=await h.scan(details);assert.equal(result.metadataUpgrades,2);assert.equal(result.newPurchases,1);assert.deepEqual(h.requests,['a','b','new']);assert.equal(h.stored.mediaImportVersion,8);assert(h.stored.purchaseSummaries.every(p=>p.importVersion===8));assert(h.messages.some(m=>m.includes('one-time backfill')));
 h.requests.length=0;await h.scan(details);assert.deepEqual(h.requests,[]);await h.scan(details,{full:true});assert.deepEqual(h.requests,['a','b','new']);
 const restored=h.context.HumbleComicLibrary.restoreBackupState(h.context.HumbleComicLibrary.createLibraryBackup(h.stored));assert(restored.purchaseSummaries.every(p=>p.importVersion===8));
});
test('failed upgrades mark only successful purchases and retry only outstanding versions',async()=>{
 const h=harness(baseline()),details={a:detail('Alpha'),b:detail('Beta')};await h.scan(details,{fail:['b']});
 assert.equal(h.stored.mediaImportVersion,7);assert.equal(h.stored.purchaseSummaries.find(p=>p.purchaseKey==='a').importVersion,8);assert.equal(h.stored.purchaseSummaries.find(p=>p.purchaseKey==='b').importVersion,undefined);assert(h.stored.libraryItems.some(i=>i.title==='Beta'));assert.deepEqual(h.stored.historicalLibraryItems,baseline().historicalLibraryItems);
 h.requests.length=0;await h.scan(details);assert.deepEqual(h.requests,['b']);assert.equal(h.stored.mediaImportVersion,8);
});
test('a failed key-evidence extraction preserves prior reminders and cannot mark its purchase upgraded',async()=>{
 const prior={id:'pending',purchaseKey:'a',title:'Alpha',status:'unrevealed'},h=harness({...baseline(),keyReminders:[prior]});
 h.context.extractKeyReminderRecords=()=>{throw Error('Synthetic malformed key evidence');};
 await h.scan({a:detail('Alpha')});assert.equal(h.stored.mediaImportVersion,7);assert.equal(h.stored.purchaseSummaries.find(p=>p.purchaseKey==='a').importVersion,undefined);assert.deepEqual(h.stored.keyReminders,[prior]);
});
test('interruption and quota failures cannot commit upgrade versions or erase purchase evidence',async()=>{
 let quota=false;const h=harness(baseline(),updates=>{if(quota&&updates.libraryItems)throw Error('kQuotaBytes');}),before=JSON.stringify(h.stored.libraryItems),details={a:detail('Alpha'),b:detail('Beta')};
 await assert.rejects(h.scan(details,{interrupt:true}),/interruption/);assert.equal(h.stored.mediaImportVersion,7);assert.equal(JSON.stringify(h.stored.libraryItems),before);
 quota=true;await assert.rejects(h.scan(details),/quota/i);assert.equal(h.stored.mediaImportVersion,7);assert(h.stored.purchaseSummaries.every(p=>p.importVersion===undefined));assert.equal(JSON.stringify(h.stored.libraryItems),before);assert.equal(h.stored.hclSyncControl,null);
 quota=false;await h.scan(details);assert.equal(h.stored.mediaImportVersion,8);
});
test('incremental classification corrections use the same native purchase product and retain manual overrides and provenance',async()=>{
 const item={...legacy('a','Night Springs Comic Book'),kind:'unclassified',automaticKind:'unclassified',formats:['.zip']};
 const h=harness({libraryItems:[item],purchaseSummaries:[{purchaseKey:'a'}]}),details={a:{subproducts:[product(item.title,{downloads:[{format:'zip'}]})]}};await h.scan(details);
 assert.equal(h.stored.libraryItems.length,1);assert.equal(h.stored.libraryItems[0].kind,'comic');assert.equal(h.stored.libraryItems[0].provenance[0].providerItemId,item.providerItemId);
 const manual=harness({libraryItems:[{...item,kind:'video',manualKind:'video'}],purchaseSummaries:[{purchaseKey:'a'}],mediaTypeOverrides:{[item.providerItemId]:'video'}});await manual.scan(details);assert.equal(manual.stored.libraryItems.length,1);assert.equal(manual.stored.libraryItems[0].kind,'video');assert.equal(manual.stored.libraryItems[0].manualKind,'video');
});
test('history cleanup preserves retired formats and distinct native products without duplicating active observations',()=>{
 const h=harness(),item={...legacy('a','Same Title'),formats:['.pdf']},other={...item,providerItemId:'different-id',provenance:[{...item.provenance[0],providerItemId:'different-id',formats:['.epub']}]};
 h.context.historyInput=[item,other];h.context.currentInput=[item];const history=plain(vm.runInContext('archivePrunedLibraryItems(historyInput,[],currentInput)',h.context));
 assert.equal(history.length,1);assert.equal(history[0].provenance[0].providerItemId,'different-id');assert.deepEqual(history[0].provenance[0].formats,['.epub']);
 h.context.historyInput=[{...legacy('gone','Retired'),formats:['.epub']}];assert.deepEqual(plain(vm.runInContext('archivePrunedLibraryItems(historyInput,[],currentInput)',h.context))[0].formats,['.epub']);
});
test('ZIP is only a container: explicit comics and download labels classify, ambiguous episodes and game-bundle titles do not',()=>{
 const h=harness(),run=value=>{h.context.value=value;return vm.runInContext('productKind(value)',h.context);};
 for(const title of ['Night Springs Comic Book','Psycho Thriller Comic Book'])assert.equal(run(product(title,{downloads:[{format:'zip'}]})),'comic');
 assert.equal(run(product('Night Springs Episodes',{downloads:[{name:'Episodes (ZIP)',format:'zip'}]})),null);
 assert.equal(run(product('Night Springs Episodes',{downloads:[{name:'Video Episodes (ZIP)',format:'zip'}]})),'video');
 assert.equal(run(product('Making Of Videos',{downloads:[{format:'zip'}]})),'video');
 assert.equal(run(product('How to Draw a Comic Book',{downloads:[{format:'zip'}]})),null);
 assert.equal(run(product('Reading Material',{downloads:[{name:'Ebook (ZIP)',format:'zip'}]})),'book');
 assert.equal(run(product('Source Assets',{product_type:'software',downloads:[{format:'zip'}]})),'software');
 assert.equal(run({human_name:'Metro Rudex Bundle'}),null);assert.equal(run(product('Unspecified archive',{downloads:[{format:'zip'}]})),null);
 assert.equal(run(product('Comic Book',{product_type:'game',downloads:[{format:'zip'}]})),'game');
});
