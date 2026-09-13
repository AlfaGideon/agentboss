@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM Node 22+ так доверяет системному хранилищу корневых сертификатов Windows,
REM а в нём как раз лежат сертификаты антивирусов, перехватывающих HTTPS.
set "NODE_USE_SYSTEM_CA=1"
title Ставка PRO - анализ линий букмекеров
cd /d "%~dp0"
cls
echo.
echo   ==========================================
echo             С Т А В К А   P R O
echo      анализ линий российских букмекеров
echo   ==========================================
echo.

REM ============ 1. Ищем Node.js ============
set "NODEDIR="
where node >nul 2>nul && goto NODE_OK
if exist "%ProgramFiles%\nodejs\node.exe" set "NODEDIR=%ProgramFiles%\nodejs"
if not defined NODEDIR if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODEDIR=%ProgramFiles(x86)%\nodejs"
if not defined NODEDIR if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODEDIR=%LOCALAPPDATA%\Programs\nodejs"
if defined NODEDIR (
  set "PATH=!NODEDIR!;%PATH%"
  goto NODE_OK
)

echo   [1/4] Node.js не найден. Устанавливаю сам...
echo         Это займёт пару минут, ничего не нажимайте.
echo.
where winget >nul 2>nul || goto NODE_MANUAL
winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements >nul 2>nul

REM подхватываем Node без перезапуска окна
if exist "%ProgramFiles%\nodejs\node.exe" set "NODEDIR=%ProgramFiles%\nodejs"
if not defined NODEDIR if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODEDIR=%ProgramFiles(x86)%\nodejs"
if not defined NODEDIR if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODEDIR=%LOCALAPPDATA%\Programs\nodejs"
if defined NODEDIR (
  set "PATH=!NODEDIR!;%PATH%"
  goto NODE_OK
)
where node >nul 2>nul && goto NODE_OK

:NODE_MANUAL
echo.
echo   Автоматически не получилось.
echo   Открываю сайт: нажмите зелёную кнопку LTS,
echo   установите (везде "Далее"), затем запустите
echo   этот файл ещё раз.
echo.
start "" https://nodejs.org/ru
echo   Нажмите любую клавишу, чтобы закрыть...
pause >nul
exit /b

:NODE_OK
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODEV=%%v"
echo   [1/4] Node.js !NODEV! - готов

echo.
echo   ------------------------------------------
echo    ВЫБЕРИТЕ РЕЖИМ ЗАПУСКА:
echo.
echo      1 - Обычный:    сборка и быстрый старт
echo      2 - Разработка: npm install ^&^& npm run dev
echo                      (правки в коде видны сразу)
echo   ------------------------------------------
echo   Через 10 секунд выберу обычный режим сам.
echo.
choice /c 12 /n /d 1 /t 10 2>nul
set "MODE=1"
if "!ERRORLEVEL!"=="2" set "MODE=2"
if "!MODE!"=="2" (
  echo   Выбрано: РЕЖИМ РАЗРАБОТКИ (npm run dev^)
  echo.
  echo   Страницы собираются на лету, правки в
  echo   коде применятся сразу после сохранения.
  echo   Первая загрузка страницы - медленнее.
) else (
  echo   Выбрано: обычный режим.
)
echo.
if "!MODE!"=="2" goto DEV_INSTALL

REM ============ 2. Компоненты ============
if exist "node_modules\next\package.json" (
  echo   [2/4] Компоненты - на месте
  goto BUILD
)
echo   [2/4] Первая установка компонентов.
echo         3-5 минут, только один раз. Ждите.
echo.
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 goto ERR_NPM
echo.

REM ============ 3. Сборка ============
:BUILD
if exist ".next\BUILD_ID" (
  echo   [3/4] Приложение - уже собрано
  goto PORT
)
echo   [3/4] Собираю приложение. 1-2 минуты, только один раз.
echo.
call npm run build
if errorlevel 1 goto ERR_BUILD
echo.

REM ============ 4. Свободный порт ============
:PORT
set "PORT="
for %%p in (3000 3001 3002 3003 3010 4000) do (
  if not defined PORT (
    netstat -ano | find ":%%p " | find "LISTENING" >nul 2>nul
    if errorlevel 1 set "PORT=%%p"
  )
)
if not defined PORT set "PORT=3000"

if "!MODE!"=="2" goto DEV_START

echo   [4/4] Запускаю. Браузер откроется сам.
echo.
echo   ==========================================
echo    Адрес: http://localhost:!PORT!
echo.
echo    ЧТОБЫ ЗАКРЫТЬ ПРОГРАММУ - закройте
echo    это чёрное окно крестиком.
echo   ==========================================
echo.

REM Ждём, пока сервер поднимется, и открываем браузер (без curl)
start "" /b powershell -NoProfile -WindowStyle Hidden -Command ^
  "$p=!PORT!; for($i=0;$i -lt 120;$i++){ try{ $c=New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',$p); $c.Close(); Start-Process ('http://localhost:'+$p); break } catch { Start-Sleep -Milliseconds 500 } }"

call npx next start -H 127.0.0.1 -p !PORT!
goto END

REM ============ Режим разработки: npm install ============
:DEV_INSTALL
echo   [2/4] Обновляю компоненты (npm install^)...
echo         Если всё уже стоит - займёт пару секунд.
echo.
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 goto ERR_NPM
echo.
echo   [3/4] Сборка не нужна: dev-сервер делает её сам.
goto PORT

REM ============ Режим разработки: npm run dev ============
:DEV_START
echo   [4/4] Запуск: npm install ^&^& npm run dev
echo.
echo   ==========================================
echo    Адрес: http://localhost:!PORT!
echo.
echo    Это режим разработки. Он медленнее обычного,
echo    зато сразу видны правки в коде и полные
echo    ошибки в консоли - удобно, если конторы
echo    не отвечают и нужно смотреть причину.
echo   ==========================================
echo.

start "" /b powershell -NoProfile -WindowStyle Hidden -Command ^
  "$p=!PORT!; for($i=0;$i -lt 120;$i++){ try{ $c=New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',$p); $c.Close(); Start-Process ('http://localhost:'+$p); break } catch { Start-Sleep -Milliseconds 500 } }"

if "!PORT!"=="3000" (
  call npm run dev
) else (
  call npx next dev -H 127.0.0.1 -p !PORT!
)
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
echo   ОШИБКА при сборке приложения.
echo   Запустите файл "Переустановить.bat".
echo.
pause
exit /b

:END
echo.
echo   Сервер остановлен.
pause
