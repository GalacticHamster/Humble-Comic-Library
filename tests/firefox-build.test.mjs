import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageScript = path.join(root, 'scripts', 'package-release.ps1');
const runtimeFiles = [
  'manifest.json',
  'LICENSE',
  'NOTICE',
  'shared.js',

  'background.js',
  'entitlement-share.js',
  'collection-mappings.js',
  'ownership.js',
  'content.js',
  'content.css',
  'options.html',
  'options.js',
  'popup.html',
  'popup.js',
  'ui.css',
  'purchase-snapshot.js',
  'purchase-transfer.js',
  'purchase-sync.js',
  'purchase-sync-ui.js',
  'purchase-adapters.js',
  'purchase-handoff-ui.js',
  'theme.js',
  'theme.css',
  'theme-app.css',
  'theme-overlays.css',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png'
];

const chromeManifestText = fs.readFileSync(path.join(root, 'manifest.json'), 'utf8');
const chromeManifest = JSON.parse(chromeManifestText);
const firefoxOverlay = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'firefox.json'), 'utf8'));

function extensionIdValidator() {
  const context = {};
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'shared.js'), 'utf8'), context, { filename: 'shared.js' });
  return context.HumbleComicLibrary.isExtensionId;
}

function packageExtension(target, outputDirectory) {
  execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', packageScript,
    '-Target', target,
    '-OutputDirectory', outputDirectory
  ], { cwd: root, stdio: 'pipe' });
  const suffix = target === 'Firefox' ? '-firefox' : '';
  return path.join(outputDirectory, `Humble-Comic-Library-${chromeManifest.version}${suffix}.zip`);
}

function inspectZip(zipPath) {
  const command = `
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $stream = [System.IO.File]::OpenRead($env:HCL_PACKAGE_PATH)
    $archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Read, $false)
    try {
      $entry = $archive.GetEntry('manifest.json')
      $reader = [System.IO.StreamReader]::new($entry.Open())
      try {
        $sharedReader = [System.IO.StreamReader]::new($archive.GetEntry('shared.js').Open())
        try {
          $pages = [ordered]@{}
          foreach ($page in @('options.html','popup.html')) {
            $htmlReader = [System.IO.StreamReader]::new($archive.GetEntry($page).Open())
            try { $pages[$page] = $htmlReader.ReadToEnd() } finally { $htmlReader.Dispose() }
          }
          [ordered]@{ pages = $pages; entries = @($archive.Entries | ForEach-Object { $_.FullName }); manifest = $reader.ReadToEnd(); shared = $sharedReader.ReadToEnd() } | ConvertTo-Json -Compress } finally { $sharedReader.Dispose() }
      } finally { $reader.Dispose() }
    } finally { $archive.Dispose(); $stream.Dispose() }
  `;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, HCL_PACKAGE_PATH: zipPath }
  });
  return JSON.parse(output);
}

test('shared extension-ID validation accepts Chrome and conservative Gecko IDs only', () => {
  const isExtensionId = extensionIdValidator();
  assert.equal(isExtensionId('abcdefghijklmnopabcdefghijklmnop'), true);
  assert.equal(isExtensionId('humble-comic-library@galactichamster.com'), true);
  assert.equal(isExtensionId('hcl+development@extensions.example.org'), true);
  for (const invalid of ['', 'not-an-extension-id', 'abcdefghijklmnopabcdefghijklmnopq', 'humble-comic-library@localhost', 'humble-comic-library@', '@galactichamster.com', 'humble comic library@galactichamster.com']) {
    assert.equal(isExtensionId(invalid), false, invalid || '(empty)');
  }
});

test('Chrome and Firefox packages have deterministic, target-specific manifests and runtime contents', () => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hcl-package-test-'));
  try {
    const chromePath = packageExtension('Chrome', outputDirectory);
    const firstChromeBytes = fs.readFileSync(chromePath);
    const chrome = inspectZip(chromePath);
    const firefoxPath = packageExtension('Firefox', outputDirectory);
    const firefox = inspectZip(firefoxPath);
    packageExtension('Chrome', outputDirectory);

    assert.equal(path.basename(chromePath), `Humble-Comic-Library-${chromeManifest.version}.zip`);
    assert.equal(path.basename(firefoxPath), `Humble-Comic-Library-${chromeManifest.version}-firefox.zip`);
    for(const artifact of [chrome,firefox]){for(const id of ['bjjpfofmcmiipeghcbhdfjedpldmkcii','pdknncacndkicpogbebdfanniibnnpic','ieoobffekgbfjfoiheejkfihneooiadb'])assert(artifact.shared.includes(id));const manifest=JSON.parse(artifact.manifest);assert.equal(manifest.externally_connectable,undefined);assert.equal(manifest.key,undefined);assert.deepEqual(manifest.permissions,['storage','unlimitedStorage','alarms']);}
    assert.deepEqual(chrome.entries, runtimeFiles);
    assert.deepEqual(firefox.entries, runtimeFiles);
    assert.equal(chrome.manifest, chromeManifestText);
    assert.deepEqual(fs.readFileSync(chromePath), firstChromeBytes, 'Chrome packaging must remain deterministic across runs');
    assert.equal(JSON.parse(chrome.manifest).browser_specific_settings, undefined);

    const firefoxManifest = JSON.parse(firefox.manifest);
    for (const artifact of [chrome,firefox]) {
      const manifest=JSON.parse(artifact.manifest);
      assert.equal(manifest.name,'Humble Library');
      assert.equal(manifest.action.default_title,'Humble Library');
      assert.equal(manifest.short_name,undefined);
      for(const page of ['options.html','popup.html']) {
        assert(artifact.pages[page].includes('<h1>Humble Library</h1>'));
        assert(artifact.pages[page].includes('<title>Humble Library'+(page==='options.html'?' settings':'')+'</title>'));
        assert(!artifact.pages[page].includes('Humble Comic Library'));
      }
    }
    assert.deepEqual(firefoxManifest.browser_specific_settings, firefoxOverlay.browser_specific_settings);
    assert.equal(firefoxManifest.browser_specific_settings.gecko.id, 'humble-comic-library@galactichamster.com');
    assert.equal(firefoxManifest.browser_specific_settings.gecko.strict_min_version, '140.0');
    assert.deepEqual(firefoxManifest.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
    const expectedFirefoxManifest = { ...chromeManifest, ...firefoxOverlay };
    assert.deepEqual(firefoxManifest, expectedFirefoxManifest);
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test('both packaged pages explicitly use the existing approved manifest tab icon',()=>{
 const outputDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'hcl-package-test-'));
 try{for(const target of ['Chrome','Firefox']){
  const artifact=inspectZip(packageExtension(target,outputDirectory)),manifest=JSON.parse(artifact.manifest);
  for(const page of [manifest.options_page,manifest.action.default_popup]){
   const links=[...artifact.pages[page].matchAll(/<link\b[^>]*rel="icon"[^>]*>/gu)];assert.equal(links.length,1);
   const link=links[0][0],href=link.match(/href="([^"]+)"/u)[1],asset=new URL(href,'https://package.invalid/'+page).pathname.slice(1);
   assert.equal(asset,manifest.icons['16']);assert(artifact.entries.includes(asset));assert(link.includes('image/png')&&link.includes('16x16'));
  }
 }}finally{fs.rmSync(outputDirectory,{recursive:true,force:true});}
});
