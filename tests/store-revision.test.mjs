// Purchase sync uses the store revision to tell whether another saved change landed while Humble Library
// applied Galactic Library's records. Reads must not move it; every write must, and an import reports its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../purchase-snapshot.js';import '../purchase-adapters.js';import '../purchase-transfer.js';import '../purchase-sync.js';
import '../shared.js';import '../collection-mappings.js';
const H=globalThis.HumbleComicLibrary;
const item=n=>({title:'Synthetic HB '+n,kind:'book',source:'humble',providerItemId:`synthetic_purchase_${n}:product:synthetic_${n}`,purchaseKey:'synthetic_purchase_'+n,sourceBundle:'Synthetic bundle',entitlement:'direct-download',purchasedAt:'2026-11-01T12:00:00Z'});
test('reads leave the store revision unchanged; writes and imports advance it and an import brackets its own write',async()=>{
 const saved={humbleProfileLabel:'Main',libraryItems:Array.from({length:3000},(_,n)=>item(n)),profileArchives:[]};
 const store=H.createSyncStore({get:async d=>structuredClone({...d,...saved}),set:async p=>Object.assign(saved,structuredClone(p)),remove:async k=>[k].flat().forEach(x=>delete saved[x])});
 let [account]=await store.execute('syncAccounts');const settled=store.revision();
 for(let n=0;n<3;n++){[account]=await store.execute('syncAccounts');await store.execute('handoffSnapshot',[account.accountRef]);}
 assert.equal(store.revision(),settled,'account and snapshot reads do not count as changes');
 const snapshot=await store.execute('handoffSnapshot',[account.accountRef]),incoming={...snapshot,records:[{...snapshot.records[0],providerItemId:'synthetic_purchase_9999:product:synthetic_9999',title:'Synthetic HB 9999',metadata:{...snapshot.records[0].metadata,purchaseId:'synthetic_purchase_9999'}}]};
 const result=await store.execute('handoffImport',[incoming,{accountRef:account.accountRef}]);
 assert.equal(result.added,1);assert.equal(result.revisionBefore,settled);assert(result.revision>result.revisionBefore);assert.equal(store.revision(),result.revision);
 await store.execute('patch',[{showDiagnostics:true}]);assert(store.revision()>result.revision,'any saved change advances the revision');
});
