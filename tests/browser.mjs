import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Synthetic libraries only; no installed extensions, account sessions or remote requests.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const firefox = process.argv.includes('--firefox');
const importer = process.argv.includes('--importer');
const catalogue = process.argv.includes('--catalogue');
const refreshLoop = process.argv.includes('--refresh-loop');
const slowCentral = process.argv.includes('--slow-central');
const lifecycle = process.argv.includes('--lifecycle');
const lifecycleGame = process.argv.includes('--game');
const themeMode=process.argv.includes('--theme'),themeWidth=process.argv.includes('--tiny')?420:process.argv.includes('--narrow')?560:1200;
const tierSwitch = process.argv.includes('--tier-switch');
const storeFirefox = firefox && process.platform === 'win32' ? await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', '(Get-AppxPackage -Name Mozilla.Firefox).InstallLocation'], {windowsHide:true}).then(({stdout})=>stdout.trim() ? [join(stdout.trim(),'VFS/ProgramFiles/Firefox Package Root/firefox.exe')] : [],()=>[]) : [];
const candidates = (firefox ? [process.env.FIREFOX_BIN,'C:/Program Files/Mozilla Firefox/firefox.exe',...storeFirefox] : [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium']).filter(Boolean);
let browser;
for (const candidate of candidates) { try { await access(candidate); browser = candidate; break; } catch {} }
if (!browser) throw new Error(`Set ${firefox?'FIREFOX_BIN':'CHROME_BIN'} to a browser executable.`);
const profile = await mkdtemp(join(tmpdir(), 'hcl-browser-test-'));
let result, complete;
const finished = new Promise(resolve=>{complete=resolve;});
const server = createServer(async (request, response) => {
  try {
    let pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/test-result' && request.method === 'POST') {
      let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 100000) throw new Error('Excessive result.'); }
      result = JSON.parse(body); response.end('ok'); complete(); return;
    }
    if (pathname === '/home/purchases') {
      response.setHeader('Content-Type','text/html; charset=utf-8');
      response.end('<!doctype html><html><head><link rel="stylesheet" href="/content.css"></head><body><main>Purchases fixture</main><script src="/tests/bundle-fixture.js"></script><script src="/purchase-snapshot.js"></script><script src="/purchase-adapters.js"></script><script src="/purchase-sync.js"></script><script src="/shared.js"></script><script src="/collection-mappings.js"></script><script src="/ownership.js"></script><script src="/content.js"></script><script src="/tests/importer-checks.js"></script></body></html>');return;
    }
    if (pathname === '/books/test' || pathname === '/games/test') pathname = tierSwitch ? '/tests/tier-switch-fixture.html' : '/tests/bundle-fixture.html';
    if (pathname === '/books') pathname = '/tests/catalogue-fixture.html';
    const target = resolve(root, `.${decodeURIComponent(pathname)}`);
    if (!target.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
    response.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' })[extname(target)] || 'application/octet-stream');
    let body=process.env.HCL_TEST_CONTENT_REF && pathname === '/content.js'
      ? (await promisify(execFile)('git', ['show', `${process.env.HCL_TEST_CONTENT_REF}:content.js`], {cwd:root,windowsHide:true,maxBuffer:4*1024*1024})).stdout
      : await readFile(target);
    if(lifecycle&&pathname==='/tests/bundle-fixture.html')body=body.toString('utf8')
      .replace('<script src="/shared.js">',`<script>window.lifecycleWarm=${process.argv.includes('--warm')};</script><script src="/tests/lifecycle-fixture.js"></script><script src="/shared.js">`)
      .replace('/tests/browser-checks.js','/tests/lifecycle-checks.js');
    if(refreshLoop&&pathname==='/tests/bundle-fixture.html')body=body.toString('utf8')
      .replace('<script src="/shared.js">','<script>window.fixtureCentralDelayMs=250;window.fixtureCentralFailure=true;fixtureStored.bundleSummaryPreferences={minimized:true,position:"top-left"};fixtureStored.showDiagnostics=true;</script><script src="/shared.js">')
      .replace('/tests/browser-checks.js','/tests/summary-refresh-checks.js');
    if(slowCentral&&pathname==='/tests/bundle-fixture.html')body=body.toString('utf8')
      .replace('<script src="/shared.js">','<script>window.fixtureCentralDelayMs=4500;fixtureStored.bundleSummaryPreferences={minimized:true,position:"top-left"};</script><script src="/shared.js">')
      .replace('/tests/browser-checks.js','/tests/slow-central-checks.js');
    if(pathname.endsWith('.html')){body=body.toString('utf8').replace('<link rel="stylesheet" href="/content.css">','<link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/content.css"><link rel="stylesheet" href="/theme-overlays.css">').replace('<script src="/shared.js">','<script src="/theme.js"></script><script src="/shared.js">');if(themeMode)body=body.replace(/<script src="\/tests\/(presentation-parity-checks|advanced-parity-checks|browser-checks)\.js"><\/script>/g,'').replace('</body>','<script src="/tests/theme-overlay-checks.js"></script></body>');}
    response.end(body);
  } catch (error) { response.writeHead(404); response.end(error.message); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
try {
  let child;
  const url=`http://127.0.0.1:${server.address().port}${importer?'/home/purchases':catalogue?'/books':lifecycleGame||tierSwitch?'/games/test':'/books/test'}`;
  const args=firefox?['--headless','--no-remote','--profile',profile,url]:['--headless=new',`--window-size=${themeWidth},1000`,'--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,url];
  const exited=new Promise(resolve=>{child=execFile(browser,args,{env:{...process.env,...(firefox?{MOZ_HEADLESS_WIDTH:String(themeWidth),MOZ_HEADLESS_HEIGHT:'1000'}:{})},windowsHide:true,timeout:30000,maxBuffer:4*1024*1024},resolve);});
  let timeout;try{await Promise.race([finished,exited,new Promise(resolve=>{timeout=setTimeout(resolve,25000);})]);}finally{clearTimeout(timeout);child.kill();await exited;}
  assert.ok(result, 'The browser did not finish the fixture.');
  for (const check of result.checks) console.log(`PASS ${firefox?'Firefox':'Chrome'} browser: ${check}`);
  assert.equal(result.error, undefined, result.error);
  console.log(`${result.checks.length} browser checks passed.`);
} finally {
  await new Promise(done => server.close(done));
  const target = resolve(profile); const temporaryRoot = resolve(tmpdir());
  if (target.startsWith(temporaryRoot + sep) && target.slice(temporaryRoot.length + 1).startsWith('hcl-browser-test-')) await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
