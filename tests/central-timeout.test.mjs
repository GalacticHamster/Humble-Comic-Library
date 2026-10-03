import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

test('central lookup has a finite large-library deadline, rejects late results, and recovers on retry', async () => {
  const timers=new Map();let nextTimer=0,finishLate;
  const context={URL,Blob,Promise,console,performance:{now:()=>0},location:{pathname:'/'},document:{title:'',querySelector:()=>null},
    setTimeout:(callback,ms)=>{const id=++nextTimer;timers.set(id,{callback,ms});return id;},clearTimeout:id=>timers.delete(id),
    chrome:{runtime:{sendMessage:()=>new Promise(resolve=>{finishLate=resolve;})}}};
  context.globalThis=context;vm.createContext(context);
  for(const file of ['shared.js','collection-mappings.js','ownership.js','content.js'])vm.runInContext(fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8'),context,{filename:file});
  vm.runInContext("showComparisonProgress=()=>{};comparison={job:1,galactic:createGalacticLookup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')};records=[{item:{title:'Slow book',kind:'book'},match:{state:'new'}}]",context);
  const pending=vm.runInContext("queryGalacticLibrary(records,'book',comparison,1)",context);
  const deadline=[...timers.values()][0];
  assert.equal(deadline.ms,30000);
  deadline.callback();await pending;
  const lookup=context.comparison.galactic;
  assert.match(lookup.error,/within 30 seconds/u);
  assert.equal(lookup.resultsByKey.size,0);
  assert.equal(lookup.failuresByKey.size,1);
  assert.equal(lookup.inFlightKeys.size,0);
  assert.equal(lookup.inFlight,null);
  assert.equal(timers.size,0);
  finishLate({ok:true,apiVersion:1,results:[{requestId:'book:slow book',matches:[]}]});
  await Promise.resolve();await Promise.resolve();
  assert.equal(lookup.resultsByKey.size,0,'A response from a timed-out request cannot overwrite the settled result');
  context.chrome.runtime.sendMessage=async (_id,request)=>({ok:true,apiVersion:1,results:request.items.map(({requestId})=>({requestId,matches:[]}))});
  await vm.runInContext("queryGalacticLibrary(records,'book',comparison,1)",context);
  assert.equal(lookup.resultsByKey.size,1);
  assert.equal(lookup.failuresByKey.size,0);
  assert.equal(lookup.error,null);
  assert.equal(timers.size,0);
});
