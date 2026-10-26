// Installed release regression. Disposable profiles only; never opens provider websites.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp,mkdir,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {inflateRawSync} from 'node:zlib';
import {setTimeout as pause} from 'node:timers/promises';
import {chromePipe,firefoxMarionette,freePort} from './native-protocol.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),firefox=process.argv.includes('--firefox');
const sourceManifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8')),repo=sourceManifest.name==='Humble Comic Library'?'hb':sourceManifest.name==='Fanatical Library'?'fan':'gl';
const temp=await mkdtemp(join(tmpdir(),'gh-tab-icon-'));let child,driver,exited,session,handle,base;
function unzip(zip){const files=new Map();const end=zip.lastIndexOf(Buffer.from('504b0506','hex'));let at=zip.readUInt32LE(end+16);for(let n=0;n<zip.readUInt16LE(end+10);n++){assert.equal(zip.readUInt32LE(at),0x02014b50);const method=zip.readUInt16LE(at+10),size=zip.readUInt32LE(at+20),len=zip.readUInt16LE(at+28),extra=zip.readUInt16LE(at+30),comment=zip.readUInt16LE(at+32),local=zip.readUInt32LE(at+42),name=zip.subarray(at+46,at+46+len).toString();const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);files.set(name,method===8?inflateRawSync(zip.subarray(start,start+size)):zip.subarray(start,start+size));at+=46+len+extra+comment;}return files;}
try{
 let files,originalZip;
 if(repo==='hb'){
  execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts/package-release.ps1'),'-Target',firefox?'Firefox':'Chrome','-OutputDirectory',temp],{windowsHide:true});
  originalZip=await readFile(join(temp,'Humble-Comic-Library-'+sourceManifest.version+(firefox?'-firefox':'')+'.zip'));files=unzip(originalZip);
 }else{const builder=await import(pathToFileURL(join(root,'scripts/release.mjs')));const result=await builder.createRelease(undefined,undefined,firefox?'firefox':'chrome');originalZip=result.zip;files=result.files;}
 const manifest=JSON.parse(files.get('manifest.json'));const pages=[manifest.options_page,manifest.action.default_popup];
 // Verify the actual archive, not HTML copied directly from the source tree.
 for(const page of pages){const html=files.get(page).toString(),link=html.match(/<link\b[^>]*rel="icon"[^>]*>/u)?.[0];assert(link,'Missing explicit tab icon in packaged '+page);const href=link.match(/href="([^"]+)"/u)?.[1];assert.equal(new URL(href,'https://package.invalid/'+page).pathname,'/icons/icon16.png');assert(link.includes('image/png')&&link.includes('16x16'));}
 const profile=join(temp,'profile'),stage=join(temp,'extension');await mkdir(profile);await mkdir(stage);
 for(const [path,bytes]of files){const out=join(stage,path);await mkdir(dirname(out),{recursive:true});await writeFile(out,bytes);}
 let binary=firefox?(process.env.FIREFOX_BIN||'C:/Program Files/Mozilla Firefox/firefox.exe'):(process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe');
 try{await access(binary);}catch{const install=execFileSync('powershell.exe',['-NoProfile','-Command','(Get-AppxPackage -Name Mozilla.Firefox).InstallLocation'],{encoding:'utf8',windowsHide:true}).trim();binary=join(install,'VFS/ProgramFiles/Firefox Package Root/firefox.exe');}
 const port=firefox?await freePort():0;if(firefox)await writeFile(join(profile,'user.js'),`user_pref("marionette.port",${port});\nuser_pref("extensions.update.enabled",false);\n`);
 child=spawn(binary,firefox?['--headless','--no-remote','--profile',profile,'--marionette','--remote-allow-system-access','about:blank']:['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--enable-unsafe-extension-debugging','--remote-debugging-pipe','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:firefox?['ignore','pipe','pipe']:['ignore','pipe','pipe','pipe','pipe']});exited=new Promise(r=>child.once('exit',r));driver=firefox?await firefoxMarionette(port):chromePipe(child);
 async function chromeContext(script){await driver.send('Marionette:SetContext',{value:'chrome'});const r=await driver.send('WebDriver:ExecuteScript',{script,args:[],newSandbox:true});await driver.send('Marionette:SetContext',{value:'content'});return r.value??r;}
 async function evaluate(script){if(firefox){const r=await driver.send('WebDriver:ExecuteAsyncScript',{script:'(async()=>{'+script+'})().then(arguments[arguments.length-1],e=>arguments[arguments.length-1]({error:String(e)}));',args:[],newSandbox:false});return r.value??r;}const r=await driver.send('Runtime.evaluate',{expression:'(async()=>{'+script+'})()',awaitPromise:true,returnByValue:true},session);return r.result.value;}
 let version;
 if(firefox){const r=await driver.send('WebDriver:NewSession',{capabilities:{alwaysMatch:{browserName:'firefox'}}});version=r;const h=await driver.send('WebDriver:GetWindowHandle');handle=h.value??h;const zip=join(temp,'installed.zip');await writeFile(zip,originalZip);await driver.send('Addon:Install',{path:zip,temporary:true});base=await chromeContext(`return WebExtensionPolicy.getByID(${JSON.stringify(manifest.browser_specific_settings.gecko.id)}).getURL('');`);await driver.send('WebDriver:SwitchToWindow',{handle});}
 else{version=await driver.send('Browser.getVersion');const installed=await driver.send('Extensions.loadUnpacked',{path:stage});base='chrome-extension://'+installed.id+'/';const t=await driver.send('Target.createTarget',{url:'about:blank'});session=(await driver.send('Target.attachToTarget',{targetId:t.targetId,flatten:true})).sessionId;await driver.send('Page.enable',{},session);}
 let checks=0;
 async function navigate(path){if(firefox)await driver.send('WebDriver:Navigate',{url:base+path});else await driver.send('Page.navigate',{url:base+path},session);await pause(1100);}
 async function inspect(path,phase){
  const page=await evaluate(`return {url:location.href,title:document.title,links:[...document.querySelectorAll('link[rel~="icon"]')].map(n=>({href:n.href,type:n.type,sizes:n.sizes.value})),resources:performance.getEntriesByType('resource').filter(n=>/icon|favicon/i.test(n.name)).map(n=>({name:n.name,type:n.initiatorType})),asset:await new Promise(resolve=>{const i=new Image();i.onload=()=>resolve({ok:true,width:i.naturalWidth,height:i.naturalHeight});i.onerror=()=>resolve({ok:false});i.src=new URL('/icons/icon16.png',location.href);})};`);
  const tab=firefox?await chromeContext(`const t=gBrowser.selectedTab,i=t.querySelector('.tab-icon-image');return {url:gBrowser.currentURI.spec,image:t.getAttribute('image'),icon:gBrowser.getIcon(t),src:i?.getAttribute('src'),display:i?getComputedStyle(i).display:null,visibility:i?getComputedStyle(i).visibility:null,pinned:t.pinned,rect:i?{width:i.getBoundingClientRect().width,height:i.getBoundingClientRect().height}:null};`):await evaluate('return await chrome.tabs.getCurrent();');
  assert(!page.error,JSON.stringify(page));assert.equal(page.asset.ok,true);assert.equal(page.asset.width,16);assert.equal(page.links.length,1);assert.equal(new URL(page.links[0].href).pathname,'/icons/icon16.png');
  if(firefox){assert(tab.image?.startsWith('data:image/png;')||tab.image===page.links[0].href,'Firefox did not assign a tab icon');assert.equal(tab.display,'block');assert.equal(tab.visibility,'visible');assert.equal(tab.rect.width,16);assert.equal(tab.rect.height,16);assert.equal(tab.src,tab.image);
   const equal=await evaluate(`const load=src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=src;});const pixels=async src=>{const i=await load(src),c=document.createElement('canvas');c.width=16;c.height=16;const x=c.getContext('2d');x.drawImage(i,0,0,16,16);return [...x.getImageData(0,0,16,16).data];};const a=await pixels(${JSON.stringify(tab.image)}),b=await pixels(${JSON.stringify(page.links[0].href)});let max=0,total=0;for(let i=0;i<a.length;i+=4){max=Math.max(max,Math.abs(a[i+3]-b[i+3]));for(let k=0;k<3;k++){const d=Math.abs(a[i+k]*a[i+3]/255-b[i+k]*b[i+3]/255);max=Math.max(max,d);total+=d;}}return {max,mean:total/(16*16*3)};`);// Firefox re-encodes the PNG; allow bounded premultiplication rounding.
   assert(equal.max<=2&&equal.mean<0.5,'Displayed tab icon pixels differ from approved asset');
  }else assert.equal(tab.favIconUrl,page.links[0].href,'Chrome tab icon no longer uses the approved existing 16px artwork');
  checks++;console.log('PASS '+(firefox?'Firefox':'Chrome')+' '+path+' '+phase+': browser tab icon matches approved 16px PNG');
 }
 for(const path of pages){await navigate(path);await inspect(path,'initial');if(firefox){await chromeContext('gBrowser.pinTab(gBrowser.selectedTab);return true;');await inspect(path,'pinned');await chromeContext('gBrowser.unpinTab(gBrowser.selectedTab);return true;');}else{await evaluate('await chrome.tabs.update((await chrome.tabs.getCurrent()).id,{pinned:true});return true;');await inspect(path,'pinned');await evaluate('await chrome.tabs.update((await chrome.tabs.getCurrent()).id,{pinned:false});return true;');}
  if(firefox)await driver.send('WebDriver:Refresh');else await driver.send('Page.reload',{},session);await pause(500);await inspect(path,'reload');
  if(firefox){const h=await driver.send('WebDriver:NewWindow',{type:'tab'});handle=(h.value??h).handle;await driver.send('WebDriver:SwitchToWindow',{handle});}else{const t=await driver.send('Target.createTarget',{url:'about:blank'});session=(await driver.send('Target.attachToTarget',{targetId:t.targetId,flatten:true})).sessionId;await driver.send('Page.enable',{},session);}
  await navigate(path);await inspect(path,'reopened');
 }
 console.log(checks+' installed '+(firefox?'Firefox':'Chrome')+' tab icon checks passed for '+sourceManifest.name+'.');
}finally{if(firefox&&driver)try{await driver.send('Marionette:Quit',{flags:['eForceQuit']});}catch{}child?.kill();driver?.close?.();if(exited)await exited;const target=resolve(temp),parent=resolve(tmpdir());if(target.startsWith(parent+sep)&&target.slice(parent.length+1).startsWith('gh-tab-icon-'))await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
