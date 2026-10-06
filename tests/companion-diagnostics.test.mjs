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
  context.chrome.runtime.sendMessage=async()=>({ok:true,results:[]});assert.equal((await vm.runInContext("sendGalacticMatch('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',{type:'MATCH_ITEMS',apiVersion:1,items:[]})",context)).ok,true);
});
