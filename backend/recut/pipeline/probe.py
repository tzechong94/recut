"""Media probing — determine mime/duration/dimensions for an uploaded file.

Uses ffprobe when available; falls back to extension-based mime guessing so uploads
still work (with zero dims/duration) on a box without ffprobe."""

from __future__ import annotations

import json
import mimetypes
import shutil
import subprocess
from dataclasses import dataclass

from recut.core.config import get_settings


@dataclass
class MediaInfo:
    mime: str
    duration_s: float = 0.0
    width: int = 0
    height: int = 0


def probe(path: str, *, filename: str | None = None) -> MediaInfo:
    guessed, _ = mimetypes.guess_type(filename or path)
    mime = guessed or "application/octet-stream"
    ffprobe = get_settings().ffprobe_bin
    if not shutil.which(ffprobe):
        return MediaInfo(mime=mime)
    try:
        out = subprocess.run(
            [ffprobe, "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path],
            capture_output=True, text=True, timeout=30,
        )
        data = json.loads(out.stdout or "{}")
    except Exception:
        return MediaInfo(mime=mime)

    streams = data.get("streams", [])
    vstream = next((s for s in streams if s.get("codec_type") == "video"), None)
    astream = next((s for s in streams if s.get("codec_type") == "audio"), None)
    duration = float(data.get("format", {}).get("duration", 0) or 0)

    if vstream:
        # A video stream with no audio could still be an animated image; trust mime
        # family but prefer video/* if frames move. Keep it simple: has video -> video.
        if not mime.startswith(("video/", "image/")):
            mime = "video/mp4"
        return MediaInfo(
            mime=mime if mime.startswith(("video/", "image/")) else "video/mp4",
            duration_s=duration,
            width=int(vstream.get("width", 0) or 0),
            height=int(vstream.get("height", 0) or 0),
        )
    if astream:
        return MediaInfo(mime=mime if mime.startswith("audio/") else "audio/mpeg", duration_s=duration)
    return MediaInfo(mime=mime, duration_s=duration)
