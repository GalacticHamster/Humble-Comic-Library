import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function background(id,externalResponse) {
  const listeners=[],externals=[];
  const dispatch=(list,message,sender,resolve)=>{for(const fn of list)if(fn(message,sender,resolve)===true)return;resolve(null);};
  const tabs = [];
  const opened=[];
  const context = { setTimeout,clearTimeout,chrome: { runtime: { id: 'self',openOptionsPage:async()=>opened.push(true),onMessageExternal:{addListener:fn=>{externals.push(fn);}}, sendMessage:async(target,message)=>{if(!externalResponse)throw Error('unavailable');return externalResponse(target,message);}, onMessage: { addListener: fn => { listeners.push(fn); } } },
    storage: { local: { get: async () => ({ galacticLibraryExtensionId: id }) } }, tabs: { create: async value => tabs.push(value) } } };
  context.globalThis = context;
  vm.createContext(context);
  for (const file of ['purchase-snapshot.js', 'purchase-transfer.js', 'purchase-adapters.js','theme.js','shared.js','entitlement-share.js','background.js']) vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context);
  return { tabs, listeners,opened,externalRequest:(message,sender)=>new Promise(resolve=>{dispatch(externals,message,sender,resolve);}),request: (message = { type: 'HCL_OPEN_GALACTIC_REVIEW' }, sender = { id: 'self' }) => new Promise(resolve => { dispatch(listeners,message,sender,resolve); }) };
}

test('source review authorizes only the saved central companion and opens its own options',async()=>{
  const id='galactic-library@galactichamster.com',worker=background(id);
  assert.equal((await worker.externalRequest({type:'OPEN_REVIEW',apiVersion:1},{id:'foreign@example.org'})).ok,false);
  assert.equal((await worker.externalRequest({type:'OPEN_REVIEW',apiVersion:2},{id})).ok,false);
  assert.equal(worker.opened.length,0);
  assert.equal((await worker.externalRequest({type:'OPEN_REVIEW',apiVersion:1,url:'https://evil.test'},{id})).ok,true);
  assert.equal(worker.opened.length,1);assert.equal(worker.tabs.length,0);
});

test('review navigation uses only the saved extension ID and accepts only internal callers', async () => {
  const worker = background('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal((await worker.request({ type: 'HCL_OPEN_GALACTIC_REVIEW', url: 'https://untrusted.example' })).ok, true);
  assert.equal(worker.tabs[0].url, 'chrome://extensions/?options=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(await worker.request({ type: 'HCL_OPEN_GALACTIC_REVIEW' }, { id: 'foreign' }), null);
  assert.equal(worker.tabs.length, 1);
});

test('missing/invalid links and Firefox stable IDs give actionable feedback without inventing URLs', async () => {
  for (const id of ['https://untrusted.example', 'galactic-library@example.org']) {
    const worker = background(id);
    const result = await worker.request();
    assert.equal(result.ok, false);
    assert.equal(worker.tabs.length, 0);
    assert.match(result.error, id.includes('@') ? /Firefox.*toolbar/u : /Configure/u);
  }
});

test('explanations show actual owned titles, edition conflicts, content evidence and missing scope without purchase secrets', () => {
  const context = { URL }; context.globalThis = context; vm.createContext(context);
  for (const file of ['shared.js', 'collection-mappings.js', 'ownership.js']) vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context);
  const result = context.HumbleOwnership.explanationLines({ state: 'possible', offered: { title: 'Dune, 2nd Edition', kind: 'book', isbn: ['9780306406157'] },
    externalPossibleMatches: [{ provider: 'kindle', title: 'Dune, 1st Edition', itemRef: 'opaque', ownership: 'owned', relationship: 'same-work', reason: 'Edition differs', evidence: { isbn: ['9780140328721'], source: 'review', checkedAt: '2026-10-01' } }],
    localMatch: { item: { title: 'Dune, 1st Edition', purchaseKey: 'PRIVATE', sourceBundle: 'Known Bundle', purchasedAt: '2025-01-01' } },
    coverage: { total: 2, owned: 1, scopeUncertain: true, contentsComplete: false, covered: [], possibleCovered: [], missing: [{ series: 'Manga', run: '2020', unitType: 'volume', number: '2', language: 'en' }] } }).join('\n');
  for (const text of ['Dune, 1st Edition', 'Different validated ISBNs', 'Different edition', 'Known Bundle', '2026-10-01', 'Manga (2020) volume 2', 'uncertain']) assert.ok(result.includes(text), text);
  assert.equal(result.includes('PRIVATE'), false);
});

test('Firefox central review calls the paired receiver with a versioned action and no caller URL',async()=>{const messages=[],id='galactic-library@galactichamster.com',worker=background(id,async(target,message)=>{messages.push({target,message});return {ok:true,apiVersion:1};});assert.equal((await worker.request({type:'HCL_OPEN_GALACTIC_REVIEW',url:'https://evil.test'})).ok,true);assert.equal(worker.tabs.length,0);assert.deepEqual(JSON.parse(JSON.stringify(messages)),[{target:id,message:{type:'OPEN_REVIEW',apiVersion:1}}]);});
