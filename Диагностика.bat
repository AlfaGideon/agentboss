@echo off
chcp 65001 >nul
set "NODE_TLS_REJECT_UNAUTHORIZED=0"
cd /d "%~dp0"
title Stavka PRO - diagnostics
cls
echo.
echo   ==========================================
echo       DIAGNOSTICS: ACCESS TO BOOKMAKERS
echo   ==========================================
echo.
echo   This checks DNS, TLS and HTTP answers for
echo   every feed address used by the app.
echo.

where node >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed.
  echo   Run "Запустить.bat" (Zapustit.bat) first - it installs Node itself.
  echo.
  pause >nul
  exit /b
)

echo   Node.js found. Checking, please wait 30-60 seconds...
echo.

node "%~dp0diag.mjs"

echo.
if exist "%~dp0diag-report.txt" (
  echo   Report saved: diag-report.txt  (opening in Notepad)
  start "" notepad "%~dp0diag-report.txt"
) else (
  echo   Report was not created - see errors above.
)
echo.
echo   Send diag-report.txt to support - it has the exact reason.
echo.
pause

echo.
echo ==========================================
echo               ВЫВОД ДЛЯ ЧАТА
echo ==========================================
node "%~dp0get-error.mjs"
pause
