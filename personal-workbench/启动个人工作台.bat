@echo off
chcp 65001 >nul
setlocal

rem ============================================
rem   个人工作台 一键启动
rem   1. 启动 backend 服务 (npm start)
rem   2. 用默认浏览器打开工作台页面
rem   注意：必须通过 http://127.0.0.1:8787/ 打开，
rem         直接双击 personal-workbench.html（file://）会因
rem         浏览器安全限制拿不到数据，页面只显示空壳。
rem   脚本放在工作台根目录即可，路径自动识别
rem ============================================

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"

cd /d "%BACKEND%"

echo.
echo  [1/2] 正在启动后端服务，请在弹出的窗口中保持运行...
echo.
start "Workbench Backend" /d "%BACKEND%" cmd /k "npm start"

echo  [2/2] 正在打开个人工作台（http://127.0.0.1:8787/）...
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:8787/"

echo.
echo  启动完成！关闭后端服务窗口即可停止服务。
timeout /t 3 /nobreak >nul
