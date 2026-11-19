import test from 'node:test';import assert from 'node:assert/strict';
import {load,uuid,ACCOUNT,entitlements} from './library-browser-fixture.mjs';

// Keys in the Humble Library: an explicit "not redeemed" record is a reminder; redeemed or unknown is not.
const scope={principalId:'principal-A',userId:'hub-A'};
const key=(E,n,{title='Synthetic Game '+n,namespace='steam',redeemedAt={state:'none',value:null},expired=false,unavailableAfter={state:'none',value:null},gifted=false,revoked=null,temporaryAccess=null}={})=>E.observation({scope,nativeId:uuid(n),namespace,title,parentId:uuid(100+n),parentTitle:'Synthetic Bundle '+n,source:'authenticated-humble-library',observedAt:'2026-11-13T03:16:00.000Z',
 eligibility:{expired,preOrdered:false,outOfStock:false,redeemable:true,directRedeem:false,parentPreOrder:false,revoked,temporaryAccess,giftStatus:gifted?'gifted':'unassigned',parentType:'bundle',integration:'none',redemptionGroups:'none',unavailableBefore:{state:'none',value:null},unavailableAfter,redeemedAt}});
const state=observations=>({libraryEntitlements:entitlements(observations),humbleAccountId:ACCOUNT,humbleProfileLabel:'Main',libraryItems:[]});
const plain=value=>JSON.parse(JSON.stringify(value));

test('only keys Humble lists as not redeemed are reminders, with Humble\'s deadline kept separate from activation',()=>{
 const {E,B}=load();
 const rows=plain(B.keyReminders(state([
  key(E,1,{unavailableAfter:{state:'date',value:'2027-01-31T00:00:00.000Z'}}),
  key(E,2,{expired:true}),
  key(E,3,{redeemedAt:{state:'date',value:'2025-05-05T00:00:00.000Z'}}),
  key(E,4,{redeemedAt:{state:'unknown',value:null}}),
  key(E,5,{namespace:'download_drm_free'}),
  key(E,6,{gifted:true}),key(E,7,{revoked:true}),key(E,8,{temporaryAccess:true})
 ]),{},Date.parse('2026-11-19T00:00:00Z')));
 assert.deepEqual(rows.map(r=>[r.title,r.status,r.availableUntil,r.hidden]),[
  ['Synthetic Game 1','unrevealed','2027-01-31T00:00:00.000Z',false],
  ['Synthetic Game 2','expired',null,false]]);
 assert.equal(rows[0].bundle,'Synthetic Bundle 1');assert.equal(rows[0].checkedAt,'2026-11-13T03:16:00.000Z');
 assert(!JSON.stringify(rows).match(/activat/i),'no activation state is invented');
});

test('another account\'s keys are never listed',()=>{
 const {E,B}=load(),other={...state([key(E,1)]),humbleAccountId:'22222222-2222-4222-8222-222222222222'};
 assert.equal(B.keyReminders(other).length,0);
});

test('dismissing or snoozing hides a reminder only while its status is unchanged, and Restore brings it back',()=>{
 const {E,B}=load(),now=Date.parse('2026-11-19T00:00:00Z'),ref=E.identity(key(E,1));
 const rows=reviews=>plain(B.keyReminders(state([key(E,1)]),reviews,now))[0];
 assert.equal(rows({[ref]:{action:'dismissed',basis:'unrevealed',until:null,updatedAt:'2026-11-18T00:00:00Z'}}).hidden,true);
 assert.equal(rows({[ref]:{action:'snoozed',basis:'unrevealed',until:'2026-11-25T00:00:00Z',updatedAt:'2026-11-18T00:00:00Z'}}).hidden,true);
 assert.equal(rows({[ref]:{action:'snoozed',basis:'unrevealed',until:'2026-11-18T00:00:00Z',updatedAt:'2026-11-10T00:00:00Z'}}).hidden,false,'an ended snooze shows the key again');
 assert.equal(rows({[ref]:{action:'dismissed',basis:'expired',until:null,updatedAt:'2026-11-18T00:00:00Z'}}).hidden,false,'a review for another status does not hide it');
 assert.equal(rows({[ref]:{action:'active',basis:'unrevealed',until:null,updatedAt:'2026-11-18T00:00:00Z'}}).hidden,false);
 assert.equal(rows({[ref]:{action:'dismissed',basis:'unrevealed',until:null,updatedAt:'not a date'}}).hidden,false,'an invalid review is ignored');
});

test('reviews are validated before they are saved',async()=>{
 const {E}=load();
 const area={values:{},get:async defaults=>({...defaults,...structuredClone(area.values)}),set:async patch=>Object.assign(area.values,structuredClone(patch)),remove:async keys=>{for(const k of [].concat(keys))delete area.values[k];}};
 const vm=await import('node:vm'),fs=await import('node:fs');
 const ctx=vm.createContext({console,Intl,Date,URL,TextEncoder,crypto:globalThis.crypto,structuredClone});ctx.globalThis=ctx;
 for(const file of ['library-entitlements.js','collection-mappings.js','shared.js'])vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx);
 const store=ctx.HumbleComicLibrary.createSyncStore(area),ref=E.identity(key(E,1));
 const good={action:'dismissed',basis:'unrevealed',until:null,updatedAt:'2026-11-18T00:00:00.000Z'};
 assert.equal(await store.execute('patch',[{humbleKeyReviews:{[ref]:good}}]),true);assert.deepEqual(area.values.humbleKeyReviews,{[ref]:good});
 for(const bad of [{[ref]:{...good,action:'deleted'}},{[ref]:{...good,basis:'redeemed'}},{[ref]:{...good,action:'snoozed'}},{[ref]:{...good,extra:'PRIVATE'}},['not','an','object']])
  await assert.rejects(store.execute('patch',[{humbleKeyReviews:bad}]),/key reminder review/);
 assert.deepEqual(area.values.humbleKeyReviews,{[ref]:good},'a rejected review leaves saved reviews unchanged');
 const otherRef=E.identity({...key(E,1),scope:{principalId:'principal-B',userId:'hub-B'}});
 const snooze={...good,action:'snoozed',until:'2026-11-25T00:00:00.000Z'};
 const otherReview={...good,action:'active'};
 const H=ctx.HumbleComicLibrary;
 const baseline={...state([key(E,1),key(E,2)]),mediaTypeOverrides:{'manual:example':'game'}};
 const backup=H.createLibraryBackup({...baseline,humbleKeyReviews:{[ref]:good,[E.identity(key(E,2))]:snooze}});
 const restore=raw=>store.execute('replace',[H.restoreBackupState(raw)]);
 area.values={humbleKeyReviews:{[otherRef]:otherReview}};
 await restore(backup);
 assert.deepEqual(area.values.mediaTypeOverrides,baseline.mediaTypeOverrides);
 const restored=structuredClone(area.values.humbleKeyReviews);
 assert.deepEqual(restored,{...plain(backup.humbleKeyReviews),[otherRef]:otherReview});
 assert.deepEqual(load().B.keyReminders(area.values,restored,Date.parse('2026-11-20')).map(row=>row.hidden).join(','),'true,true');
 await restore(backup);
 await restore(H.createLibraryBackup(baseline));
 assert.deepEqual(area.values.humbleKeyReviews,restored,'repeat and older backups preserve scoped decisions');
 const newer={...good,action:'active',updatedAt:'2026-11-19T00:00:00.000Z'};
 await store.execute('patch',[{humbleKeyReviews:{...restored,[ref]:newer}}]);
 await restore(backup);
 assert.deepEqual(area.values.humbleKeyReviews[ref],newer,'a later explicit Restore wins over an old dismissal');
 assert.throws(()=>H.restoreBackupState({...backup,humbleKeyReviews:{[ref]:{...good,extra:'unexpected'}}}),/key reminder review/);
});
