@echo off
setlocal EnableExtensions
title Ставка PRO - переустановка
cd /d "%~dp0"
cls
echo.
echo   ============================================
echo       ПЕРЕУСТАНОВКА / ОБНОВЛЕНИЕ ПРОГРАММЫ
echo   ============================================
echo.
echo   Нужно, только если программа перестала
echo   запускаться или вы обновили код.
echo.
echo   История ваших ставок не пострадает -
echo   она хранится внутри браузера.
echo.
pause
echo.
echo   [1/3] Удаляю старую сборку...
if exist ".next" rmdir /s /q ".next"
if exist "node_modules" rmdir /s /q "node_modules"
echo   [2/3] Ставлю компоненты заново...
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto ERR
echo.
echo   [3/3] Собираю приложение...
echo.
call npm run build
if errorlevel 1 goto ERR
echo.
echo   ============================================
echo    Готово! Запускайте "Запустить.bat"
echo   ============================================
echo.
pause
exit /b

:ERR
echo.
echo   ОШИБКА. Проверьте интернет и повторите.
echo.
pause
