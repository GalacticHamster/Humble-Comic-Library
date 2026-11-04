import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('release manifest and package metadata consistently identify the 1.0 candidate',async()=>{
 const read=async name=>JSON.parse(await readFile(new URL('../'+name,import.meta.url),'utf8'));
 const manifest=await read('manifest.json'),metadata=await read('package.json'),overlay=await read('manifests/firefox.json');
 assert.equal(manifest.version,'1.0.1');assert.equal(metadata.version,manifest.version);
 assert.equal(overlay.version,undefined,'Firefox inherits the release version from its base manifest');
 assert.equal(overlay.browser_specific_settings.gecko.strict_min_version,'140.0');
});
