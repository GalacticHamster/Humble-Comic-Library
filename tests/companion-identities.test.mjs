import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const product="HumbleComicLibrary";
function harness(saved='',firefox=false){
 const values={galacticLibraryExtensionId:saved,keep:'synthetic'},external=[],internal=[],opened=[];
 const runtime={id:'a'.repeat(32),getURL:()=>firefox?'moz-extension://synthetic/':'chrome-extension://synthetic/',getManifest:()=>({version:'1.0.2'}),onMessageExternal:{addListener:fn=>external.push(fn)},onMessage:{addListener:fn=>internal.push(fn)},openOptionsPage:async()=>opened.push(true)};
 const context={setTimeout,clearTimeout,URL,chrome:{runtime,storage:{local:{get:async defaults=>({...defaults,...values}),set:async updates=>Object.assign(values,updates),remove:async keys=>{for(const key of [].concat(keys))delete values[key];}}},tabs:{create:async()=>{}}},createSyncStore:()=>({execute:async()=>{}})};context.globalThis=context;vm.createContext(context);
 vm.runInContext(fs.readFileSync(new URL("../shared.js",import.meta.url),'utf8'),context);
 vm.runInContext(fs.readFileSync(new URL('../theme.js',import.meta.url),'utf8'),context);
 for(const file of ['purchase-snapshot.js', 'purchase-transfer.js', 'purchase-sync.js', 'purchase-adapters.js']) vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
 const F=context[product];if(product==='HumbleComicLibrary')vm.runInContext(fs.readFileSync(new URL('../entitlement-share.js',import.meta.url),'utf8'),context);
 vm.runInContext(fs.readFileSync(new URL("../background.js",import.meta.url),'utf8').replace(/^import .*;\r?\n/gmu,''),context);
 const send=(message,sender)=>new Promise(resolve=>{let handled=false;for(const fn of external)if(fn(message,sender,resolve)===true)handled=true;if(!handled)resolve(null);});return {F,runtime,values,opened,send,context};
}
test('official GL is automatic, manual override survives unchanged, clearing restores official target',async()=>{
 const custom='c'.repeat(32),h=harness(custom);const before=JSON.stringify(h.values);
 assert.equal(h.F.builtinGalacticId(h.runtime),'pdknncacndkicpogbebdfanniibnnpic');assert.equal(h.F.resolveGalacticId('',h.runtime),'pdknncacndkicpogbebdfanniibnnpic');assert.equal(h.F.resolveGalacticId(custom,h.runtime),custom);assert.equal(JSON.stringify(h.values),before);
 for(const id of [custom,h.F.builtinGalacticId(h.runtime)])assert.equal((await h.send({type:'PING',apiVersion:1},{id})).ok,true);
 assert.equal((await h.send({type:'PING',apiVersion:1},{id:'ieoobffekgbfjfoiheejkfihneooiadb'})).ok,false);
 assert.equal((await h.send({type:'PING',apiVersion:1},{id:'bjjpfofmcmiipeghcbhdfjedpldmkcii'})).ok,false);
 delete h.values.galacticLibraryExtensionId;assert.equal((await h.send({type:'PING'},{id:custom})).ok,false);assert.equal((await h.send({type:'PING'},{id:h.F.builtinGalacticId(h.runtime)})).ok,true);
});
test('built-in trust never permits external storage/import/library access and versions are enforced',async()=>{
 const h=harness(),id=h.F.builtinGalacticId(h.runtime);
 for(const type of ['GET_LIBRARY','MATCH_ITEMS','RESTORE_DATABASE','HCL_STORE','FANATICAL_STORE','FANATICAL_IMPORT_PURCHASES'])assert.equal(await h.send({type,apiVersion:1},{id}),null);
 assert.equal((await h.send({type:'OPEN_REVIEW',apiVersion:2},{id})).ok,false);assert.equal((await h.send({type:'PING',apiVersion:2},{id})).ok,false);assert.equal(h.opened.length,0);
 assert.equal((await h.send({type:'OPEN_REVIEW',apiVersion:1,url:'https://evil.test'},{id})).ok,true);assert.equal(h.opened.length,1);
});
test('Firefox retains independent stable identities and does not reinterpret saved Chrome override',async()=>{
 const h=harness('c'.repeat(32),true),id='galactic-library@galactichamster.com';assert.equal(h.F.builtinGalacticId(h.runtime),id);assert.equal(h.F.resolveGalacticId(h.values.galacticLibraryExtensionId,h.runtime),'c'.repeat(32));
 assert.equal((await h.send({type:'PING'},{id})).ok,true);assert.equal((await h.send({type:'PING'},{id:'pdknncacndkicpogbebdfanniibnnpic'})).ok,false);
 const chrome=harness();assert.match(chrome.F.companionTargetProblem(id,chrome.runtime),/not a Chrome target/);
});
test('status handshake handles compatible legacy capabilities, incompatible API and unavailable target',async()=>{
 const h=harness();assert.equal((await h.F.testGalacticLink(async()=>({ok:true,apiVersion:1,ready:true,appVersion:'older'}))).appVersion,'older');
 await assert.rejects(h.F.testGalacticLink(async()=>({ok:true,apiVersion:2})),/Incompatible/);
 await assert.rejects(h.F.testGalacticLink(async()=>{throw Error('Missing or disabled');}),/not verified|unavailable/);
});
