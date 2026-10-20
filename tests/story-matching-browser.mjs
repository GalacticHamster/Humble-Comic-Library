// Disposable storefront integration: actual extraction, local matching, GL merge, badges and inspector.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';import {setTimeout as pause} from 'node:timers/promises';
import {chromePipe,firefoxMarionette,freePort} from './native-protocol.mjs';
const root=path.resolve(import.meta.dirname,'..'),hb=fs.existsSync(path.join(root,'ownership.js')),firefox=process.argv.includes('--firefox');
const {normalizeProviderItem,createEmptyDatabase}=await import('../../GalacticLibrary/src/lib/models.js');
const {handleExternalApiRequest}=await import('../../GalacticLibrary/src/lib/external-api.js');
const packageDir=fs.mkdtempSync(path.join(os.tmpdir(),'story-matching-package-'));
execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/package-release.ps1'),'-Target',firefox?'Firefox':'Chrome','-OutputDirectory',packageDir],{windowsHide:true,stdio:'pipe'});
const zip=path.join(packageDir,fs.readdirSync(packageDir).find(name=>name.endsWith('.zip'))),unpacked=path.join(packageDir,'unpacked');
const quote=value=>"'"+value.replaceAll("'","''")+"'";
execFileSync('powershell.exe',['-NoProfile','-Command','Expand-Archive -LiteralPath '+quote(zip)+' -DestinationPath '+quote(unpacked)],{windowsHide:true,stdio:'pipe'});
const packaged={files:new Map(fs.readdirSync(unpacked).filter(name=>fs.statSync(path.join(unpacked,name)).isFile()).map(name=>[name,fs.readFileSync(path.join(unpacked,name))]))};
const hush='Batman: Hush (New Edition) (Batman (1940-2011))',gotham='Batman: Detective Comics Vol. 1: Gotham Nocturne: Overture (Detective Comics (2016-))';
// Three extra volume variants are synthetic controls, not asserted live bundle titles.
const titles=[hush,'Batman: Dark Patterns (Batman: Dark Patterns (2024-))',gotham,'Batman: Detective Comics Vol. 4: Gotham Nocturne: Intermezzo (Detective Comics (2016-))',...[2,3,5].map(n=>gotham.replace('Vol. 1','Vol. '+n)),'Batman Vol. 4: Dark Prisons (Batman (2016-))','Batman Vol. 5: The Dying City (Batman (2016-))'];
const relevant=['Batman: Hush','Batman: Hush (New Edition)','Batman: The Complete Hush (Batman (1940-2011))'];
const unrelated=['Batman: The Long Halloween','Batman: R.I.P. (Batman by Grant Morrison series Book 4)',"Batman: No Man's Land Vol. 1: New Edition","Batman: No Man's Land Vol. 2: New Edition",'Batman: Gotham by Gaslight: New Edition (DC Elseworlds)','Batman: Year Two 30th Anniversary Deluxe Edition (Detective Comics (1937-2011))','Batman: Haunted Knight New Edition (Batman: Legends of the Dark Knight)','Batman: Arkham Asylum New Edition'];
const records=[...relevant,...unrelated].map((title,i)=>normalizeProviderItem({provider:'kindle',providerItemId:'synthetic-story-'+i,title,mediaType:'book',ownership:'owned'}));
const db={...createEmptyDatabase(),providerItems:Object.fromEntries(records.map(item=>[item.id,item]))};
const results=Object.fromEntries(titles.map(title=>{const {requestId,...result}=handleExternalApiRequest(db,{type:'MATCH_ITEMS',apiVersion:1,items:[{title,mediaType:'book'}]}).results[0];return [title,result];}));
const products=titles.map((name,i)=>({_id:'story-product-'+i+'-123456',name,type:'book'}));
const bundle={_id:'story-bundle-123456',name:'Synthetic Batman Bundle',slug:'stories',bundles:[{price:{USD:500},games:products}]};
const page={bundleData:{tier_order:['all'],tier_pricing_data:{all:{'price|money':{amount:5}}},tier_item_data:Object.fromEntries(products.map(p=>[p._id,{human_name:p.name}])),tier_display_data:{all:{tier_item_machine_names:products.map(p=>p._id)}}}};
const mock=`globalThis.badgeWrites=0;globalThis.badgeHold=true;const results=${JSON.stringify(results)};
globalThis.chrome={runtime:{id:'a'.repeat(32),getManifest:()=>({}),onMessage:{addListener(){}},sendMessage:async(first,second)=>{
 const m=second||first;
 if(m.type==='PING')return {ok:true,apiVersion:1};if(m.type==='GET_STATUS')return {ok:true,apiVersion:1,capabilities:{mediaTypes:['book']}};
 if(m.type==='GET_REMINDERS')return {ok:true,apiVersion:1,reminders:[],total:0,nextOffset:null};
 if(m.type==='FANATICAL_GET_PUBLIC_BUNDLE')return {ok:true,bundle:${JSON.stringify(bundle)}};
 if(m.type==='MATCH_ITEMS'){if(badgeHold)await new Promise(resolve=>{globalThis.badgeRelease=()=>{badgeHold=false;resolve();};});return {ok:true,apiVersion:1,results:m.items.map(q=>({...results[q.title],requestId:q.requestId}))};}
 return {ok:true};
}},storage:{local:{get:async defaults=>({...defaults,libraryItems:[],fanaticalLibraryItems:[],purchaseSummaries:[],customCollectionMappings:[],fanaticalScannedOrderFingerprints:[],galacticLibraryExtensionId:'b'.repeat(32)}),set:async()=>{badgeWrites++;}},onChanged:{addListener(){},removeListener(){}}}};`;
const files=hb?['theme.js','shared.js','collection-mappings.js','ownership.js','content.js']:['src/theme.js','src/shared.js','src/planning.js','src/planning-ui.js','src/content.js'];
const css=hb?'content.css':'src/content.css',urlPath=hb?'/books/stories':'/en/bundle/stories';
const server=http.createServer((req,res)=>{
 if(req.url===urlPath){res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><html><head><link rel="stylesheet" href="/'+css+'"></head><body><h1>Synthetic Games Bundle</h1><main><section data-tier="5">'+products.map((p,i)=>hb?'<article class="product" data-index="'+i+'"><img class="item-image" alt="'+p.name+'"><h3>'+p.name+'</h3></article>':'<article class="bundle-product-card" data-index="'+i+'"><div class="cover-container"><img alt="'+p.name+'"></div><h3 class="card-product-name">'+p.name+'</h3></article>').join('')+'</section></main><script id="webpack-bundle-page-data" type="application/json">'+JSON.stringify(page)+'</script><script src="/mock.js"></script>'+files.map(f=>'<script src="/'+f+'"></script>').join('')+'</body></html>');return;}
 if(req.url==='/mock.js'){res.setHeader('content-type','text/javascript');res.end(mock);return;}
 const name=req.url.slice(1);if(!packaged.files.has(name)){res.writeHead(404).end();return;}res.setHeader('content-type',name.endsWith('.css')?'text/css':'text/javascript');res.end(packaged.files.get(name));
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
 await wait('Boolean(globalThis.badgeRelease)');
 check(await evaluate('document.querySelectorAll('+JSON.stringify(badge)+').length')===titles.length,'Local phase renders all cards while GL is pending');
 await evaluate('badgeRelease()');await wait(label(0)+'.includes("Possible")');
 for(let i=1;i<titles.length;i++) {await wait(label(i)+'=== "New"');check(await evaluate(label(i))==='New',titles[i]+' remains New');}
 check((await evaluate(label(0))).includes('Possible'),'Hush keeps its legitimate alternative-edition warning');
 await evaluate('document.querySelector('+JSON.stringify(selector(0))+').click()');await wait('Boolean(document.querySelector("dialog[open]"))');
 const details=await evaluate('document.querySelector("dialog").textContent');
 for(const title of relevant)check(details.includes(title),'Inspector identifies '+title);
 for(const title of unrelated)check(!details.includes(title),'Inspector excludes '+title);
 check(await evaluate('badgeWrites')===0,'Read-only badge classification does not save library data');
 console.log(JSON.stringify({browser:firefox?'Firefox':'Chrome',companion:hb?'HB':'FAN',packaged:true,checks,passed:true}));

}finally{child?.kill();await pause(300);await new Promise(resolve=>server.close(resolve));const target=path.resolve(profile),base=path.resolve(os.tmpdir());if(!target.startsWith(base+path.sep)||!path.basename(target).startsWith('purchased-owned-ui-'))throw Error('Unsafe disposable profile cleanup');fs.rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});if(!path.resolve(packageDir).startsWith(base+path.sep)||!path.basename(packageDir).startsWith('story-matching-package-'))throw Error('Unsafe package cleanup');fs.rmSync(packageDir,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
