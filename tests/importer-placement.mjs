// Installed Chrome check of where the Library sync and the retired purchase importer appear on
// Humble's redesigned account pages. Synthetic pages are served for www.humblebundle.com through
// request interception; no network or account is used. Screenshots go to ignored audit-artifacts.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,rm,access,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {setTimeout as pause} from 'node:timers/promises';
import {chromePipe} from './native-protocol.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let binary;for(const candidate of [process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean))try{await access(candidate);binary=candidate;break;}catch{}
if(!binary)throw Error('Set CHROME_BIN to run the installed placement check.');
const temporary=await mkdtemp(join(tmpdir(),'hcl-placement-')),stage=join(temporary,'extension'),profile=join(temporary,'profile');await mkdir(stage);await mkdir(profile);
const shots=join(root,'audit-artifacts','importer-placement');await mkdir(shots,{recursive:true});
// A redesigned Humble account page: promotional banner, site header with navigation, then content.
// Navigation links change the route in place, as Humble's client-side router does.
const page=title=>`<!doctype html><html><head><meta charset="utf-8"><script src="/_next/static/chunks/app.js"></script><style>body{margin:0;background:#1c1f2b;color:#fff;font:16px sans-serif}#promo{height:110px;background:#4b2f7a;display:flex;align-items:center;justify-content:center}header{height:90px;display:flex;align-items:center;gap:2rem;padding:0 2rem;border-bottom:1px solid #444}header a{color:#fff}main{padding:2rem}</style></head>
<body><div id="promo">Promotional banner</div><header><strong>Humble</strong><nav><a id="nav-library" href="/home/library">Library</a> <a id="nav-orders" href="/home/purchases">Order History</a></nav></header><main id="main-content"><h1>${title}</h1><p>Humble page content.</p></main>
<script>document.addEventListener('click',e=>{const a=e.target.closest('header a');if(!a)return;e.preventDefault();history.pushState({},'',a.getAttribute('href'));document.querySelector('h1').textContent=a.textContent+' content';});</script></body></html>`;
let child,checks=[];
try{
  const archive=process.env.HB_RUNTIME_PACKAGE??(()=>{execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts/package-release.ps1'),'-Target','Chrome','-OutputDirectory',temporary],{windowsHide:true,stdio:'pipe'});const {version}=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8'));return join(temporary,`Humble-Comic-Library-${version}.zip`);})();
  execFileSync('powershell.exe',['-NoProfile','-Command','Expand-Archive -LiteralPath $env:Z -DestinationPath $env:D -Force'],{windowsHide:true,env:{...process.env,Z:archive,D:stage}});
  child=spawn(binary,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',`--user-data-dir=${profile}`,'--remote-debugging-pipe','--enable-unsafe-extension-debugging','about:blank'],{windowsHide:true,stdio:['ignore','pipe','pipe','pipe','pipe']});
  const driver=chromePipe(child);await driver.send('Extensions.loadUnpacked',{path:stage});
  const target=await driver.send('Target.createTarget',{url:'about:blank'}),{sessionId}=await driver.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  driver.on(event=>{if(event.method!=='Fetch.requestPaused'||event.sessionId!==sessionId)return;const url=new URL(event.params.request.url);
    const body=url.pathname==='/home/library'?page('Library content'):url.pathname==='/home/purchases'?page('Order History content'):'';
    driver.send('Fetch.fulfillRequest',{requestId:event.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:url.pathname.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'}],body:Buffer.from(body).toString('base64')},sessionId).catch(()=>{});});
  await driver.send('Fetch.enable',{patterns:[{urlPattern:'https://www.humblebundle.com/*'}]},sessionId);await driver.send('Page.enable',{},sessionId);
  const evaluate=async expression=>(await driver.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId)).result.value;
  const state=()=>evaluate(`({first:document.body.firstElementChild?.id??null,sync:document.querySelectorAll('#hcl-library-sync').length,importer:document.querySelectorAll('#hcl-importer').length,retired:Boolean(document.querySelector('#hcl-importer.hcl-importer-retired')),importButtons:document.querySelectorAll('#hcl-importer [data-import-mode], #hcl-importer button[data-import-mode]').length,link:document.querySelector('#hcl-importer a.hcl-importer-link')?.getAttribute('href')??null,syncText:document.querySelector('#hcl-library-sync')?.textContent.slice(0,40)??null,promoBelow:(()=>{const s=document.querySelector('#hcl-library-sync, #hcl-importer');return s?document.querySelector('#promo').getBoundingClientRect().top>=s.getBoundingClientRect().bottom-1:null;})(),position:(()=>{const s=document.querySelector('#hcl-library-sync, #hcl-importer');return s?getComputedStyle(s).position:null;})()})`);
  const until=async test=>{let value;for(let n=0;n<200;n++){value=await state().catch(()=>undefined);if(value&&test(value))return value;await pause(50);}return value??{};};
  const shot=async name=>{for(const width of [1280,600]){await driver.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},sessionId);await pause(300);const image=await driver.send('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(join(shots,`chrome-${name}-${width}.png`),Buffer.from(image.data,'base64'));}};
  // Direct loads.
  await driver.send('Page.navigate',{url:'https://www.humblebundle.com/home/library'},sessionId);
  let s=await until(v=>v.sync===1);
  assert.deepEqual([s.first,s.sync,s.importer,s.promoBelow,s.position],['hcl-library-sync',1,0,true,'static'],JSON.stringify(s));checks.push('direct /home/library: one Library sync section, first in the document, above the banner and header');
  await shot('library');
  await driver.send('Page.navigate',{url:'https://www.humblebundle.com/home/purchases'},sessionId);
  s=await until(v=>v.importer===1);
  assert.deepEqual([s.first,s.importer,s.sync,s.retired,s.importButtons,s.link,s.promoBelow],['hcl-importer',1,0,true,0,'/home/library',true],JSON.stringify(s));checks.push('direct /home/purchases: one notice, first in the document, no import buttons, links to Humble Library');
  await shot('purchases');
  // In-page navigation between the two pages, both ways, twice.
  for(let round=0;round<2;round++){
    await evaluate(`document.querySelector('#nav-library').click()`);s=await until(v=>v.sync===1&&v.importer===0);
    assert.deepEqual([s.first,s.sync,s.importer],['hcl-library-sync',1,0],JSON.stringify(s));
    await evaluate(`document.querySelector('#nav-orders').click()`);s=await until(v=>v.importer===1&&v.sync===0);
    assert.deepEqual([s.first,s.importer,s.sync,s.importButtons],['hcl-importer',1,0,0],JSON.stringify(s));
  }
  checks.push('in-page navigation Library <-> Order History swaps the sections; each appears once, first in the document');
  for(const check of checks)console.log('PASS installed Chrome: '+check);console.log(`${checks.length} installed placement checks passed. Screenshots: ${shots}`);
}finally{child?.kill();await pause(300);await rm(temporary,{recursive:true,force:true}).catch(()=>{});}
