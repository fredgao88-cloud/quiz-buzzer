#!/bin/bash
# 荣资商厦服务技能大赛 · 语音服务（macOS）
#
# 双击启动。与比赛服务分开跑，两个窗口都不要关。
# 不启动也能比赛 —— 控制台会自动回退到浏览器自带语音，只是音质差些；
# 但 Windows 11 客户机常常没装中文语音包，回退后会完全没声音，所以建议启动。
#
# 赛场无外网时：把下面 RZ_TTS_ENGINE=piper 那行前面的 # 去掉（edge 引擎需要外网）。

cd "$(dirname "$0")" || exit 1

trap 'echo; echo "语音服务已停止。"; exit 0' INT TERM

PY="$(command -v python3 || command -v python)"
if [ -z "$PY" ]; then
  echo "找不到 python，请先安装 Python 3.10 或更高版本。"
  read -r -p "按回车关闭…" _
  exit 1
fi

# export RZ_TTS_ENGINE=piper

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)

echo "============================================================"
echo "   荣资商厦服务技能大赛 · 语音(TTS)服务"
echo "============================================================"
echo
echo "  [!] 比赛全程请勿关闭本窗口。"
echo
[ -n "$IP" ] && echo "  局域网访问地址： http://$IP:5231"
echo "  控制台〔设置 → TTS → 服务地址〕留空即自动跟随，无需手填。"
echo
echo "  从别的电脑访问控制台时，服务地址【不要】填 127.0.0.1 ——"
echo "  那指向客户机自己，连不上就会静默退回浏览器自带语音。"
echo
echo "============================================================"
echo

while true; do
  caffeinate -i "$PY" server.py
  echo
  echo "⚠ 语音服务意外退出，3 秒后自动重启…（真要停止请按 Ctrl+C）"
  sleep 3
done
