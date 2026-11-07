import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';
import {chromePipe,firefoxMarionette,freePort} from './native-protocol.mjs';
const root=path.resolve(import.meta.dirname,'..'),hb=fs.existsSync(path.join(root,'ownership.js'));
const firefox=process.argv.includes('--firefox'),baseline=process.argv.find(v=>v.startsWith('--baseline='))?.slice(11),phase=baseline?'before':'after';
const output=path.join(root,'audit-artifacts/bundle-match-context-v2');fs.mkdirSync(output,{recursive:true});
// Minimal synthetic expected summary and protocol trace, independent of local audit output.
const expected=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/bundle-context-summary.json'),'utf8'));assert.equal(expected.fixtureVersion,2);
const original='Beneath the Trees Where Nobody Sees',sequel=original+': Rite of Spring';
const products=[original,sequel,'Independent New Story'].map((name,i)=>({_id:'context-product-'+i,name,type:'book'}));
const raw={_id:'context-bundle',name:'Synthetic Comics Bundle',slug:'context-fixture',bundles:[{price:{USD:500},games:products}]};
const page={bundleData:{tier_order:['all'],tier_pricing_data:{all:{'price|money':{amount:5}}},tier_item_data:Object.fromEntries(products.map(p=>[p._id,{human_name:p.name}])),tier_display_data:{all:{tier_item_machine_names:products.map(p=>p._id)}}}};
const strong={provider:'kindle',title:original,itemRef:'original-record',ownership:'owned',relationship:'same-edition',reason:'Matching full book title with no conflicting identity evidence'};
const weak={...strong,relationship:'same-work',reason:'Related title or edition; compare the owned and offered titles.'};
const subscription={...strong,title:sequel,itemRef:'subscription-record',ownership:'subscription'};
const files=hb?['shared.js','collection-mappings.js','ownership.js','content.js']:['src/shared.js','src/planning.js','src/planning-ui.js','src/content.js'];const css=hb?'content.css':'src/content.css';
const mock=`globalThis.fixtureWrites=0;globalThis.fixtureRequests=[];globalThis.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));
const values={libraryItems:[],purchaseSummaries:[],customCollectionMappings:[],fanaticalLibraryItems:[],galacticLibraryExtensionId:'b'.repeat(32)};
globalThis.chrome={storage:{local:{get:async d=>({...d,...Object.fromEntries(Object.keys(d).filter(k=>k in values).map(k=>[k,values[k]]))}),set:async changes=>{fixtureWrites++;Object.assign(values,changes);}},onChanged:{addListener(){}}},runtime:{id:'a'.repeat(32),getURL:x=>x,sendMessage:async(first,second)=>{const m=second||first;fixtureRequests.push(m.type);if(m.type==='PING')return {ok:true,apiVersion:1};if(m.type==='GET_STATUS')return {ok:true,apiVersion:1,capabilities:{mediaTypes:['book','game','software','audiobook'],entitlementReminders:true}};if(m.type==='GET_REMINDERS')return {ok:true,apiVersion:1,reminders:[],nextOffset:null};if(m.type==='FANATICAL_GET_PUBLIC_BUNDLE')return {ok:true,bundle:${JSON.stringify(raw)}};if(m.type==='MATCH_ITEMS')return {ok:true,apiVersion:1,results:m.items.map(item=>({requestId:item.requestId,matches:item.title===${JSON.stringify(original)}?[${JSON.stringify(strong)}]:[],possibleMatches:item.title===${JSON.stringify(sequel)}?[${JSON.stringify(subscription)},${JSON.stringify(weak)}]:[],partialMatches:[]}))};return {ok:true};}}};`;
const cards=products.map((p,i)=>hb?`<article class="product" data-context-index="${i}"><img class="item-image" alt="${p.name}"><h3>${p.name}</h3></article>`:`<article class="bundle-product-card" data-context-index="${i}" data-product-id="${p._id}"><div class="cover-container"><img alt="${p.name}"></div><h2 class="card-product-name">${p.name}</h2></article>`).join('');
const html=`<!doctype html><meta charset="utf-8"><title>Synthetic Comics Bundle</title><link rel="stylesheet" href="/${css}"><style>body{background:#292d34;color:white;font:14px Arial}section.catalogue{display:flex;gap:20px;flex-wrap:wrap}article{width:240px;position:relative;min-height:360px}img{display:block;width:240px;height:260px;background:#425769}.cover-container{height:260px;overflow:hidden}</style><h1>Comics Bundle: Synthetic</h1><section class="catalogue" data-tier="5"><h2>Pay $5</h2>${cards}</section>${hb?'<script id="webpack-bundle-page-data" type="application/json">'+JSON.stringify(page)+'</script>':''}<script>${mock}</script>${files.map(f=>'<script src="/'+f+'"></script>').join('')}`;
const route=hb?'/books/context-fixture':'/en/bundle/context-fixture';
const server=http.createServer((req,res)=>{if(req.url===route){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}const name=req.url.slice(1);if(!files.includes(name)&&name!==css){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'application/javascript');const source=baseline&&files.includes(name)?execFileSync('git',['show',baseline+':'+name],{cwd:root,encoding:'utf8',windowsHide:true}):fs.readFileSync(path.join(root,name),'utf8');res.end(source);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}${route}`;
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'bundle-context-ui-'));let child,protocol,session;
try{
 if(firefox){const appRoot=execFileSync('powershell.exe',['-NoProfile','-Command','(Get-AppxPackage -Name Mozilla.Firefox).InstallLocation'],{encoding:'utf8',windowsHide:true}).trim();const binary=process.env.FIREFOX_BIN||path.join(appRoot,'VFS/ProgramFiles/Firefox Package Root/firefox.exe');const port=await freePort();fs.writeFileSync(path.join(profile,'user.js'),`user_pref("marionette.port",${port});user_pref("browser.shell.checkDefaultBrowser",false);`);child=spawn(binary,['--headless','--no-remote','--profile',profile,'--marionette','about:blank'],{windowsHide:true,stdio:'ignore'});protocol=await firefoxMarionette(port);await protocol.send('WebDriver:NewSession',{});await protocol.send('WebDriver:Navigate',{url});}
 else{child=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-pipe','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','ignore','pipe','pipe']});protocol=chromePipe(child);const {targetInfos}=await protocol.send('Target.getTargets');({sessionId:session}=await protocol.send('Target.attachToTarget',{targetId:targetInfos.find(t=>t.type==='page').targetId,flatten:true}));await protocol.send('Page.enable',{},session);await protocol.send('Page.navigate',{url},session);}
 const evaluate=async expression=>{if(firefox)return (await protocol.send('WebDriver:ExecuteScript',{script:'return '+expression,args:[]})).value;const r=await protocol.send('Runtime.evaluate',{expression,returnByValue:true},session);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const badgeSelector=hb?'.hcl-status-button':'[data-fanatical-library-for]';
 let ready=false;for(let n=0;n<100;n++){if(await evaluate(`document.querySelectorAll('${badgeSelector}').length===3 && [...document.querySelectorAll('${badgeSelector}')].some(b=>b.textContent==='Check ownership')`)){ready=true;break;}await pause(100);}
 assert(ready,'Production matching failed: '+JSON.stringify(await evaluate('({errors:fixtureErrors,requests:fixtureRequests,text:document.body.innerText})')));
 const summarySelector=hb?'#hcl-summary':'[data-fanatical-library-summary]';
 const badges=await evaluate(`Array.from(document.querySelectorAll('${badgeSelector}'),b=>b.textContent).sort()`);assert.deepEqual(badges,['Check ownership','New',hb?'Owned elsewhere':'Owned elsewhere \u2014 Kindle'].sort());
 const summary=await evaluate(`document.querySelector('${summarySelector}').textContent`);
 const summaryBasis=await evaluate(`(()=>{const clone=document.querySelector('${summarySelector}').cloneNode(true);clone.querySelectorAll('.hcl-related-titles,.fanatical-library-related-titles').forEach(n=>n.remove());return clone.textContent;})()`);assert.match(summary,/new|New/);assert.match(summary,/5\.00/);
 await evaluate(`document.querySelector('[data-context-index="1"] ${badgeSelector}').click()`);await pause(100);
 const dialog=await evaluate(`(()=>{const d=document.querySelector('dialog'),t=d.querySelector('details');return {primary:Array.from(d.querySelectorAll('.library-ui-candidates:not(.library-ui-deferred-candidates) .library-ui-candidate strong'),v=>v.textContent),collapsed:!t.open,visible:d.innerText,text:d.textContent,overflow:d.scrollWidth>d.clientWidth+1};})()`);
 assert(dialog.collapsed);assert(!dialog.overflow);assert.match(dialog.visible,/Subscription access/);
 assert.deepEqual(dialog.primary,baseline?[sequel,original]:[sequel]);
 if(!baseline){assert.match(dialog.text,/More closely matches another item in this bundle:/);assert(!dialog.visible.includes('More closely matches another item in this bundle:'));}
 const capture=async suffix=>{const r=firefox?await protocol.send('WebDriver:TakeScreenshot',{}):await protocol.send('Page.captureScreenshot',{format:'png'},session);fs.writeFileSync(path.join(output,`${phase}-${firefox?'firefox':'chrome'}-${suffix}.png`),Buffer.from(firefox?r.value:r.data,'base64'));};
 await capture('primary');await evaluate('document.querySelector("dialog details").open=true');await pause(80);await capture('details');
 const visibleDetails=await evaluate('document.querySelector("dialog").innerText');if(!baseline){assert.match(visibleDetails,/More closely matches another item in this bundle:/);assert.match(visibleDetails,new RegExp(original));}
 assert.equal(await evaluate('fixtureWrites'),0);
 assert.equal(await evaluate("fixtureRequests.filter(t=>t==='MATCH_ITEMS').length"),1);
 const result={repo:hb?'HB':'FAN',browser:firefox?'Firefox':'Chrome',phase,badges,summary,summaryBasis,dialog,requests:await evaluate('fixtureRequests'),writes:0};
 fs.writeFileSync(path.join(output,`${phase}-${firefox?'firefox':'chrome'}.json`),JSON.stringify(result,null,2));
 if(!baseline){assert.equal(summaryBasis,expected.summaryBasis,'Summary/count/pricing changed outside intended candidate captions');assert.deepEqual(result.requests,expected.requests,'Discovery/matching protocol trace changed');}
 console.log(`${result.repo} ${result.browser} ${phase}: real production bundle render, badges, primary/details, no writes/additional lookups, identical summary pricing passed`);
}finally{protocol?.close?.();child?.kill();await new Promise(r=>server.close(r));await pause(300);if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir())||!path.basename(profile).startsWith('bundle-context-ui-'))throw Error('Unsafe disposable profile cleanup');fs.rmSync(profile,{recursive:true,force:true,maxRetries:6,retryDelay:300});}
