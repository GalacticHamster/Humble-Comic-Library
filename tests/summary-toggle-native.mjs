import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdtemp,mkdir,rm,access} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromePipe,firefoxMarionette,freePort} from './native-protocol.mjs';

// Install a disposable unpacked copy, not a rebuilt release ZIP. The only
// manifest changes are local fixture routing and test instrumentation. Real
// extension storage/onChanged and the installed worker handle preference saves;
// the GL transport is synthetic. No personal profiles or provider requests.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),firefox=process.argv.includes('--firefox');
const temporary=await mkdtemp(join(tmpdir(),'hcl-toggle-native-')),stage=join(temporary,'extension'),profile=join(temporary,'profile');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let result,finish,child,driver,exited;
const finished=new Promise(resolve=>{finish=resolve;});
const server=createServer(async(request,response)=>{
  if(request.url==='/test-result'&&request.method==='POST'){
    let body='';for await(const chunk of request){body+=chunk;if(body.length>100000)throw Error('Excessive fixture result');}
    result=JSON.parse(body);response.end('ok');finish();return;
  }
  response.setHeader('Content-Type','text/html; charset=utf-8');
  const html=await readFile(join(root,'tests/redesign-fixture.html'),'utf8');
  response.end(html.replace(/<script(?![^>]*type="application\/json")[\s\S]*?<\/script>/g,'').replace('<link rel="stylesheet" href="/content.css">',''));
});
try{
  await mkdir(stage);await mkdir(profile);
  const archive=process.env.HB_RUNTIME_PACKAGE??join(root,'dist/1.1.1-rc6',`Humble-Comic-Library-1.1.1${firefox?'-firefox':''}.zip`);
  execFileSync('powershell.exe',['-NoProfile','-Command','Expand-Archive -LiteralPath $env:HCL_TOGGLE_ZIP -DestinationPath $env:HCL_TOGGLE_STAGE'],{windowsHide:true,env:{...process.env,HCL_TOGGLE_ZIP:archive,HCL_TOGGLE_STAGE:stage}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/books/test`;
  const fixtureOrigin=new URL(url).origin;
  const worker=await readFile(join(root,'background.js'),'utf8');
  for(const file of [...worker.matchAll(/importScripts\(([^)]+)\)/g)].flatMap(match=>[...match[1].matchAll(/'([^']+)'/g)].map(entry=>entry[1])))await writeFile(join(stage,file),await readFile(join(root,file)));
  // Route the worker's exact trusted-provider origin to the local fixture only
  // in this temporary installation. All sender-ID, operation and write guards
  // remain active; the repository's worker and manifests are never modified.
  assert.equal(worker.split("new URL(sender.url).origin==='https://www.humblebundle.com'").length,2);
  await writeFile(join(stage,'background.js'),worker.replace("new URL(sender.url).origin==='https://www.humblebundle.com'",`new URL(sender.url).origin===${JSON.stringify(fixtureOrigin)}`));
  const manifest=JSON.parse(await readFile(join(stage,'manifest.json'),'utf8'));
  const scripts=manifest.content_scripts[0].js;
  for(const file of scripts)await writeFile(join(stage,file),file==='content.js'&&process.env.HCL_TEST_CONTENT_REF
    ?execFileSync('git',['show',`${process.env.HCL_TEST_CONTENT_REF}:content.js`],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}):await readFile(join(root,file)));
  const fixture=(await readFile(join(root,'tests/bundle-fixture.js'),'utf8')).replace('window.chrome =','const syntheticChrome =');
  await writeFile(join(stage,'toggle-bootstrap.js'),`const installedChrome=globalThis.chrome;\n${fixture}\n
    const syntheticSend=syntheticChrome.runtime.sendMessage;
    const seeded=installedChrome.storage.local.set(fixtureStored);
    const chrome={storage:{onChanged:installedChrome.storage.onChanged,local:{
      get:async(...args)=>{await seeded;return installedChrome.storage.local.get(...args);},
      set:(...args)=>installedChrome.storage.local.set(...args)
    }},runtime:{getManifest:()=>installedChrome.runtime.getManifest(),sendMessage:(id,request)=>
      typeof id==='string'?syntheticSend(id,request):installedChrome.runtime.sendMessage(id)}};
  `);
  await writeFile(join(stage,'toggle-setup.js'),await readFile(join(root,'tests/summary-toggle-setup.js')));
  await writeFile(join(stage,'toggle-checks.js'),await readFile(join(root,'tests/summary-toggle-checks.js')));
  manifest.content_scripts=[{...manifest.content_scripts[0],matches:['http://127.0.0.1/*'],js:['toggle-bootstrap.js',...scripts.slice(0,-1),'toggle-setup.js',scripts.at(-1),'toggle-checks.js']}];
  manifest.host_permissions=[...new Set([...(manifest.host_permissions??[]),'http://127.0.0.1/*'])];
  await writeFile(join(stage,'manifest.json'),JSON.stringify(manifest));
  const storeFirefox=firefox?execFileSync('powershell.exe',['-NoProfile','-Command','(Get-AppxPackage -Name Mozilla.Firefox).InstallLocation'],{windowsHide:true,encoding:'utf8'}).trim():'';
  const candidates=firefox?[process.env.FIREFOX_BIN,'C:/Program Files/Mozilla Firefox/firefox.exe',...(storeFirefox?[join(storeFirefox,'VFS/ProgramFiles/Firefox Package Root/firefox.exe')]:[])]:[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'];
  let binary;for(const candidate of candidates.filter(Boolean))try{await access(candidate);binary=candidate;break;}catch{}
  assert(binary,'Browser executable required');
  if(firefox){
    const port=await freePort();await writeFile(join(profile,'user.js'),`user_pref("marionette.port",${port});\nuser_pref("browser.shell.checkDefaultBrowser",false);\n`);
    child=spawn(binary,['--headless','--no-remote','--profile',profile,'--marionette','--remote-allow-system-access','about:blank'],{windowsHide:true,env:{...process.env,MOZ_REMOTE_ALLOW_SYSTEM_ACCESS:'1'},stdio:['ignore','pipe','pipe']});exited=new Promise(resolve=>child.once('exit',resolve));
    driver=await firefoxMarionette(port);await driver.send('WebDriver:NewSession',{capabilities:{alwaysMatch:{browserName:'firefox'}}});
    // Temporary add-ons accept directories: no release package is generated.
    await driver.send('Addon:Install',{path:stage,temporary:true});
    await driver.send('WebDriver:Navigate',{url});
  }else{
    child=spawn(binary,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',`--user-data-dir=${profile}`,'--remote-debugging-pipe','--enable-unsafe-extension-debugging','about:blank'],{windowsHide:true,stdio:['ignore','pipe','pipe','pipe','pipe']});exited=new Promise(resolve=>child.once('exit',resolve));
    driver=chromePipe(child);await driver.send('Extensions.loadUnpacked',{path:stage});await driver.send('Target.createTarget',{url});
  }
  let timeout;try{await Promise.race([finished,exited,new Promise(resolve=>{timeout=setTimeout(resolve,30000);})]);}finally{clearTimeout(timeout);}
  assert(result,'Installed content-script checks did not finish');
  for(const check of result.checks)console.log(`PASS installed ${firefox?'Firefox':'Chrome'}: ${check}`);
  assert.equal(result.error,undefined,result.error);
  console.log(JSON.stringify({browser:firefox?'Firefox':'Chrome',checks:result.checks.length,activity:result.activity}));
}finally{
  if(child){child.kill();await Promise.race([exited,pause(3000)]);}
  await new Promise(resolve=>server.close(resolve));
  const target=resolve(temporary),parent=resolve(tmpdir());
  if(target.startsWith(parent+sep)&&target.slice(parent.length+1).startsWith('hcl-toggle-native-'))await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
