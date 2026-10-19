import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {fixture} from './matching-fixture.mjs';
const noReceiver=()=>{throw Error('Could not establish connection. Receiving end does not exist.');};
for(const firefox of [false,true])for(const scenario of ['absent','disabled','unlinked','revoked','success','failed','unknown transport','malformed'])test(`GL lifecycle ${firefox?'Firefox':'Chrome'}: ${scenario}`,async()=>{
 const f=fixture([],'book',{title:'Distinctive Unpurchased Book'}),c=f.context;
 c.chrome.runtime.getURL=()=>firefox?'moz-extension://fixture/':'chrome-extension://fixture/';
 vm.runInContext("comparison.galactic=createGalacticLookup('')",c);
 c.chrome.runtime.sendMessage=async(_id,message)=>{
  if(['absent','disabled'].includes(scenario))return noReceiver();
  if(scenario==='unlinked')return {ok:false,error:'This extension is not allowed to use the Galactic Library API.'};
  if(scenario==='unknown transport')throw Error('Unexpected transport failure');
  if(scenario==='malformed')return {ok:true,apiVersion:99};
  if(message.type==='PING')return {ok:true,apiVersion:1};
  if(scenario==='revoked')return {ok:false,error:'This extension is not allowed to use the Galactic Library API.'};
  if(scenario==='failed')return noReceiver(); // It disappeared AFTER participating.
  return {ok:true,apiVersion:1,results:message.items.map(({requestId})=>({requestId,matches:[]}))};
 };
 const {match}=await f.classify();
 const failed=['failed','unknown transport','malformed'].includes(scenario);
 assert.equal(match.state,failed?'unchecked':'new');
 assert.equal(c.comparison.galactic.enabled,!['absent','disabled','unlinked','revoked'].includes(scenario));
 assert.equal(c.HumbleOwnership.presentation.status({},match),failed?'Check incomplete':'New');
});
test('GL availability pending, successful completion, disable and reconnect preserve two-phase local evidence',async()=>{
 const f=fixture([],'book',{title:'Distinctive Unpurchased Book'}),c=f.context;let finish;
 c.chrome.runtime.sendMessage=async(_id,m)=>m.type==='PING'?{ok:true,apiVersion:1}:new Promise(resolve=>{finish=()=>resolve({ok:true,apiVersion:1,results:m.items.map(({requestId})=>({requestId,matches:[]}))});});
 const pending=f.classify();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(c.comparison.resolvedItems[0].match.state,'new');
 assert.equal(c.comparison.resolvedItems[0].match.lookupIncomplete,false);
 finish();assert.equal((await pending).match.state,'new');
 c.chrome.runtime.sendMessage=noReceiver;
 vm.runInContext("comparison.galactic=createGalacticLookup('')",c);
 assert.equal((await f.classify()).match.state,'new');assert.equal(c.comparison.galactic.enabled,false);
 c.chrome.runtime.sendMessage=async(_id,m)=>m.type==='PING'?{ok:true,apiVersion:1}:{ok:true,apiVersion:1,results:m.items.map(({requestId})=>({requestId,matches:[]}))};
 vm.runInContext("comparison.galactic=createGalacticLookup('')",c);
 assert.equal((await f.classify()).match.state,'new');assert.equal(c.comparison.galactic.connectionState,'participating');
});
const pairs=[['AUTUMNLANDS, VOL. 1 TP (Digital)','The Autumnlands Vol. 1'],['AUTUMNLANDS, VOL. 2 TP (Digital)','The Autumnlands Vol. 2'],['FREE AGENTS TP VOL 01 (Digital)','FREE AGENTS, VOL. 1']];
for(const [title,owned]of pairs)for(const history of [false,true])test(`current comic purchase retains Owned with book history=${history}: ${title}`,async()=>{
 const record={title:owned,kind:'comic',source:'humble',purchaseKey:'synthetic-purchase',providerItemId:'synthetic-product',entitlement:'direct-download',sourceBundle:'Original bundle',purchasedAt:'2022-12-25'};
 const historical={...record,kind:'book'};const before=JSON.stringify([record,historical]);
 const f=fixture([record],'book',{title},null,history?[historical]:[]);
 const {match}=await f.classify();assert.equal(match.state,'owned');assert.equal(match.item.title,owned);
 assert.equal(f.context.HumbleOwnership.presentation.candidateViews(f.context.offered,match)[0].access,'Purchased');
 assert.equal(JSON.stringify([record,historical]),before);
 const previous=fixture([],'book',{title},null,[historical]);assert.equal((await previous.classify()).match.ownershipReview,true);
});

test('availability timeout stays a failed check, never proof of absence',async()=>{
 const c=fixture([],'book',{title:'Timeout fixture'}).context;
 let expire,late,cleared=false;
 c.setTimeout=callback=>{expire=callback;return 1;};c.clearTimeout=()=>{cleared=true;};
 const pending=c.HumbleComicLibrary.galacticAvailability(()=>new Promise(resolve=>{late=resolve;}));
 expire();const result=await pending;
 assert.equal(result.state,'failed');assert.match(result.error,/30 seconds/);assert(cleared);
 late({ok:true,apiVersion:1});await Promise.resolve();assert.equal(result.state,'failed');
});

test('a receiver error message cannot impersonate the browser no-receiver result',async()=>{
 const c=fixture([],'book',{title:'Fixture'}).context;
 const result=await c.HumbleComicLibrary.galacticAvailability(async()=>({ok:false,error:'Could not establish connection. Receiving end does not exist.'}));
 assert.equal(result.state,'failed');
});
