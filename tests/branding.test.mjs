import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('current UI and user documentation use Humble Library while compatibility identifiers remain',async()=>{
 const current=['manifest.json','options.html','popup.html','content.js','options.js','shared.js','purchase-handoff-ui.js','purchase-sync-ui.js','README.md','PRIVACY.md','UI_FEATURE_PARITY.md','docs/companion-pairing.md'];
 for(const file of current){const source=await readFile(new URL('../'+file,import.meta.url),'utf8');assert(!/Humble Comic Library/iu.test(source),file+' contains legacy display branding');}
 const shared=await readFile(new URL('../shared.js',import.meta.url),'utf8');
 assert(shared.includes("value.format !== 'humble-comic-library-backup'"),'Existing backup format stays readable');
 assert(shared.includes("global.HumbleComicLibrary")||shared.includes('HumbleComicLibrary'),'Internal API identifier stays unchanged');
 const overlay=JSON.parse(await readFile(new URL('../manifests/firefox.json',import.meta.url),'utf8'));
 assert.equal(overlay.browser_specific_settings.gecko.id,'humble-comic-library@galactichamster.com');
});
