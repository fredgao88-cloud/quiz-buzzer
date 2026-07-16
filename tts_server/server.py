# -*- coding: utf-8 -*-
"""
荣资商厦服务技能大赛 —— 本地 TTS 服务
=====================================

前端 shared.js 的 speak() 会 POST 到本机 /api/speak 取音频播放；
本服务不可用时前端自动回退到浏览器原生 Web Speech，比赛不会中断。

启动：
    cd tts_server
    pip install -r requirements.txt
    python server.py

接口：
    GET  /api/health              → {ok, engine, voices, cache_count}
    POST /api/speak  {text,voice,rate} → audio/wav|audio/mpeg
    GET  /api/voices              → {engine, voices}
    POST /api/prewarm {texts:[]}  → 预合成，赛前跑一次消除首句延迟

环境变量：
    RZ_TTS_ENGINE   强制引擎 edge|piper|chattts|sapi（默认自动挑选）
    RZ_TTS_PORT     端口，默认 5231
    RZ_TTS_VOICE    默认音色
    RZ_PIPER_MODEL  piper 的 .onnx 模型路径
"""

from __future__ import annotations

import hashlib
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Windows 控制台默认 GBK，中文日志会乱码
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

try:
    import uvicorn
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse, Response
    from pydantic import BaseModel
except ImportError:
    sys.exit(
        "缺少依赖，请先执行：\n"
        "    pip install -r requirements.txt\n"
    )

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engines import EngineError, pick_engine  # noqa: E402

PORT = int(os.environ.get("RZ_TTS_PORT", "5231"))
DEFAULT_VOICE = os.environ.get("RZ_TTS_VOICE", "")
# 预热并发数。edge 是网络 IO，调高收益大；本地模型引擎内部有锁，会自动串行，调高无害。
PREWARM_WORKERS = int(os.environ.get("RZ_TTS_PREWARM_WORKERS", "6"))
CACHE_DIR = Path(__file__).resolve().parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)

# 赛事常用话术，赛前预热用（覆盖倒计时数字与固定播报）
PREWARM_TEXTS = [
    "开始抢答",
    "时间到",
    "时间到，作答超时",
    "时间到，无人抢答",
    "时间到，请各队举板",
    "时间到，本队找茬结束",
    *[str(n) for n in range(1, 11)],
]

engine = None


def _cache_path(text: str, voice: str, rate: float) -> Path:
    key = f"{engine.name}|{voice}|{rate:.2f}|{text}"
    h = hashlib.sha256(key.encode("utf-8")).hexdigest()[:32]
    return CACHE_DIR / f"{engine.name}_{h}.{engine.ext}"


def synth_cached(text: str, voice: str, rate: float) -> bytes:
    p = _cache_path(text, voice, rate)
    if p.is_file():
        return p.read_bytes()
    data = engine.synth(text, voice or None, rate)
    p.write_bytes(data)
    return data


app = FastAPI(title="荣资 TTS 服务", docs_url=None, redoc_url=None)

# 前端是 file:// 打开的，Origin 为 null，必须允许任意来源
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _private_network_access(request, call_next):
    """Chrome 的 Private Network Access：公共/file 来源访问 localhost 需此响应头"""
    resp = await call_next(request)
    resp.headers["Access-Control-Allow-Private-Network"] = "true"
    return resp


class SpeakReq(BaseModel):
    text: str
    voice: str = ""
    rate: float = 1.0


class PrewarmReq(BaseModel):
    texts: list[str] = []
    voice: str = ""
    rate: float = 1.0


@app.get("/api/health")
def health():
    return {
        "ok": engine is not None,
        "engine": engine.name if engine else None,
        "mime": engine.mime if engine else None,
        "voices": engine.voices() if engine else [],
        "default_voice": DEFAULT_VOICE,
        "cache_count": len(list(CACHE_DIR.glob("*"))),
    }


@app.get("/api/voices")
def voices():
    return {"engine": engine.name, "voices": engine.voices()}


@app.post("/api/speak")
def speak(req: SpeakReq):
    text = (req.text or "").strip()
    if not text:
        return JSONResponse({"error": "text 不能为空"}, status_code=400)
    if len(text) > 500:
        return JSONResponse({"error": "text 过长（上限 500 字）"}, status_code=400)
    voice = req.voice or DEFAULT_VOICE
    t0 = time.time()
    try:
        data = synth_cached(text, voice, req.rate)
    except EngineError as e:
        return JSONResponse({"error": str(e)}, status_code=503)
    except Exception as e:  # 合成失败不能拖垮服务，前端会回退原生语音
        print(f"[tts] 合成失败: {e!r}", flush=True)
        return JSONResponse({"error": f"合成失败: {e}"}, status_code=500)
    ms = int((time.time() - t0) * 1000)
    print(f"[tts] {ms:>5}ms  {text[:40]}", flush=True)
    return Response(
        content=data,
        media_type=engine.mime,
        headers={"Cache-Control": "no-store", "X-Synth-Ms": str(ms)},
    )


@app.post("/api/prewarm")
def prewarm(req: PrewarmReq):
    """并发预合成。串行跑几十条要一分多钟，赛前等不起。"""
    texts = list(dict.fromkeys(req.texts or PREWARM_TEXTS))  # 去重且保序
    voice = req.voice or DEFAULT_VOICE
    ok, failed = 0, []
    t0 = time.time()

    def _one(t: str):
        try:
            synth_cached(t, voice, req.rate)
            return None
        except Exception as e:
            return {"text": t, "error": str(e)}

    with ThreadPoolExecutor(max_workers=PREWARM_WORKERS) as ex:
        for r in ex.map(_one, texts):
            if r is None:
                ok += 1
            else:
                failed.append(r)

    secs = round(time.time() - t0, 1)
    print(f"[tts] 预热完成: {ok} 成功 / {len(failed)} 失败 / {secs}s", flush=True)
    return {
        "ok": ok,
        "failed": failed,
        "seconds": secs,
        "cache_count": len(list(CACHE_DIR.glob("*"))),
    }


def main() -> None:
    global engine
    prefer = os.environ.get("RZ_TTS_ENGINE", "")
    try:
        engine = pick_engine(prefer)
    except EngineError as e:
        sys.exit(f"[tts] 引擎初始化失败: {e}")
    if engine is None:
        sys.exit(
            "[tts] 没有可用的 TTS 引擎。至少安装一个：\n"
            "    pip install edge-tts      # 音质好，需外网\n"
            "    pip install piper-tts     # 离线，纯 CPU，需下载模型\n"
            "    pip install ChatTTS torch # 离线，音质最好，建议 GPU\n"
            "    pip install pyttsx3       # 离线兜底，音质一般\n"
        )
    print(f"[tts] 引擎: {engine.name}   端口: {PORT}   缓存: {CACHE_DIR}", flush=True)
    print(f"[tts] 健康检查: http://127.0.0.1:{PORT}/api/health", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
