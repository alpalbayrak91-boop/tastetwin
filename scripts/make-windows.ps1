$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$electronPackage = Get-Content (Join-Path $root "node_modules\electron\package.json") | ConvertFrom-Json
$cacheDirectory = Join-Path $root ".electron-cache"
$zipName = "electron-v$($electronPackage.version)-win32-x64.zip"
$zipPath = Join-Path $cacheDirectory $zipName
$outDirectory = Join-Path $root "out"
$makeDirectory = Join-Path $outDirectory "make"

New-Item -ItemType Directory -Force -Path $cacheDirectory | Out-Null
if (-not (Test-Path -LiteralPath $zipPath)) {
  Write-Host "Creating local Electron package cache: $zipName"
  Compress-Archive `
    -Path (Join-Path $root "node_modules\electron\dist\*") `
    -DestinationPath $zipPath `
    -CompressionLevel Optimal
}

Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq "TasteTwin.exe" -and
    $_.ExecutablePath -and
    $_.ExecutablePath.StartsWith($outDirectory, [StringComparison]::OrdinalIgnoreCase)
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 800

if (Test-Path -LiteralPath $makeDirectory) {
  $resolvedMake = (Resolve-Path -LiteralPath $makeDirectory).Path
  if ($resolvedMake -ne $makeDirectory) {
    throw "Refusing to clear unexpected make directory: $resolvedMake"
  }
  Remove-Item -LiteralPath $resolvedMake -Recurse -Force
}

$env:ELECTRON_ZIP_DIR = $cacheDirectory
& (Join-Path $root "node_modules\.bin\electron-forge.cmd") make
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
