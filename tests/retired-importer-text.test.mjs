import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
// Humble's redesigned account pages no longer support the purchase-page importer.
// Current UI and its documentation must not send people to its retired actions.
const files=['options.js','options.html','popup.js','background.js','library-entitlements.js','library-browser.js','shared.js','purchase-adapters.js','entitlement-share.js','docs/reminder-sharing.md','docs/purchase-sharing.md','docs/companion-pairing.md'];
const retired=/Import new purchases|Rescan all purchases|Rescan every purchase|Open Humble Purchases|Open Humble purchases? importer|the purchase importer\b/u;
test('current Humble Library UI and docs do not direct people to the retired purchase-page importer',()=>{
 for(const file of files){
  const lines=readFileSync(new URL('../'+file,import.meta.url),'utf8').split(/\r?\n/u);
  // shared.js keeps the importer's own validation message for older purchase pages.
  const hits=lines.map((text,i)=>({text,line:i+1})).filter(({text})=>retired.test(text)&&!(file==='shared.js'&&/Choose Rescan all purchases and explicitly select Save a new account/u.test(text)));
  assert.deepEqual(hits.map(h=>file+':'+h.line),[],hits.map(h=>h.text.trim().slice(0,160)).join('\n'));
 }
});
