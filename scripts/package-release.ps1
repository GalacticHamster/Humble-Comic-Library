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
        $manifestBytes = [System.Text.UTF8Encoding]::new($false).GetBytes(($manifest | ConvertTo-Json -Depth 20))
        $output.Write($manifestBytes, 0, $manifestBytes.Length)
      } else {
        $input = [System.IO.File]::OpenRead((Join-Path $projectRoot $relativePath))
        try { $input.CopyTo($output) } finally { $input.Dispose() }
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
