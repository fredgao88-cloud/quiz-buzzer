# 本地 TTS 语音服务

给答题系统提供高质量中文语音，替代浏览器自带的机械音色。

**这是可选组件。** 不启动它，系统照常运行，只是用回浏览器原生语音——
控制台每 30 秒探测一次，服务启停都能自动跟上，比赛中途挂掉也会立刻回退，不会哑火。

---

## 快速开始

```bash
cd tts_server
pip install -r requirements.txt
python server.py
```

或直接双击 `启动TTS服务.bat`。

看到这两行就是好了：

```
[tts] 引擎: edge   端口: 5231   缓存: ...\tts_server\cache
[tts] 健康检查: http://127.0.0.1:5231/api/health
```

然后打开控制台 `index.html` → 设置 → 语音朗读 TTS，
「服务状态」应显示 **● 已连接**。

---

## 赛前必做：点一次「预热」

设置面板里有 **[赛前预热]** 按钮，点一次，等十几秒。

它把固定话术（"开始抢答"、倒计时数字、各队名的抢答/违规/出局播报）提前合成好存进缓存。

实测差距很大：

| | 未预热 | 已预热 |
|---|---|---|
| 单条话术 | 约 3.4 秒 | 约 15 毫秒 |

倒计时"3、2、1"不预热会明显拖拍。**改过队名后要重新预热**（话术里含队名）。

题目正文是动态的，没法预热，首句约 3 秒延迟。读题是多段并行合成的，
第一段响了之后就不会再断。

---

## 引擎怎么选

服务启动时自动挑第一个可用的，也可以用环境变量强制指定：

```bash
set RZ_TTS_ENGINE=piper
python server.py
```

| 引擎 | 音质 | 联网 | GPU | 安装 |
|------|------|------|-----|------|
| `chattts` | 很好 | 否 | 建议 | `pip install ChatTTS torch torchaudio` |
| `piper` | 好 | 否 | 否 | `pip install piper-tts` + 下模型 |
| `edge` | 很好 | **需要** | 否 | `pip install edge-tts`（默认） |
| `sapi` | 一般 | 否 | 否 | `pip install pyttsx3` |

**选型建议**：

- **赛场有稳定外网** → 用默认的 `edge`，装起来最省事，音色是微软神经语音，效果好。
- **赛场没外网** → 用 `piper`，纯 CPU 能跑，完全离线。需要额外下模型：
  从 [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) 下
  `zh_CN-huayan-medium`（.onnx + .onnx.json 两个文件放一起），然后：
  ```bash
  set RZ_PIPER_MODEL=D:\voices\zh_CN-huayan-medium.onnx
  set RZ_TTS_ENGINE=piper
  python server.py
  ```
- **要最好音质且有 GPU** → `chattts`，首次运行会自动下约 1GB 权重，**务必赛前联网跑一次**。
- `sapi` 和浏览器原生同源（都走 Windows SAPI），音质没有提升，仅作兜底。

`edge` 音色可在设置面板的「服务音色」下拉里换，推荐 `zh-CN-YunjianNeural`（男声浑厚，
适合赛事播报）或 `zh-CN-YunxiNeural`（男声活泼）。

---

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `RZ_TTS_ENGINE` | 自动 | 强制引擎：`edge`/`piper`/`chattts`/`sapi` |
| `RZ_TTS_PORT` | `5231` | 端口，改了要同步改控制台设置里的服务地址 |
| `RZ_TTS_VOICE` | 空 | 默认音色 |
| `RZ_PIPER_MODEL` | 空 | piper 的 .onnx 模型路径 |
| `RZ_CHATTTS_SEED` | `2222` | ChatTTS 音色种子，固定它保证全场音色一致 |
| `RZ_TTS_PREWARM_WORKERS` | `6` | 预热并发数 |

---

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | `{ok, engine, mime, voices, cache_count}` |
| POST | `/api/speak` | `{text, voice, rate}` → 音频字节 |
| GET | `/api/voices` | 当前引擎的音色列表 |
| POST | `/api/prewarm` | `{texts, voice, rate}` → 并发预合成 |

服务只监听 `127.0.0.1`，不对外暴露。

---

## 缓存

合成结果按 `引擎+音色+语速+文本` 哈希存在 `cache/` 下，命中时约 15ms 返回。

缓存不会自动清理。换引擎或换音色后旧文件是死的，可以直接删掉整个 `cache/` 目录，
下次预热会重建。

---

## 排错

**控制台显示"未连接"**

1. 确认服务窗口没报错、还在跑
2. 浏览器打开 http://127.0.0.1:5231/api/health 看是否返回 JSON
3. 端口被占用就换一个：`set RZ_TTS_PORT=5232`，同时改控制台设置里的服务地址

**edge 引擎报 "No audio was received"**

edge-tts 要连微软服务器，先确认外网通。公司网络限制的话就改用 `piper`。

**声音没出来但状态是"已连接"**

浏览器的自动播放限制——先在页面上点一下任意按钮，让页面拿到用户手势。

**音质没变化**

看服务窗口第一行的引擎名。如果是 `sapi`，那和浏览器原生是同一套系统语音，
装 `edge-tts` 或 `piper` 才有提升。
