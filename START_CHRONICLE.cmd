@echo off
cd /d "%~dp0"
node --version >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 24 or newer, then run this file again.
  pause
  exit /b 1
)
if not exist .env (
  echo Follow START_HERE.md to create your .env settings first.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Dependencies are not installed. Run npm.cmd ci once from this folder.
  pause
  exit /b 1
)

echo Starting Chronicle in a separate window...
start "Chronicle Server" /min cmd /k "cd /d ""%~dp0"" && npm.cmd start"

echo Waiting for the Chronicle dashboard...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root='%~dp0'.TrimEnd('\'); $keyFile=Join-Path $root 'data\dashboard-key'; $deadline=(Get-Date).AddSeconds(45); $ready=$false; do { Start-Sleep -Milliseconds 500; $ready=(Test-Path -LiteralPath $keyFile) -and (Test-NetConnection -ComputerName 127.0.0.1 -Port 8787 -InformationLevel Quiet -WarningAction SilentlyContinue) } while (-not $ready -and (Get-Date) -lt $deadline); if ($ready) { $key=(Get-Content -Raw -LiteralPath $keyFile).Trim(); Start-Process ('http://127.0.0.1:8787/#token=' + $key) } else { Write-Host 'Chronicle did not open its dashboard. Check the Chronicle Server window for an error.'; Read-Host 'Press Enter to close' }"
