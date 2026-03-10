Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $RootDir

Write-Host "[bootstrap-windows] Installing Node dependencies"
npm install

Write-Host "[bootstrap-windows] Installing Python package in editable mode"
py -m pip install -e ".[dev]"

Write-Host "[bootstrap-windows] Build panel package (ZXP workflow is optional)"
Write-Host "Run: npm run build:zxp"

Write-Host "[bootstrap-windows] Bridge health check command"
Write-Host "Run: ae-cli health --base-url http://127.0.0.1:8080"
