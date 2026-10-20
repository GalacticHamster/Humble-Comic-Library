// Disposable storefront integration: actual extraction, local matching, GL merge, badges and inspector.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';import {setTimeout as pause} from 'node:timers/promises';
import {chromePipe,firefoxMarionette,freePort} from './native-protocol.mjs';
const root=path.resolve(import.meta.dirname,'..'),hb=fs.existsSync(path.join(root,'ownership.js')),firefox=process.argv.includes('--firefox');
const title='Synthetic Space Adventure',external='Independent External Game',fresh='Unpurchased New Game';
const products=[title,external,fresh,'Cat Quest III','Portal 2'].map((name,i)=>({_id:'ownership-product-'+i+'-123456',name,type:'game'}));
const bundle={_id:'ownership-bundle-123456',name:'Synthetic Games Bundle',slug:'ownership',bundles:[{price:{USD:500},games:products}]};
const page={bundleData:{tier_order:['all'],tier_pricing_data:{all:{'price|money':{amount:5}}},tier_item_data:Object.fromEntries(products.map(p=>[p._id,{human_name:p.name}])),tier_display_data:{all:{tier_item_machine_names:products.map(p=>p._id)}}}};
const local={title,kind:'game',mediaType:'game',source:hb?'humble':'fanatical',sourceItemId:products[0]._id,purchaseKey:'synthetic-order',entitlement:'third-party-key',keyStatus:'unrevealed'};
const saved=[local,{...local,title:'Cat Quest II',sourceItemId:'older-cat'},{...local,title:'Portal',sourceItemId:'original-portal'}];
const mock=`globalThis.badgeRequests=[];globalThis.badgeWrites=0;globalThis.badgeMode='marketplace';globalThis.badgeHold=true;
const listeners=[];const values={libraryItems:${JSON.stringify(saved)},fanaticalLibraryItems:${JSON.stringify(saved)},purchaseSummaries:[],customCollectionMappings:[],fanaticalScannedOrderFingerprints:[],galacticLibraryExtensionId:'b'.repeat(32)};
globalThis.badgeInitial=JSON.stringify([values.libraryItems,values.fanaticalLibraryItems]);
const platform=title=>({provider:'steam',title,ownership:'owned',relationship:'same-edition',confidence:1,itemRef:'opaque-item',evidence:{}});
globalThis.chrome={runtime:{id:'a'.repeat(32),getManifest:()=>({}),onMessage:{addListener(){}},sendMessage:async(first,second)=>{
 const m=second||first;badgeRequests.push(m);
 if(m.type==='PING')return {ok:true,apiVersion:1};if(m.type==='GET_STATUS')return {ok:true,apiVersion:1,capabilities:{mediaTypes:['game','book','audiobook']}};
 if(m.type==='GET_REMINDERS')return {ok:true,apiVersion:1,reminders:[],total:0,nextOffset:null};
 if(m.type==='FANATICAL_GET_PUBLIC_BUNDLE')return {ok:true,bundle:${JSON.stringify(bundle)}};
 if(m.type==='MATCH_ITEMS'){
  if(badgeHold)await new Promise(resolve=>{globalThis.badgeRelease=()=>{badgeHold=false;resolve();};});
  if(badgeMode==='failed')throw Error('Synthetic established lookup failure');
  return {ok:true,apiVersion:1,results:m.items.map(q=>{let matches=[],possibleMatches=[],partialMatches=[];
   if(q.title===${JSON.stringify(external)})matches=[platform(q.title)];
   if(q.title==='Cat Quest III'){matches=[platform('Cat Quest II')];possibleMatches=[platform('Cat Quest II')];}
   if(q.title===${JSON.stringify(title)}){
    const copy=platform(q.title),market={...copy,provider:${JSON.stringify(hb?'fanatical':'humble')},evidence:{purchaseEvidence:'confirmed',activationStatus:'unknown'}};
    matches=[market,{...market,provider:${JSON.stringify(hb?'humble':'fanatical')}}];
    if(badgeMode==='platform')matches.push(copy);
    if(badgeMode==='possible')possibleMatches=[copy];if(badgeMode==='partial')partialMatches=[copy];
    if(badgeMode==='subscription')matches.push({...copy,ownership:'subscription'});
   }return {requestId:q.requestId,matches,possibleMatches,partialMatches,coverage:null};})};
 }
 return {ok:true};
}},storage:{local:{get:async defaults=>structuredClone({...defaults,...Object.fromEntries(Object.keys(defaults||{}).filter(k=>k in values).map(k=>[k,values[k]]))}),set:async changes=>{badgeWrites++;Object.assign(values,changes);listeners.forEach(fn=>fn(Object.fromEntries(Object.entries(changes).map(([k,v])=>[k,{newValue:v}])),'local'));}},onChanged:{addListener:fn=>listeners.push(fn),removeListener:fn=>{const i=listeners.indexOf(fn);if(i>=0)listeners.splice(i,1);}}}};
globalThis.badgeRecheck=mode=>{badgeMode=mode;listeners.forEach(fn=>fn({galacticLibraryExtensionId:{newValue:values.galacticLibraryExtensionId}},'local'));};
globalThis.badgeDataIntact=()=>JSON.stringify([values.libraryItems,values.fanaticalLibraryItems])===badgeInitial;
`;
const files=hb?['theme.js','shared.js','collection-mappings.js','ownership.js','content.js']:['src/theme.js','src/shared.js','src/planning.js','src/planning-ui.js','src/content.js'];
const css=hb?'content.css':'src/content.css',urlPath=hb?'/games/ownership':'/en/bundle/ownership';
const server=http.createServer((req,res)=>{
 if(req.url===urlPath){res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><html><head><link rel="stylesheet" href="/'+css+'"></head><body><h1>Synthetic Games Bundle</h1><main><section data-tier="5">'+products.map((p,i)=>hb?'<article class="product" data-index="'+i+'"><img class="item-image" alt="'+p.name+'"><h3>'+p.name+'</h3></article>':'<article class="bundle-product-card" data-index="'+i+'"><div class="cover-container"><img alt="'+p.name+'"></div><h3 class="card-product-name">'+p.name+'</h3></article>').join('')+'</section></main><script id="webpack-bundle-page-data" type="application/json">'+JSON.stringify(page)+'</script><script src="/mock.js"></script>'+files.map(f=>'<script src="/'+f+'"></script>').join('')+'</body></html>');return;}
 if(req.url==='/mock.js'){res.setHeader('content-type','text/javascript');res.end(mock);return;}
 const f=path.resolve(root,'.'+req.url);if(!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.writeHead(404).end();return;}res.setHeader('content-type',f.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(f));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'purchased-owned-ui-'));let child,driver,session,checks=0;
try{
 const store=firefox&&process.platform==='win32'?execFileSync('powershell.exe',['-NoProfile','-Command','(Get-AppxPackage -Name Mozilla.Firefox).InstallLocation'],{windowsHide:true,encoding:'utf8'}).trim():'';
 const candidates=firefox?[process.env.FIREFOX_BIN,'C:/Program Files/Mozilla Firefox/firefox.exe',...(store?[path.join(store,'VFS/ProgramFiles/Firefox Package Root/firefox.exe')]:[])]:[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'];
 const binary=candidates.filter(Boolean).find(value=>fs.existsSync(value));if(!binary)throw Error('Set '+(firefox?'FIREFOX_BIN':'CHROME_BIN')+' to run the disposable UI check.');
 if(firefox){const port=await freePort();fs.writeFileSync(path.join(profile,'user.js'),'user_pref("marionette.port", '+port+');\nuser_pref("browser.shell.checkDefaultBrowser", false);\n');child=spawn(binary,['--headless','--no-remote','--profile',profile,'--marionette','--remote-allow-system-access','about:blank'],{windowsHide:true,stdio:['ignore','pipe','pipe']});driver=await firefoxMarionette(port);await driver.send('WebDriver:NewSession',{capabilities:{alwaysMatch:{browserName:'firefox'}}});}
 else{child=spawn(binary,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--user-data-dir='+profile,'--remote-debugging-pipe','about:blank'],{windowsHide:true,stdio:['ignore','pipe','pipe','pipe','pipe']});driver=chromePipe(child);const targets=await driver.send('Target.getTargets');session=(await driver.send('Target.attachToTarget',{targetId:targets.targetInfos.find(x=>x.type==='page').targetId,flatten:true})).sessionId;}
 child.stdout?.resume();child.stderr?.resume();const url='http://127.0.0.1:'+server.address().port+urlPath;
 if(firefox)await driver.send('WebDriver:Navigate',{url});else await driver.send('Page.navigate',{url},session);
 const evaluate=async expression=>{if(firefox){const r=await driver.send('WebDriver:ExecuteScript',{script:'return '+expression,args:[]});return r.value??r;}const r=await driver.send('Runtime.evaluate',{expression,returnByValue:true},session);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await pause(30);}throw Error('Did not settle: '+expression+' '+await evaluate('document.body.innerText'));};
 const badge=hb?'.hcl-status-button':'[data-fanatical-library-for]',selector=i=>'[data-index="'+i+'"] '+badge;
 const label=i=>'document.querySelector('+JSON.stringify(selector(i))+')?.textContent';const check=(condition,message)=>{assert(condition,message);checks++;};
 await wait('Boolean(globalThis.badgeRelease)');check(await evaluate(label(0))==='Purchased','Local-first key purchase badge');await evaluate('badgeRelease()');
 await wait(label(1)+'.startsWith("Owned elsewhere")');check(await evaluate(label(0))==='Purchased','Marketplace copies do not establish ownership');check(await evaluate(label(2))==='New','No purchase and no ownership remains New');
 check(await evaluate(label(3))==='New','Cat Quest III rejects local and central Cat Quest II evidence');
 check(await evaluate(label(4))==='New','Portal 2 does not match the original Portal');
 const advanced=hb?'.hcl-advanced':'.fanatical-library-advanced';await evaluate('(()=>{document.querySelector('+JSON.stringify(advanced)+').open=true;return true;})()');
 for(const [mode,expected]of [['platform','Owned'],['possible','Purchased'],['partial','Purchased'],['subscription','Purchased'],['failed','Purchased'],['platform','Owned']]){
  await evaluate('badgeRecheck('+JSON.stringify(mode)+')');await pause(450);await wait(label(0)+'==='+JSON.stringify(expected));
  check(await evaluate(label(0))===expected,mode+' final badge');check(await evaluate('document.querySelector('+JSON.stringify(advanced)+').open'),mode+' preserves Advanced disclosure');
  check(await evaluate('document.querySelectorAll('+JSON.stringify(selector(0))+').length')===1,mode+' no duplicate badge');
 }
 await evaluate('document.querySelector('+JSON.stringify(selector(0))+').click()');await wait('Boolean(document.querySelector("dialog[open]"))');const details=await evaluate('document.querySelector("dialog").textContent');
 check(details.includes('independently confirms ownership')&&details.includes('Steam'),'Explanation includes independent platform evidence');check(details.includes('Purchased key'),'Original key purchase evidence remains separate');
 check(await evaluate('badgeDataIntact()'),'No saved purchase observations changed');check(await evaluate('badgeWrites')===0,'No storage writes for badge reconciliation');
 console.log(JSON.stringify({browser:firefox?'Firefox':'Chrome',companion:hb?'HB':'FAN',checks,passed:true}));
}finally{child?.kill();await pause(300);await new Promise(resolve=>server.close(resolve));const target=path.resolve(profile),base=path.resolve(os.tmpdir());if(!target.startsWith(base+path.sep)||!path.basename(target).startsWith('purchased-owned-ui-'))throw Error('Unsafe disposable profile cleanup');fs.rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
