@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   荣资商厦服务技能大赛 - 本地 TTS 语音服务
echo ============================================
echo.

REM 赛场无外网时改用离线引擎，把下面一行的 rem 去掉：
REM set RZ_TTS_ENGINE=piper

python server.py

echo.
echo 服务已停止。按任意键关闭窗口。
pause >nul
