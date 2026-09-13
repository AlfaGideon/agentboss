@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Ставка PRO - переустановка
cd /d "%~dp0"
cls
echo.
echo   ==========================================
echo      ПЕРЕУСТАНОВКА / ОБНОВЛЕНИЕ ПРОГРАММЫ
echo   ==========================================
echo.
echo   Нужно, только если программа перестала
echo   запускаться или вы обновили файлы.
echo.
echo   История ваших ставок не пропадёт -
echo   она хранится внутри браузера.
echo.
echo   Начинаю через 5 секунд...
timeout /t 5 >nul

set "NODEDIR="
where node >nul 2>nul && goto NODE_OK
if exist "%ProgramFiles%\nodejs\node.exe" set "NODEDIR=%ProgramFiles%\nodejs"
if not defined NODEDIR if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODEDIR=%LOCALAPPDATA%\Programs\nodejs"
if defined NODEDIR set "PATH=!NODEDIR!;%PATH%"

:NODE_OK
echo.
echo   [1/3] Удаляю старую сборку...
if exist ".next" rmdir /s /q ".next"
if exist "node_modules" rmdir /s /q "node_modules"
if exist "package-lock.json" del /q "package-lock.json"

echo   [2/3] Ставлю компоненты заново. Это 3-5 минут.
echo.
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 goto ERR

echo.
echo   [3/3] Собираю приложение...
echo.
call npm run build
if errorlevel 1 goto ERR

echo.
echo   ==========================================
echo    Готово! Запускайте "Запустить.bat"
echo   ==========================================
echo.
pause
exit /b

:ERR
echo.
echo   ОШИБКА. Проверьте интернет и повторите.
echo.
pause
