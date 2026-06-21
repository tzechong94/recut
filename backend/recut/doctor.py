"""recut-doctor — preflight the live model layer before spending on a full run.

Pings each model through the SAME client code the pipeline uses, so it surfaces real
request/response-shape mismatches (the most likely first-run failure) for a few cents.

    recut-doctor          # cheap checks: text, image, voice, vision
    recut-doctor --full   # also Wan b-roll (slow, ~$0.20-0.60) and ASR

Reads config from the environment / .env. With RECUT_MODEL_BACKEND=stub it validates the
harness offline (responses are stubs, clearly labeled).
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path

from recut.core.config import get_settings


def _tiny_video() -> str | None:
    # Prefer a real sample reel — vision models reject tiny synthetic clips as "invalid".
    samples = Path(__file__).resolve().parents[2] / "assets" / "samples"
    for cand in sorted(samples.glob("*.mp4")):
        return str(cand)
    if not shutil.which("ffmpeg"):
        return None
    out = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False).name
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=teal:s=720x1280:d=3:r=24",
             "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", out],
            capture_output=True, check=True,
        )
        return out
    except Exception:
        return None


def _tiny_wav() -> str | None:
    if not shutil.which("ffmpeg"):
        return None
    out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
             "-ar", "16000", out],
            capture_output=True, check=True,
        )
        return out
    except Exception:
        return None


def _snip(value, n: int = 160) -> str:
    return repr(value)[:n]


def run(full: bool = False) -> dict:
    """Run preflight checks. Returns a structured report (also printed by main())."""
    s = get_settings()
    checks: list[dict] = []

    def check(name: str, model_id: str, fn, *, cost: str) -> None:
        try:
            detail = fn()
            checks.append({"model": name, "id": model_id, "status": "ok", "detail": detail, "cost": cost})
        except Exception as exc:  # noqa: BLE001 — that's the whole point of a doctor
            checks.append({"model": name, "id": model_id, "status": "error", "detail": f"{type(exc).__name__}: {exc}", "cost": cost})

    report = {
        "backend": s.model_backend,
        "base_url": s.dashscope_base_url or "(SDK default / China)",
        "key_set": bool(s.dashscope_api_key),
        "checks": checks,
    }

    if s.model_backend == "qwen" and not s.dashscope_api_key:
        report["fatal"] = "RECUT_MODEL_BACKEND=qwen but no RECUT_DASHSCOPE_API_KEY set."
        return report

    from recut.core.models import get_models

    try:
        m = get_models(s)
    except Exception as exc:  # noqa: BLE001
        report["fatal"] = f"could not build model clients: {exc}"
        return report

    # --- cheap checks ---
    check("text (Qwen-Max)", s.qwen_text_model,
          lambda: _snip(m.text.complete("Reply with the single word OK.", "ping")), cost="~$0.001")

    check("image (Qwen-Image)", s.qwen_image_model,
          lambda: f"{len(m.image.generate('a plain solid blue background', width=512, height=512).data)} bytes", cost="~$0.01-0.05")

    check("voice (CosyVoice)", s.cosyvoice_model,
          lambda: f"{len(m.voice.synthesize('hello from recut').data)} bytes", cost="<$0.01")

    vid = _tiny_video()
    if vid:
        check("vision (Qwen-VL)", s.qwen_vl_model, lambda: _vision_detail(m, vid), cost="~$0.01-0.05")
    else:
        checks.append({"model": "vision (Qwen-VL)", "id": s.qwen_vl_model, "status": "skipped", "detail": "ffmpeg not available to make a test clip", "cost": "-"})

    # --- expensive / awkward checks (opt-in) ---
    if full:
        wav = _tiny_wav()
        if wav:
            check("asr (Paraformer)", s.asr_model,
                  lambda: _snip(m.transcriber.transcribe(wav).text or "(empty transcript, call OK)"), cost="<$0.01")
        else:
            checks.append({"model": "asr (Paraformer)", "id": s.asr_model, "status": "skipped", "detail": "ffmpeg not available", "cost": "-"})

        check("video (Wan b-roll)", s.wan_model,
              lambda: f"{len(m.video.generate('a calm ocean at sunset', duration_s=2).data)} bytes", cost="~$0.20-0.60")
    else:
        for name, mid in (("asr (Paraformer)", s.asr_model), ("video (Wan b-roll)", s.wan_model)):
            checks.append({"model": name, "id": mid, "status": "skipped", "detail": "run with --full", "cost": "-"})

    return report


def _vision_detail(m, vid: str) -> str:
    vr = m.vision.analyze(vid)
    return f"{len(vr.shots)} shots, {vr.duration_s}s, conf={vr.confidence}"


def _print(report: dict) -> None:
    icons = {"ok": "✅", "error": "❌", "skipped": "⏭ "}
    print("\nRecut doctor")
    print("─" * 60)
    print(f"backend : {report['backend']}")
    print(f"endpoint: {report['base_url']}")
    print(f"key set : {report['key_set']}")
    if report["backend"] == "stub":
        print("NOTE: backend=stub — responses below are deterministic STUBS, not live.")
    if report.get("fatal"):
        print(f"\n❌ {report['fatal']}")
        return
    print("─" * 60)
    for c in report["checks"]:
        print(f"{icons.get(c['status'], '? ')} {c['model']:<22} [{c['id']}]  {c['cost']}")
        print(f"     {c['detail']}")
    errs = [c for c in report["checks"] if c["status"] == "error"]
    print("─" * 60)
    if errs:
        print(f"{len(errs)} check(s) failed — likely a client request/response-shape tweak. "
              "Paste the error(s) and I'll fix recut/core/qwen_clients.py.")
    else:
        live = [c for c in report["checks"] if c["status"] == "ok"]
        print(f"{len(live)} check(s) OK. Run `recut-doctor --full` to also test Wan + ASR before a full render.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Preflight the Recut model layer.")
    parser.add_argument("--full", action="store_true", help="also test Wan b-roll (slow/costs) and ASR")
    args = parser.parse_args()
    _print(run(full=args.full))


if __name__ == "__main__":
    main()
