#!/bin/bash
# 荣资商厦服务技能大赛 · 比赛服务（macOS）
#
# 双击本文件即可启动。相比手敲 python serve.py，多做了三件事：
#   1. caffeinate  —— 运行期间阻止 Mac 空闲休眠，休眠会掐断局域网访问
#   2. 自动重启    —— 进程意外退出后 3 秒自动拉起，不会在比赛中途静默停服
#   3. 固定工作目录 —— 双击运行时当前目录是用户主目录，必须 cd 回项目里
#
# ⚠️ 关闭这个终端窗口 = 停止服务。比赛全程不要关。

cd "$(dirname "$0")" || exit 1

# Ctrl+C 时真正退出，不要被下面的 while 循环重新拉起
trap 'echo; echo "服务已停止。"; exit 0' INT TERM

PY="$(command -v python3 || command -v python)"
if [ -z "$PY" ]; then
  echo "找不到 python，请先安装 Python 3.10 或更高版本。"
  read -r -p "按回车关闭…" _
  exit 1
fi

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)

echo "============================================================"
echo "   荣资商厦服务技能大赛 · 比赛服务"
echo "============================================================"
echo
echo "  [!] 比赛全程请勿关闭本窗口，关掉服务就停了。"
echo
echo "  本机访问：       http://localhost:8080/index.html"
[ -n "$IP" ] && echo "  局域网其他电脑： http://$IP:8080/index.html"
echo "  大屏：           用控制台顶栏的〔打开展示页〕按钮打开，不要手动输网址"
echo
echo "  [!] 控制台和大屏必须开在同一台电脑的同一个浏览器里 ——"
echo "      两个页面靠 localStorage + BroadcastChannel 同步，不走网络。"
echo "      换一台电脑访问就是另一套独立的分数，不会同步。"
echo
echo "  赛前自检："
echo "    1. 顶栏没有红色「尚未导入题库」"
echo "    2. 已导入 questions.json（384 题），已抽签、已分配图题"
echo "    3. 第四环节五张场景图都能正常显示"
echo "    4. 五张图的找茬点坐标都已标注"
echo
echo "============================================================"
echo

# caffeinate -i：进程存活期间阻止空闲休眠（合上盖子仍会睡，比赛时别合盖）
while true; do
  caffeinate -i "$PY" serve.py 8080
  echo
  echo "⚠ 服务意外退出，3 秒后自动重启…（真要停止请按 Ctrl+C）"
  sleep 3
done
