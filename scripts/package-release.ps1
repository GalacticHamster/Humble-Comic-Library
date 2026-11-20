[CmdletBinding()]
param(
  [ValidateSet('Chrome', 'Firefox')]
  [string]$Target = 'Chrome',
  [string]$OutputDirectory = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$projectRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $projectRoot 'dist'
}
$chromeManifestPath = Join-Path $projectRoot 'manifest.json'
$chromeManifestText = Get-Content -LiteralPath $chromeManifestPath -Raw
$manifest = $chromeManifestText | ConvertFrom-Json
if ($Target -eq 'Firefox') {
  $firefoxOverlayPath = Join-Path $projectRoot 'manifests\firefox.json'
  if (-not (Test-Path -LiteralPath $firefoxOverlayPath)) { throw "Firefox manifest overlay is missing: $firefoxOverlayPath" }
  $firefoxOverlay = Get-Content -LiteralPath $firefoxOverlayPath -Raw | ConvertFrom-Json
  foreach ($property in $firefoxOverlay.PSObject.Properties) {
    if ($manifest.PSObject.Properties.Name -contains $property.Name) {
      if ($property.Name -ne 'background') { throw "Firefox manifest overlay may only add browser-specific fields; '$($property.Name)' already exists in manifest.json." }
      $manifest.background = $property.Value
      continue
    }
    $manifest | Add-Member -NotePropertyName $property.Name -NotePropertyValue $property.Value
  }
}
$releaseFiles = @(
  'manifest.json',
  'LICENSE',
  'NOTICE',
  'shared.js',
  'library-entitlements.js',
  'background.js',
  'entitlement-share.js',
  'collection-mappings.js',
  'ownership.js',
  'content.js',
  'content.css',
  'options.html',
  'library-browser.js',
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
)

$missing = $releaseFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $projectRoot $_)) }
if ($missing) { throw "Release package is missing required file(s): $($missing -join ', ')" }

$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null
$packageSuffix = if ($Target -eq 'Firefox') { '-firefox' } else { '' }
$zipPath = Join-Path $outputPath "Humble-Comic-Library-$($manifest.version)$packageSuffix.zip"
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Package text with LF line endings regardless of the checkout's line-ending conversion, so the same commit
# always produces the same archive. Only CR LF pairs change; binary files are copied unchanged.
$textExtensions = @('.js', '.mjs', '.css', '.html', '.json', '.txt', '.md', '.svg')
function Get-PackageBytes([byte[]]$bytes, [string]$relativePath) {
  $name = [System.IO.Path]::GetFileName($relativePath)
  if (-not ($textExtensions -contains [System.IO.Path]::GetExtension($name).ToLowerInvariant() -or $name -in @('LICENSE', 'NOTICE'))) { return ,$bytes }
  $normalized = [System.IO.MemoryStream]::new($bytes.Length)
  for ($index = 0; $index -lt $bytes.Length; $index++) {
    if ($bytes[$index] -eq 13 -and $index + 1 -lt $bytes.Length -and $bytes[$index + 1] -eq 10) { continue }
    $normalized.WriteByte($bytes[$index])
  }
  return ,$normalized.ToArray()
}
$fileStream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
$archive = $null
try {
  $archive = [System.IO.Compression.ZipArchive]::new($fileStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
  $fixedTime = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
  foreach ($relativePath in $releaseFiles) {
    $entry = $archive.CreateEntry(($relativePath -replace '\\', '/'), [System.IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = $fixedTime
    $output = $entry.Open()
    try {
      if ($relativePath -eq 'manifest.json' -and $Target -eq 'Firefox') {
        $manifestBytes = Get-PackageBytes ([System.Text.UTF8Encoding]::new($false).GetBytes(($manifest | ConvertTo-Json -Depth 20))) 'manifest.json'
        $output.Write($manifestBytes, 0, $manifestBytes.Length)
      } else {
        $fileBytes = Get-PackageBytes ([System.IO.File]::ReadAllBytes((Join-Path $projectRoot $relativePath))) $relativePath
        $output.Write($fileBytes, 0, $fileBytes.Length)
      }
    } finally { $output.Dispose() }
  }
} finally {
  if ($null -ne $archive) { $archive.Dispose() }
  $fileStream.Dispose()
}

$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Output "Created $Target package $zipPath"
Write-Output "SHA256 $hash"
