import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
test('HB sends title-free sender/callback correlation without waiting for diagnostics or changing matching responses',async()=>{
  const sent=[];let clock=1000;
  const context={URL,Blob,Promise,console,performance:{timeOrigin:100000,now:()=>clock++},location:{pathname:'/'},document:{title:'',querySelector:()=>null},setTimeout,clearTimeout,
    chrome:{runtime:{sendMessage:async(_id,request)=>{sent.push(request);if(request.type==='MATCH_ITEMS_DIAGNOSTIC_CALLBACK')return new Promise(()=>{});return {ok:true,apiVersion:1,results:[],performance:{id:request.diagnosticLookupId}};}}}};
  context.globalThis=context;vm.createContext(context);
  for(const file of ['shared.js','collection-mappings.js','ownership.js','content.js'])vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),context,{filename:file});
  const response=await vm.runInContext("sendGalacticMatch('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',{type:'MATCH_ITEMS',apiVersion:1,items:[{title:'Synthetic title',mediaType:'book'}]})",context);
  assert.equal(response.ok,true);assert.equal(sent.length,2);assert.match(sent[0].diagnosticLookupId,/^lookup-[a-f0-9]{12}-\d{3,6}$/u);
  assert.ok(sent[1].diagnosticCallbackEpochMs>=sent[0].diagnosticSentEpochMs);assert.equal(sent[1].diagnosticLookupId,sent[0].diagnosticLookupId);
  assert.equal(JSON.stringify(sent[1]).includes('Synthetic title'),false);
  await vm.runInContext("globalThis.diagnostic={started:100000,ready:100010,storageMs:4,previousFlightMs:7,requests:[]}; sendGalacticMatch('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',{type:'MATCH_ITEMS',apiVersion:1,items:[{title:'Synthetic title',mediaType:'book'}]},diagnostic)",context);
  vm.runInContext("diagnostic.renderOutcome='rendered';finishGalacticRendering(diagnostic)",context);
  const prepared=sent.find(row=>row.diagnosticHb?.preparationMs===10),render=sent.find(row=>row.type==='MATCH_ITEMS_DIAGNOSTIC_RENDER');
  assert.equal(prepared.diagnosticHb.previousFlightMs,7);assert.equal(prepared.diagnosticHb.localStorageMs,4);
  assert.equal(render.diagnosticLookupId,prepared.diagnosticLookupId);assert.ok(render.diagnosticHb.postResponseMs>=0);assert.equal(render.diagnosticHb.renderOutcome,'rendered');
  assert.ok(!JSON.stringify(render).includes('Synthetic title'));
  // A diagnostic transport failure cannot change or reject matching/rendering.
  context.chrome.runtime.sendMessage=(_id,request)=>{if(request.type.startsWith('MATCH_ITEMS_DIAGNOSTIC'))throw Error('diagnostic transport failure');return Promise.resolve({ok:true,performance:{id:request.diagnosticLookupId}});};
  assert.equal((await vm.runInContext("sendGalacticMatch('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',{type:'MATCH_ITEMS',apiVersion:1,items:[]},diagnostic)",context)).ok,true);
  vm.runInContext('finishGalacticRendering(diagnostic)',context);
  context.chrome.runtime.sendMessage=async()=>({ok:true,results:[]});assert.equal((await vm.runInContext("sendGalacticMatch('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',{type:'MATCH_ITEMS',apiVersion:1,items:[]})",context)).ok,true);
});
