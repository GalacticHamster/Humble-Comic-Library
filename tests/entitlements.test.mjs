import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const plain=value=>JSON.parse(JSON.stringify(value));
function load() {
  const context={Blob,URL,clearTimeout,console,document:{title:''},location:{pathname:'/'},performance:{now:()=>0},Promise,setTimeout};
  context.globalThis=context;vm.createContext(context);
  for(const file of ['shared.js','collection-mappings.js','ownership.js','content.js'])vm.runInContext(fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8'),context,{filename:file});
  return context;
}
const evaluate=(context,source)=>vm.runInContext(source,context);

test('import and reminders distinguish revealed, pending and unavailable keys without retaining values',async()=>{
  const context=load();
  const detail={subproducts:[{human_name:'Expired game',platform:'steam'}],all_tpks:[
    {human_name:'Expired game',machine_name:'expired',is_expired:true,redeemed_key_val:'private-expired'},
    {human_name:'Revealed game',machine_name:'revealed',redeemed_key_val:'private-revealed'},
    {human_name:'Pending game',machine_name:'pending'},
    {human_name:'Unavailable game',machine_name:'unavailable',is_available:false},
    {human_name:'Ambiguous game',machine_name:'ambiguous',redeemed_key_val:''}
  ]};
  context.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify(detail)});
  context.detail=await evaluate(context,"fetchOrderDetail('order')");
  const items=plain(evaluate(context,"extractLibraryItems(detail,{product:{human_name:'Game Bundle'}},'order')"));
  assert.equal(items.length,5,'duplicate product must not mask an expired key');
  assert.deepEqual(items.map(item=>item.keyStatus),['expired','revealed','unrevealed','unavailable','unknown']);
  assert.equal(JSON.stringify(items).includes('private-'),false);
  const reminders=plain(evaluate(context,"extractKeyReminderRecords(detail,{},'order')"));
  assert.equal(reminders.length,4,'revealed removes a reveal reminder, not proof of activation');
  assert.equal(reminders[0].status,'needs-review');assert.equal(reminders[0].isExpired,true);
  for(const item of items){
    const lines=context.HumbleOwnership.explanationLines({state:'possible',offered:{title:item.title,kind:'game'},item});
    assert.ok(lines.some(line=>line.includes('Destination activation: unknown')));
  }
});

test('refresh replaces the same entitlement evidence and retains independent purchases',()=>{
  const context=load();
  context.old={title:'Game',kind:'game',source:'humble',purchaseKey:'order',sourceBundle:'Old label',purchasedAt:null};
  context.update={...context.old,sourceBundle:'Updated label',entitlement:'third-party-key',entitlementId:'game:0',keyStatus:'expired',keyCheckedAt:'2026-10-01T12:00:00.000Z'};
  const refreshed=plain(evaluate(context,'mergeLibraryItem(old,update)'));
  assert.equal(refreshed.provenance.length,1,'legacy purchase evidence cannot mask a refreshed expiry');
  assert.equal(context.HumbleOwnership.purchased(refreshed),false);
  context.old=refreshed;context.update={...context.update,purchaseKey:'second-order',keyStatus:'unrevealed'};
  const combined=plain(evaluate(context,'mergeLibraryItem(old,update)'));
  assert.equal(combined.provenance.length,2);assert.equal(context.HumbleOwnership.purchased(combined),true);
  context.old=combined;context.update.keyStatus='revealed';
  const latest=plain(evaluate(context,'mergeLibraryItem(old,update)'));
  assert.equal(latest.provenance.length,2);assert.equal(latest.provenance[1].keyStatus,'revealed');
  assert.equal(latest.provenance[0].keyStatus,'expired');
});

test('expired keys remain Possible, cannot supply owned contents, and survive backup restore',()=>{
  const context=load();const H=context.HumbleComicLibrary;const O=context.HumbleOwnership;
  const item={title:'Comic Vol. 1',kind:'book',source:'humble',purchaseKey:'order',entitlement:'third-party-key',entitlementId:'comic:0',keyStatus:'expired',expiresAt:'2026-09-01T00:00:00.000Z'};
  const identity=O.exactCandidate({title:item.title},[item]);
  assert.equal(identity.exact,undefined);assert.equal(identity.possible.length,1);
  assert.equal(O.localEvidence([item],[]).length,0);
  const backup=plain(H.createLibraryBackup({libraryItems:[item],mediaImportVersion:7}));
  assert.equal(backup.version,8);
  const restored=plain(H.restoreBackupState(backup));assert.equal(restored.libraryItems[0].keyStatus,'expired');
  assert.equal(O.purchased(restored.libraryItems[0]),false);
  assert.throws(()=>H.restoreBackupState({...backup,items:[{...item,keyStatus:'activated'}]}),/keyStatus/);
  assert.throws(()=>H.restoreBackupState({...backup,items:[{...item,expiresAt:'not-a-date'}]}),/expiresAt/);
});
