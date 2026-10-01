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
const candidates = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].filter(Boolean);
let browser;
for (const candidate of candidates) { try { await access(candidate); browser = candidate; break; } catch {} }
if (!browser) throw new Error('Set CHROME_BIN to a Chrome/Chromium executable.');
const profile = await mkdtemp(join(tmpdir(), 'hcl-browser-test-'));
let result;
const server = createServer(async (request, response) => {
  try {
    let pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/test-result' && request.method === 'POST') {
      let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 100000) throw new Error('Excessive result.'); }
      result = JSON.parse(body); response.end('ok'); return;
    }
    if (pathname === '/books/test') pathname = '/tests/bundle-fixture.html';
    const target = resolve(root, `.${decodeURIComponent(pathname)}`);
    if (!target.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
    response.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' })[extname(target)] || 'application/octet-stream');
    response.end(await readFile(target));
  } catch (error) { response.writeHead(404); response.end(error.message); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
try {
  await promisify(execFile)(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--virtual-time-budget=10000', '--dump-dom', `http://127.0.0.1:${server.address().port}/books/test`], { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  assert.ok(result, 'The browser did not finish the fixture.');
  for (const check of result.checks) console.log(`PASS browser: ${check}`);
  assert.equal(result.error, undefined, result.error);
  console.log(`${result.checks.length} browser checks passed.`);
} finally {
  await new Promise(done => server.close(done));
  const target = resolve(profile); const temporaryRoot = resolve(tmpdir());
  if (target.startsWith(temporaryRoot + sep) && target.slice(temporaryRoot.length + 1).startsWith('hcl-browser-test-')) await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
