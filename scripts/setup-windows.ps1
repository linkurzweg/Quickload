# Install the native Windows prerequisites explicitly, using the official winget sources.
# Run in PowerShell: ./scripts/setup-windows.ps1. Installers may request elevation.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw 'winget fehlt. App Installer installieren oder docs/DEVELOPMENT.md folgen.'
}

winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --source winget --silent --accept-package-agreements --accept-source-agreements --override '--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
if ($LASTEXITCODE -notin 0, -1978335189) { throw "Build Tools Installation: $LASTEXITCODE" }
winget install --id Rustlang.Rustup --exact --source winget --silent --accept-package-agreements --accept-source-agreements
if ($LASTEXITCODE -notin 0, -1978335189) { throw "Rustup Installation: $LASTEXITCODE" }

Write-Output 'Neues Terminal öffnen. Dann: node scripts/dev.mjs setup und node scripts/dev.mjs desktop'
