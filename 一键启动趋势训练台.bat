@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "ROOT=%~dp0"
set "PORT=4173"
set "URL=http://127.0.0.1:%PORT%/"
cd /d "%ROOT%"

echo.
echo  趋势训练台
 echo 正在检查本地服务...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if ($c) { exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 goto open_browser

where py >nul 2>&1
if not errorlevel 1 (
    echo 正在启动 Python 本地服务，端口 %PORT%...
    start "趋势训练台服务" /D "%ROOT%" cmd /k "py -3 -m http.server %PORT% --bind 127.0.0.1"
    goto wait_server
)

where python >nul 2>&1
if not errorlevel 1 (
    echo 正在启动 Python 本地服务，端口 %PORT%...
    start "趋势训练台服务" /D "%ROOT%" cmd /k "python -m http.server %PORT% --bind 127.0.0.1"
    goto wait_server
)

echo.
echo 未找到 Python。请先安装 Python 3，并确保勾选“Add Python to PATH”。
pause
exit /b 1

:wait_server
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok = $false; 1..20 | ForEach-Object { if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { $ok = $true; break }; Start-Sleep -Milliseconds 250 }; if (-not $ok) { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo 服务启动超时，请检查 Python 窗口中的错误信息。
    pause
    exit /b 1
)

:open_browser
echo 正在打开趋势训练台：%URL%
start "" "%URL%"
exit /b 0