@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Ставка PRO - анализ линий букмекеров
cd /d "%~dp0"
cls
echo.
echo   ============================================
echo              С Т А В К А   P R O
echo       анализ линий российских букмекеров
echo   ============================================
echo.

REM ================= 1. Node.js =================
where node >nul 2>nul
if errorlevel 1 goto NO_NODE
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODEV=%%v"
echo   [1/4] Node.js !NODEV! - найден
goto DEPS

:NO_NODE
echo   [1/4] Node.js не установлен.
echo.
where winget >nul 2>nul
if errorlevel 1 goto NO_WINGET
echo   Устанавливаю автоматически, подождите...
echo.
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
echo.
echo   ============================================
echo    Node.js установлен.
echo    ЗАКРОЙТЕ это окно и запустите файл ещё раз.
echo   ============================================
echo.
pause
exit /b

:NO_WINGET
echo   Автоматически установить не получилось.
echo   Сейчас откроется сайт - нажмите большую
echo   зелёную кнопку LTS, установите, и запустите
echo   этот файл снова.
echo.
start "" https://nodejs.org/ru
pause
exit /b

REM ================= 2. Компоненты =================
:DEPS
if exist "node_modules\next\package.json" (
  echo   [2/4] Компоненты на месте
  goto BUILD
)
echo   [2/4] Первый запуск: устанавливаю компоненты.
echo         Займёт 3-5 минут, только один раз.
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto ERR_NPM
echo.

REM ================= 3. Сборка =================
:BUILD
if exist ".next\BUILD_ID" (
  echo   [3/4] Приложение уже собрано
  goto RUN
)
echo   [3/4] Собираю приложение. 1-2 минуты, только один раз.
echo.
call npm run build
if errorlevel 1 goto ERR_BUILD
echo.

REM ================= 4. Запуск =================
:RUN
echo   [4/4] Запускаю сервер...
echo.
echo   ============================================
echo    Браузер откроется сам через несколько секунд.
echo    Адрес: http://localhost:3000
echo.
echo    ЧТОБЫ ЗАКРЫТЬ ПРОГРАММУ - просто закройте
echo    это чёрное окно.
echo   ============================================
echo.

start "" /b cmd /c "for /l %%i in (1,1,90) do (curl -s -o nul http://localhost:3000 && (start "" http://localhost:3000 & exit) || ping -n 2 127.0.0.1 >nul)"

call npm run start
goto END

:ERR_NPM
echo.
echo   ОШИБКА при установке компонентов.
echo   Проверьте интернет и запустите файл снова.
echo.
pause
exit /b

:ERR_BUILD
echo.
echo   ОШИБКА при сборке.
echo   Запустите файл "Переустановить.bat".
echo.
pause
exit /b

:END
echo.
echo   Сервер остановлен.
pause
