"""Real DashScope / Alibaba Model Studio clients.

Selected by RECUT_MODEL_BACKEND=qwen. Every client wraps DashScope with retry +
exponential backoff and maps failures to the same return shapes the stubs use, so the
pipeline never sees a difference. If a call ultimately fails, the caller's fallback
(deterministic recipe, last-good line, stand-in) takes over — never a blank or a 500.

dashscope is an optional dependency (pip install -e ".[models]"). Imported lazily so
the stub path needs nothing.
"""

from __future__ import annotations

import json
import os
import time
from typing import Callable, TypeVar

from recut.core.config import Settings
from recut.core.models import (
    GenAsset,
    ImageGen,
    ModelClients,
    Shot,
    TextLLM,
    Transcriber,
    TranscriptResult,
    VideoGen,
    VisionAnalyzer,
    VisionResult,
    VoiceGen,
)

T = TypeVar("T")


def _retry(fn: Callable[[], T], *, attempts: int = 3, base_delay: float = 1.0) -> T:
    last: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 — retried; re-raised below for caller fallback
            last = exc
            if i < attempts - 1:
                time.sleep(base_delay * (2**i))
    assert last is not None
    raise last


# wan2.2-t2i-flash accepts a fixed set of sizes; 1080*1920 is NOT one of them (returns
# empty). Snap requested dims to the nearest supported size by aspect ratio.
_IMAGE_SIZES = {"portrait": "720*1280", "landscape": "1280*720", "square": "1024*1024"}


def _snap_image_size(width: int, height: int) -> str:
    if not width or not height:
        return _IMAGE_SIZES["portrait"]
    ar = width / height
    if ar < 0.85:
        return _IMAGE_SIZES["portrait"]
    if ar > 1.18:
        return _IMAGE_SIZES["landscape"]
    return _IMAGE_SIZES["square"]


def _extract_json(text: str) -> dict:
    """Pull the first JSON object out of an LLM response, tolerating code fences."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1]
        t = t[4:] if t.lower().startswith("json") else t
    start, end = t.find("{"), t.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object in model response")
    return json.loads(t[start : end + 1])


class QwenVision(VisionAnalyzer):
    def __init__(self, s: Settings):
        self.s = s

    def analyze(self, video_path: str, *, hint: str = "") -> VisionResult:
        """Robust reference analysis: ffmpeg detects real shot boundaries, then Qwen-VL
        describes one keyframe per shot. Far more reliable than asking the model to
        self-report shot times (it tends to call a whole reel 'one shot')."""
        import os
        import tempfile

        import dashscope

        from recut.pipeline.shots import extract_keyframe, probe_duration, shot_boundaries

        dur = probe_duration(video_path) or 0.0
        shots = shot_boundaries(video_path, dur)
        frame_dir = tempfile.mkdtemp(prefix="recut-vl-")
        frames: list[tuple[tuple[float, float], str | None]] = [
            ((s, e), extract_keyframe(video_path, (s + e) / 2, frame_dir)) for (s, e) in shots
        ]
        usable = [(span, fp) for span, fp in frames if fp]
        if not usable:
            raise RuntimeError("could not extract keyframes for analysis")

        content = [{"image": "file://" + os.path.abspath(fp)} for _, fp in usable]
        n = len(usable)
        content.append({"text": (
            f"These {n} keyframes are sampled one per shot, IN ORDER, from a {dur:.0f}s vertical "
            f"short-form video (reel). For EACH image, in order, return one entry. Return STRICT JSON: "
            '{"shots":[{"description":str,"on_screen_text":str,"motion":"static|slow|fast-cut"}]}. '
            "description = what is visually happening in that shot; on_screen_text = any text visible "
            f"in the frame (empty if none). Return exactly {n} entries. " + hint
        )})

        def call() -> VisionResult:
            resp = dashscope.MultiModalConversation.call(
                api_key=self.s.dashscope_api_key,
                model=self.s.qwen_vl_model,
                messages=[{"role": "user", "content": content}],
            )
            if getattr(resp, "status_code", 200) != 200:
                raise RuntimeError(f"qwen-vl {getattr(resp, 'code', '?')}: {getattr(resp, 'message', resp)}")
            raw = resp["output"]["choices"][0]["message"]["content"]
            text = raw if isinstance(raw, str) else " ".join(
                p.get("text", "") for p in raw if isinstance(p, dict)
            )
            descs = _extract_json(text).get("shots", [])
            out_shots = []
            for i, ((s, e), _) in enumerate(usable):
                d = descs[i] if i < len(descs) else {}
                out_shots.append(Shot(
                    start_s=s, end_s=e,
                    description=d.get("description", ""),
                    on_screen_text=d.get("on_screen_text", ""),
                    motion=d.get("motion", "static"),
                ))
            return VisionResult(
                duration_s=dur or (out_shots[-1].end_s if out_shots else 0),
                shots=out_shots, aspect_ratio="9:16",
                tokens=int(resp.get("usage", {}).get("total_tokens", 0) or 0), confidence=0.8,
            )

        return _retry(call)


class QwenTranscriber(Transcriber):
    def __init__(self, s: Settings):
        self.s = s

    def transcribe(self, media_path: str) -> TranscriptResult:
        import dashscope

        def call() -> TranscriptResult:
            resp = dashscope.audio.asr.Transcription.call(
                api_key=self.s.dashscope_api_key, model=self.s.asr_model, file=media_path
            )
            out = resp["output"]
            text = out.get("text", "") if isinstance(out, dict) else str(out)
            segs = out.get("sentences", []) if isinstance(out, dict) else []
            return TranscriptResult(
                text=text,
                segments=[
                    {"start_s": s.get("begin_time", 0) / 1000, "end_s": s.get("end_time", 0) / 1000, "text": s.get("text", "")}
                    for s in segs
                ],
                confidence=0.85,
            )

        return _retry(call)


class QwenText(TextLLM):
    def __init__(self, s: Settings):
        self.s = s

    def complete(self, system: str, user: str, *, json_mode: bool = False) -> tuple[str, int]:
        import dashscope

        def call() -> tuple[str, int]:
            resp = dashscope.Generation.call(
                api_key=self.s.dashscope_api_key,
                model=self.s.qwen_text_model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                result_format="message",
            )
            text = resp["output"]["choices"][0]["message"]["content"]
            tokens = int(resp.get("usage", {}).get("total_tokens", 0) or 0)
            if json_mode:
                # normalize to compact JSON so callers can json.loads it
                text = json.dumps(_extract_json(text))
            return text, tokens

        return _retry(call)


class QwenVideoGen(VideoGen):
    def __init__(self, s: Settings):
        self.s = s

    def generate(self, prompt: str, *, duration_s: float, seed: int = 0) -> GenAsset:
        import dashscope
        import httpx

        def call() -> GenAsset:
            rsp = dashscope.VideoSynthesis.call(
                api_key=self.s.dashscope_api_key, model=self.s.wan_model, prompt=prompt,
                size=self.s.wan_size,
            )
            if getattr(rsp, "status_code", 200) != 200:
                raise RuntimeError(f"wan {getattr(rsp, 'code', '?')}: {getattr(rsp, 'message', rsp)}")
            out = rsp.output
            status = getattr(out, "task_status", "")
            url = getattr(out, "video_url", "") or ""
            if status != "SUCCEEDED" or not url:
                raise RuntimeError(f"wan task {status}: {getattr(out, 'message', '') or 'no video_url'}")
            data = httpx.get(url, timeout=180).content
            return GenAsset(data=data, mime="video/mp4", duration_s=duration_s, tokens=int(duration_s * 1800))

        return _retry(call, attempts=2, base_delay=3.0)

    def generate_from_image(self, image_url: str, prompt: str, *, duration_s: float, seed: int = 0) -> GenAsset:
        import dashscope
        import httpx

        def call() -> GenAsset:
            rsp = dashscope.VideoSynthesis.call(
                api_key=self.s.dashscope_api_key, model=self.s.wan_i2v_model, prompt=prompt,
                img_url=image_url,
            )
            if getattr(rsp, "status_code", 200) != 200:
                raise RuntimeError(f"wan-i2v {getattr(rsp, 'code', '?')}: {getattr(rsp, 'message', rsp)}")
            out = rsp.output
            status = getattr(out, "task_status", "")
            url = getattr(out, "video_url", "") or ""
            if status != "SUCCEEDED" or not url:
                raise RuntimeError(f"wan-i2v task {status}: {getattr(out, 'message', '') or 'no video_url'}")
            data = httpx.get(url, timeout=180).content
            return GenAsset(data=data, mime="video/mp4", duration_s=duration_s, tokens=int(duration_s * 1800))

        return _retry(call, attempts=2, base_delay=3.0)


class QwenImageGen(ImageGen):
    def __init__(self, s: Settings):
        self.s = s

    def generate(self, prompt: str, *, width: int, height: int) -> GenAsset:
        import dashscope
        import httpx

        size = _snap_image_size(width, height)

        def call() -> GenAsset:
            rsp = dashscope.ImageSynthesis.call(
                api_key=self.s.dashscope_api_key, model=self.s.qwen_image_model, prompt=prompt,
                n=1, size=size,
            )
            if getattr(rsp, "status_code", 200) != 200:
                raise RuntimeError(f"image {getattr(rsp, 'code', '?')}: {getattr(rsp, 'message', rsp)}")
            results = getattr(rsp.output, "results", None) or []
            if not results:
                raise RuntimeError(f"image returned no results (size={size}, task={getattr(rsp.output,'task_status','?')})")
            url = results[0].url
            data = httpx.get(url, timeout=60).content
            return GenAsset(data=data, mime="image/png", tokens=250, url=url)

        return _retry(call, attempts=2, base_delay=2.0)


class QwenVoiceGen(VoiceGen):
    def __init__(self, s: Settings):
        self.s = s

    def synthesize(self, text: str, *, voice: str = "default") -> GenAsset:
        import dashscope

        chosen = self.s.cosyvoice_voice if voice in ("", "default", None) else voice

        def call() -> GenAsset:
            synth = dashscope.audio.tts_v2.SpeechSynthesizer(
                model=self.s.cosyvoice_model, voice=chosen
            )
            audio = synth.call(text)
            return GenAsset(data=audio, mime="audio/mp3", duration_s=max(1.0, len(text) * 0.06), tokens=len(text))

        return _retry(call)


def build_qwen_clients(s: Settings) -> ModelClients:
    if not s.dashscope_api_key:
        raise RuntimeError(
            "RECUT_MODEL_BACKEND=qwen but RECUT_DASHSCOPE_API_KEY is empty. "
            "Set the key or use RECUT_MODEL_BACKEND=stub."
        )
    # macOS / python.org Python often lacks a CA bundle, which breaks the CosyVoice
    # websocket (wss) with CERTIFICATE_VERIFY_FAILED. Point OpenSSL at certifi.
    try:
        import certifi

        os.environ.setdefault("SSL_CERT_FILE", certifi.where())
        os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
    except Exception:
        pass

    # Configure the SDK globally: some sub-APIs (tts_v2, image/video synthesis) read the
    # module-level api_key/base_url rather than per-call kwargs.
    import dashscope

    dashscope.api_key = s.dashscope_api_key
    if s.dashscope_base_url:
        dashscope.base_http_api_url = s.dashscope_base_url
        # CosyVoice (tts_v2) uses a websocket on a DIFFERENT endpoint; without this it
        # hits the China host and an intl key 401s. Derive the wss endpoint from the base.
        dashscope.base_websocket_api_url = (
            s.dashscope_base_url.replace("https://", "wss://").replace("http://", "ws://")
            .replace("/api/v1", "/api-ws/v1/inference")
        )
    return ModelClients(
        vision=QwenVision(s),
        transcriber=QwenTranscriber(s),
        text=QwenText(s),
        video=QwenVideoGen(s),
        image=QwenImageGen(s),
        voice=QwenVoiceGen(s),
    )
