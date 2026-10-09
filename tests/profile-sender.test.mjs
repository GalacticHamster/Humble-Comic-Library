import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../shared.js';
import '../collection-mappings.js';

test('account selection and rename accept only own settings or Humble purchase pages',async()=>{
  const H=globalThis.HumbleComicLibrary,id='a'.repeat(32),state={...structuredClone(H.LIBRARY_STATE_DEFAULTS),humbleProfileLabel:'personal',profileArchives:[{profileLabel:'work',backup:H.createLibraryBackup({...H.LIBRARY_STATE_DEFAULTS,humbleProfileLabel:'work'})}]},listeners=[];
  const area={get:async defaults=>({...defaults,...structuredClone(state)}),set:async values=>Object.assign(state,structuredClone(values))};
  const context={HumbleComicLibrary:H,URL,chrome:{runtime:{id,getURL:()=> 'chrome-extension://'+id+'/',onMessageExternal:{addListener(){}},onMessage:{addListener:fn=>listeners.push(fn)}},storage:{local:area}}};vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../theme.js',import.meta.url),'utf8'),context);vm.runInContext(fs.readFileSync(new URL('../background.js',import.meta.url),'utf8'),context);
  const send=(operation,url,senderId=id)=>new Promise(resolve=>listeners[1]({type:'HCL_STORE',operation,args:[{profileLabel:'work',expectedActiveLabel:'personal',newLabel:'renamed',confirmed:true}]},{id:senderId,url},resolve));
  const before=structuredClone(state);
  for(const url of ['https://www.humblebundle.com/books/test','https://www.humblebundle.com.evil.test/home/purchases','https://other.example/home/purchases'])for(const operation of ['selectProfile','renameProfile']){const response=await send(operation,url);assert.equal(response.ok,false);assert.deepEqual(state,before);}
  assert.equal((await send('selectProfile','https://www.humblebundle.com/home/purchases','foreign')).ok,false);
  assert.equal((await send('selectProfile','chrome-extension://'+id+'/options.html')).ok,true);assert.equal(state.humbleProfileLabel,'work');
  const response=await new Promise(resolve=>listeners[1]({type:'HCL_STORE',operation:'renameProfile',args:[{profileLabel:'work',expectedActiveLabel:'work',newLabel:'business',confirmed:true}]},{id,url:'https://www.humblebundle.com/home/purchases',tab:{id:1}},resolve));assert.equal(response.ok,true);assert.equal(state.humbleProfileLabel,'business');
});
