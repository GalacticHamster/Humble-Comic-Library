import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';
import {chromePipe,firefoxMarionette,freePort} from './native-protocol.mjs';
const root=path.resolve(import.meta.dirname,'..'), hb=fs.existsSync(path.join(root,'ownership.js'));
const firefox=process.argv.includes('--firefox'), phase=process.argv.includes('--before')?'before':'after';
const output=path.join(root,'audit-artifacts/matching-explanations');fs.mkdirSync(output,{recursive:true});
const offered={title:'30 Days of Night Deluxe Edition: Book One',kind:'book',mediaType:'book'};
const purchased={title:'30 Days of Night',provider:hb?'humble':'fanatical',source:hb?'humble':'fanatical',ownership:'owned',sourceBundle:'Comics Bundle: Anniversary Collection',bundle:{title:'Comics Bundle: Anniversary Collection'},purchasedAt:'2026-01-02T00:00:00Z',purchaseDate:'2026-01-02T00:00:00Z',purchaseKey:'synthetic-purchase',relationship:'same-work',reason:'Related complete base title with revision or version wording; identity needs review.'};
const temporary={title:offered.title,provider:'kindle',ownership:'subscription',itemRef:'synthetic-kindle-record',relationship:'same-edition',reason:'Matching full book title with no conflicting identity evidence',evidence:{source:'amazon-kindle-content-library',authors:['Steve Niles'],checkedAt:'2026-09-30T12:00:00Z'},verifiedAt:null};
const match={state:'possible',ownershipReview:true,offered,item:purchased,localMatch:{state:'possible',item:purchased},externalPossibleMatches:[temporary],externalResult:{matches:[],possibleMatches:[temporary],partialMatches:[]},possibleReason:'This exact title is in Galactic Library, but ownership is unconfirmed or access is temporary.'};
const files=hb?['shared.js','collection-mappings.js','ownership.js','content.js']:['src/shared.js','src/planning.js','src/content.js'];
const css=hb?'content.css':'src/content.css';
const mock=`globalThis.fixtureWrites=0;globalThis.chrome={runtime:{id:'a'.repeat(32),sendMessage:async()=>({ok:true}),getURL:x=>x},storage:{local:{get:async d=>d,set:async()=>{fixtureWrites++;}},onChanged:{addListener(){}}}};`;
const html=`<!doctype html><meta charset="utf-8"><title>Synthetic match explanation</title><link rel="stylesheet" href="/${css}"><style>body{background:#292d34;color:white;font:14px Arial}button{cursor:pointer}</style><button id="trigger">Explain match</button><script>${mock}</script>${files.map(f=>`<script src="/${f}"></script>`).join('')}<script>window.example=${JSON.stringify(match)};example.localMatch.item=example.item;document.querySelector('#trigger').onclick=()=>${hb?'showMatchInspector':'fixtureShowEvidence'}(example,document.querySelector('#trigger'));</script>`;
const server=http.createServer((req,res)=>{if(req.url.startsWith('/frame?')){const w=Number(new URL(req.url,'http://local').searchParams.get('width'));res.end(`<style>body{margin:0}</style><iframe style="border:0;width:${w}px;height:900px" src="/fixture"></iframe>`);return;}if(req.url==='/fixture'){res.end(html);return;}let name=decodeURIComponent(req.url.slice(1));if(!files.includes(name)&&name!==css){res.writeHead(404);res.end();return;}let text=fs.readFileSync(path.join(root,name),'utf8');if(!hb&&name==='src/content.js'){text=text.replace(/  schedule\(\);\r?\n\}\(\)\);/, '  globalThis.fixtureShowEvidence = showEvidence;\n}());');if(!text.includes('globalThis.fixtureShowEvidence'))throw Error('Test exposure failed');}res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'application/javascript');res.end(text);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/fixture`;
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'match-explanation-ui-'));let child,protocol,session;
try{
 if(firefox){const appRoot=execFileSync('powershell.exe',['-NoProfile','-Command','(Get-AppxPackage -Name Mozilla.Firefox).InstallLocation'],{encoding:'utf8',windowsHide:true}).trim();const binary=process.env.FIREFOX_BIN||path.join(appRoot,'VFS/ProgramFiles/Firefox Package Root/firefox.exe');const port=await freePort();fs.writeFileSync(path.join(profile,'user.js'),`user_pref("marionette.port",${port});user_pref("browser.shell.checkDefaultBrowser",false);`);child=spawn(binary,['--headless','--no-remote','--profile',profile,'--marionette','about:blank'],{windowsHide:true,stdio:'ignore'});protocol=await firefoxMarionette(port);await protocol.send('WebDriver:NewSession',{});await protocol.send('WebDriver:Navigate',{url});}
 else{child=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-pipe','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','ignore','pipe','pipe']});protocol=chromePipe(child);const {targetInfos}=await protocol.send('Target.getTargets');const target=targetInfos.find(t=>t.type==='page');({sessionId:session}=await protocol.send('Target.attachToTarget',{targetId:target.targetId,flatten:true}));await protocol.send('Page.enable',{},session);await protocol.send('Page.navigate',{url},session);}
 const evaluate=async expression=>{if(firefox)return (await protocol.send('WebDriver:ExecuteScript',{script:'return '+expression,args:[]})).value;const result=await protocol.send('Runtime.evaluate',{expression,returnByValue:true},session);if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
 for(let n=0;n<100;n++){if(await evaluate('Boolean(document.querySelector("#trigger") && typeof '+(hb?'showMatchInspector':'fixtureShowEvidence')+' === "function")'))break;await pause(100);}
 const reports=[];
 for(const width of [1400,800,390]){
  if(firefox){await protocol.send('WebDriver:SwitchToFrame',{id:null});await protocol.send('WebDriver:SetWindowRect',{width:Math.max(550,width+80),height:1000});await protocol.send('WebDriver:Navigate',{url:url.replace('/fixture','/frame?width='+width)});await protocol.send('WebDriver:SwitchToFrame',{id:0});for(let n=0;n<100;n++){if(await evaluate('typeof '+(hb?'showMatchInspector':'fixtureShowEvidence')+' === "function"'))break;await pause(50);}}else await protocol.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},session);
  await evaluate('(()=>{window.example='+JSON.stringify(match)+';example.localMatch.item=example.item;document.querySelector("#trigger").click();return true;})()');await pause(100);
  const result=await evaluate(`(()=>{const d=document.querySelector('dialog'), t=d.querySelector('details'),r=d.getBoundingClientRect();return {width:innerWidth,dialogWidth:r.width,overflow:d.scrollWidth>d.clientWidth+1,collapsed:!t.open,visibleText:d.innerText,allText:d.textContent,cards:d.querySelectorAll('.library-ui-candidate').length};})()`);
  if(!result.collapsed||result.overflow||result.dialogWidth>width)throw Error('Dialog layout/disclosure regression: '+JSON.stringify(result));
  if(phase==='after'&&(result.cards!==2||!result.visibleText.includes('Subscription access')||!result.visibleText.includes('Purchased')))throw Error('Missing distinct temporary/purchased candidates: '+JSON.stringify(result));
  const capture=async suffix=>{const response=firefox?await protocol.send('WebDriver:TakeScreenshot',{}):await protocol.send('Page.captureScreenshot',{format:'png'},session);fs.writeFileSync(path.join(output,`${phase}-${firefox?'firefox':'chrome'}-${width}-${suffix}.png`),Buffer.from(firefox?response.value:response.data,'base64'));};
  await capture('collapsed');await evaluate('document.querySelector("dialog details > summary").focus()');
  if(firefox)await protocol.send('WebDriver:PerformActions',{actions:[{type:'key',id:'keyboard',actions:[{type:'keyDown',value:' '},{type:'keyUp',value:' '}]}]});
  else{await protocol.send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32},session);await protocol.send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32},session);}
  await pause(50);if(!await evaluate('document.querySelector("dialog details").open'))throw Error('Keyboard disclosure failed');await capture('expanded');
  reports.push(result);
  if(firefox)await protocol.send('WebDriver:PerformActions',{actions:[{type:'key',id:'keyboard',actions:[{type:'keyDown',value:'\uE00C'},{type:'keyUp',value:'\uE00C'}]}]});
  else{await protocol.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},session);await protocol.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},session);}
  await pause(30);if(await evaluate('Boolean(document.querySelector("dialog"))'))throw Error('Escape did not close the dialog');
  if(!await evaluate('document.activeElement.id==="trigger"'))throw Error('Focus was not restored');
  if(phase==='after'){
   const cases=[
    {state:'owned',item:{title:offered.title}},
    {state:hb?'elsewhere':'owned-elsewhere',externalMatches:[{...temporary,ownership:'owned'}]},
    {state:'new'},
    {state:'unchecked',lookupIncomplete:true},
    {state:'partial',range:{owned:2,total:4},coverage:{owned:2,total:4,scopeUncertain:true,covered:[],possibleCovered:[],missing:[]},externalResult:{partialMatches:[{...temporary,ownership:'owned',relationship:'contains'}]}},
    {state:'possible',ownershipReview:true,externalPossibleMatches:[{...temporary,ownership:'rental'}]},
    {state:'possible',candidates:[{...purchased,profileLabel:'personal'},{...purchased,profileLabel:'family'}]},
    {state:'partial',owned:1,total:3,componentMatches:[{state:'owned',offered:{title:'Paint App'},item:{...purchased,title:'Paint App',mediaType:'software'}}]},
    {state:'possible',externalPossibleMatches:[{...temporary,title:'Very long title '.repeat(70),reason:'machine reason '.repeat(100)}]}
   ];
   for(const sample of cases){
    const candidate={...sample,offered};const saved=JSON.stringify(candidate);
    await evaluate('(()=>{window.example='+saved+';document.querySelector("#trigger").click();return true;})()');
    const check=await evaluate("(()=>{const d=document.querySelector('dialog');return {status:d.querySelector('.library-ui-match-status')?.textContent,overflow:d.scrollWidth>d.clientWidth+1,collapsed:!d.querySelector('details').open,visible:d.innerText,saved:JSON.stringify(example),writes:fixtureWrites};})()");
    if(check.overflow||!check.collapsed||!check.status||check.saved!==saved||check.writes)throw Error('Outcome presentation/state regression: '+JSON.stringify(check));
    if(sample.state==='unchecked'&&!check.visible.includes('could not finish'))throw Error('Incomplete disguised as New');
    await evaluate('document.querySelector("dialog").close()');await pause(10);
   }
   reports.push({viewport:width,outcomes:cases.length,unchangedResultsAndStorage:true,keyboardDisclosure:true});
  }

 }
 fs.writeFileSync(path.join(output,`${phase}-${firefox?'firefox':'chrome'}.json`),JSON.stringify(reports,null,2));console.log(`${hb?'HB':'FAN'} ${phase} ${firefox?'Firefox':'Chrome'}: 3 widths, collapsed/expanded, wrapping and focus passed`);
}finally{protocol?.close?.();child?.kill();await new Promise(r=>server.close(r));await pause(300);if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir())||!path.basename(profile).startsWith('match-explanation-ui-'))throw Error('Unsafe disposable profile cleanup target');fs.rmSync(path.resolve(profile),{recursive:true,force:true,maxRetries:6,retryDelay:300});}
