# -*- coding: utf-8 -*-
"""
TTS 引擎抽象层
================

每个引擎实现三个方法：available() / voices() / synth()。
server.py 按 ENGINE_PRIORITY 顺序自动挑选第一个可用的引擎，
也可用环境变量 RZ_TTS_ENGINE=edge|piper|chattts|sapi 强制指定。

音质与依赖对比：

| 引擎    | 音质   | 联网 | GPU | 安装难度 |
|---------|--------|------|-----|---------|
| cosy    | 最佳   | 否   | 建议 | 重       |
| chattts | 很好   | 否   | 建议 | 中       |
| piper   | 好     | 否   | 否   | 轻       |
| edge    | 很好   | 需要 | 否   | 极轻     |
| sapi    | 一般   | 否   | 否   | 极轻     |

赛场无外网时用 piper / chattts；有外网且图省事用 edge。
sapi 与浏览器原生 Web Speech 同源（都走 Windows SAPI），仅作兜底。
"""

from __future__ import annotations

import asyncio
import io
import os
import subprocess
import threading
import wave


class EngineError(RuntimeError):
    """引擎不可用或合成失败"""


def float_to_wav(samples, sample_rate: int) -> bytes:
    """float32 [-1,1] 波形数组 → 16bit 单声道 WAV 字节"""
    import numpy as np

    pcm = np.clip(np.asarray(samples, dtype="float32"), -1.0, 1.0)
    pcm = (pcm * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


class BaseEngine:
    name = "base"
    mime = "audio/wav"
    ext = "wav"

    def available(self) -> bool:
        return False

    def voices(self) -> list[str]:
        return []

    def synth(self, text: str, voice: str | None = None, rate: float = 1.0) -> bytes:
        raise NotImplementedError


# ───────────────────────────────────────────────────────
# edge-tts —— 微软神经语音，音质很好，但需要外网
#   pip install edge-tts
# ───────────────────────────────────────────────────────
class EdgeEngine(BaseEngine):
    name = "edge"
    mime = "audio/mpeg"
    ext = "mp3"
    default_voice = "zh-CN-XiaoxiaoNeural"

    ZH_VOICES = [
        "zh-CN-XiaoxiaoNeural",   # 女声，亲和
        "zh-CN-YunxiNeural",      # 男声，活泼（推荐主持播报）
        "zh-CN-YunjianNeural",    # 男声，浑厚（推荐赛事播报）
        "zh-CN-XiaoyiNeural",     # 女声，甜美
        "zh-CN-YunyangNeural",    # 男声，新闻腔
        "zh-CN-liaoning-XiaobeiNeural",
        "zh-CN-shaanxi-XiaoniNeural",
    ]

    def available(self) -> bool:
        try:
            import edge_tts  # noqa: F401
            return True
        except ImportError:
            return False

    def voices(self) -> list[str]:
        return list(self.ZH_VOICES)

    def synth(self, text: str, voice: str | None = None, rate: float = 1.0) -> bytes:
        import edge_tts

        voice = voice or self.default_voice
        pct = int(round((float(rate) - 1.0) * 100))

        async def _run() -> bytes:
            comm = edge_tts.Communicate(text, voice, rate=f"{pct:+d}%")
            buf = bytearray()
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    buf.extend(chunk["data"])
            return bytes(buf)

        data = asyncio.run(_run())
        if not data:
            raise EngineError("edge-tts 返回空音频（通常是断网或语音名无效）")
        return data


# ───────────────────────────────────────────────────────
# piper —— 本地 ONNX 神经 TTS，纯 CPU 可跑，完全离线
#   pip install piper-tts
#   模型下载: https://huggingface.co/rhasspy/piper-voices  (zh_CN-huayan-medium)
#   环境变量 RZ_PIPER_MODEL 指向 .onnx 文件
# ───────────────────────────────────────────────────────
class PiperEngine(BaseEngine):
    name = "piper"
    mime = "audio/wav"
    ext = "wav"

    def __init__(self) -> None:
        self.model = os.environ.get("RZ_PIPER_MODEL", "")
        self._voice = None
        self._lock = threading.Lock()

    def available(self) -> bool:
        if not self.model or not os.path.isfile(self.model):
            return False
        try:
            from piper.voice import PiperVoice  # noqa: F401
            return True
        except ImportError:
            return False

    def voices(self) -> list[str]:
        return [os.path.basename(self.model)] if self.model else []

    def _load(self):
        if self._voice is None:
            from piper.voice import PiperVoice

            self._voice = PiperVoice.load(self.model)
        return self._voice

    def synth(self, text: str, voice: str | None = None, rate: float = 1.0) -> bytes:
        with self._lock:
            v = self._load()
            buf = io.BytesIO()
            with wave.open(buf, "wb") as w:
                # length_scale 越大语速越慢，与 rate 成反比
                v.synthesize(text, w, length_scale=1.0 / max(0.1, float(rate)))
            return buf.getvalue()


# ───────────────────────────────────────────────────────
# ChatTTS —— 本地大模型 TTS，音质很好，建议 GPU
#   pip install ChatTTS torch torchaudio
#   首次运行会自动下载模型权重（约 1GB），赛前请先联网跑一次预热
# ───────────────────────────────────────────────────────
class ChatTTSEngine(BaseEngine):
    name = "chattts"
    mime = "audio/wav"
    ext = "wav"
    SAMPLE_RATE = 24000

    def __init__(self) -> None:
        self._chat = None
        self._spk = None
        self._lock = threading.Lock()

    def available(self) -> bool:
        try:
            import ChatTTS  # noqa: F401
            import torch     # noqa: F401
            return True
        except ImportError:
            return False

    def voices(self) -> list[str]:
        return ["default"]

    def _load(self):
        if self._chat is None:
            import ChatTTS

            chat = ChatTTS.Chat()
            chat.load(compile=False)
            # 固定音色种子，保证全场语音一致
            seed = int(os.environ.get("RZ_CHATTTS_SEED", "2222"))
            import torch

            torch.manual_seed(seed)
            self._spk = chat.sample_random_speaker()
            self._chat = chat
        return self._chat

    def synth(self, text: str, voice: str | None = None, rate: float = 1.0) -> bytes:
        with self._lock:
            chat = self._load()
            params = chat.InferCodeParams(spk_emb=self._spk, temperature=0.3)
            wavs = chat.infer([text], params_infer_code=params)
            if not len(wavs):
                raise EngineError("ChatTTS 返回空音频")
            import numpy as np

            return float_to_wav(np.asarray(wavs[0]).flatten(), self.SAMPLE_RATE)


# ───────────────────────────────────────────────────────
# SAPI (pyttsx3) —— Windows 系统语音，完全离线，音质一般
#   pip install pyttsx3
#   与浏览器原生 Web Speech 同源，仅作兜底/联调用
# ───────────────────────────────────────────────────────
class SapiEngine(BaseEngine):
    name = "sapi"
    mime = "audio/wav"
    ext = "wav"

    def __init__(self) -> None:
        self._lock = threading.Lock()

    def available(self) -> bool:
        try:
            import pyttsx3  # noqa: F401
            return True
        except ImportError:
            return False

    def voices(self) -> list[str]:
        try:
            import pyttsx3

            eng = pyttsx3.init()
            names = [v.name for v in eng.getProperty("voices")]
            eng.stop()
            return names
        except Exception:
            return []

    def synth(self, text: str, voice: str | None = None, rate: float = 1.0) -> bytes:
        import tempfile

        import pyttsx3

        # pyttsx3 的 runAndWait 不能在同一 engine 上并发/重入，
        # 每次新建 engine 并加锁，避免卡死
        with self._lock:
            path = os.path.join(tempfile.gettempdir(), f"rz_tts_{threading.get_ident()}.wav")
            eng = pyttsx3.init()
            try:
                if voice:
                    for v in eng.getProperty("voices"):
                        if v.name == voice:
                            eng.setProperty("voice", v.id)
                            break
                eng.setProperty("rate", int(200 * float(rate)))
                eng.save_to_file(text, path)
                eng.runAndWait()
            finally:
                try:
                    eng.stop()
                except Exception:
                    pass
            if not os.path.isfile(path):
                raise EngineError("pyttsx3 未生成音频文件")
            with open(path, "rb") as f:
                data = f.read()
            try:
                os.remove(path)
            except OSError:
                pass
            return data


# 优先级：音质好且离线的排前面，sapi 兜底
ENGINE_PRIORITY = ["chattts", "piper", "edge", "sapi"]

ALL_ENGINES: dict[str, BaseEngine] = {
    "chattts": ChatTTSEngine(),
    "piper": PiperEngine(),
    "edge": EdgeEngine(),
    "sapi": SapiEngine(),
}


def pick_engine(prefer: str = "") -> BaseEngine | None:
    """按偏好/优先级挑一个可用引擎；都不可用返回 None"""
    if prefer:
        eng = ALL_ENGINES.get(prefer)
        if eng is None:
            raise EngineError(f"未知引擎: {prefer}（可选 {list(ALL_ENGINES)}）")
        if not eng.available():
            raise EngineError(f"引擎 {prefer} 依赖未安装或模型未配置")
        return eng
    for name in ENGINE_PRIORITY:
        eng = ALL_ENGINES[name]
        try:
            if eng.available():
                return eng
        except Exception:
            continue
    return None
