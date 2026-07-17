@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 荣资商厦服务技能大赛 - 比赛服务（请勿关闭本窗口）

echo ============================================================
echo    荣资商厦服务技能大赛 - 比赛服务
echo ============================================================
echo.
echo   [!] 比赛全程请勿关闭本窗口，关掉服务就停了。
echo.
echo   控制台： http://localhost:8080/index.html
echo   大屏  ： 用控制台顶栏的 [打开展示页] 按钮打开，不要手动输网址
echo.
echo   赛前自检：
echo     1. 顶栏没有红色「尚未导入题库」
echo     2. 已抽签、已分配图题
echo     3. 点一次「个人必答」能看到翻牌界面
echo.
echo ============================================================
echo.

REM 只监听本机。两个页面靠 localStorage + BroadcastChannel 同步，
REM 必须在同一台电脑的同一个浏览器里，对外开放端口没有意义。
start "" http://localhost:8080/index.html
python -m http.server 8080 --bind 127.0.0.1

echo.
echo 服务已停止。按任意键关闭窗口。
pause >nul
