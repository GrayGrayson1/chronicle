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
call npm start
pause
