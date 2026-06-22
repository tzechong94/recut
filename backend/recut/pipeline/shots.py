"""Temporal shot detection — the robust front half of reference->recipe.

Vision models are unreliable at self-reporting shot boundaries (they'll call a whole
reel "one shot"). So we detect cuts deterministically with ffmpeg scene detection, then
hand one keyframe per shot to the vision model to DESCRIBE. If a clip has few/no hard
cuts, we subdivide the longest segments so a reel always yields a multi-beat structure.

    video ─▶ ffmpeg scene-cut times ─▶ shot boundaries ─▶ (subdivide/merge to 5-8)
                                                              │
                                                              ▼ midpoint frame per shot
                                                         keyframes (jpg)
"""

from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path

from recut.core.config import get_settings


def probe_duration(path: str) -> float:
    s = get_settings()
    try:
        out = subprocess.run(
            [s.ffprobe_bin, "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", path],
            capture_output=True, text=True, timeout=30,
        )
        return float(out.stdout.strip() or 0)
    except Exception:
        return 0.0


def detect_scene_cuts(path: str, threshold: float = 0.3) -> list[float]:
    """Return sorted scene-change timestamps (seconds) via ffmpeg scene detection."""
    s = get_settings()
    try:
        out = subprocess.run(
            [s.ffmpeg_bin, "-i", path, "-filter:v", f"select='gt(scene,{threshold})',showinfo", "-f", "null", "-"],
            capture_output=True, text=True, timeout=120,
        )
    except Exception:
        return []
    return sorted({round(float(t), 2) for t in re.findall(r"pts_time:([0-9.]+)", out.stderr)})


def shot_boundaries(
    path: str, duration: float | None = None, *, min_shots: int = 5, max_shots: int = 8, min_len: float = 0.6
) -> list[tuple[float, float]]:
    """Real shot boundaries for a clip, normalized to min_shots..max_shots beats."""
    dur = duration if duration and duration > 0 else probe_duration(path)
    if dur <= 0:
        dur = 10.0
    cuts = [c for c in detect_scene_cuts(path) if 0 < c < dur]
    marks = [0.0] + cuts + [dur]
    shots = [(marks[i], marks[i + 1]) for i in range(len(marks) - 1) if marks[i + 1] - marks[i] >= min_len]
    if not shots:
        shots = [(0.0, dur)]

    # Too few -> split the longest segment repeatedly until we reach min_shots.
    while len(shots) < min_shots and any((e - s) >= 2 * min_len for s, e in shots):
        i = max(range(len(shots)), key=lambda j: shots[j][1] - shots[j][0])
        s, e = shots[i]
        mid = round((s + e) / 2, 2)
        shots[i : i + 1] = [(s, mid), (mid, e)]

    # Too many -> merge the shortest neighbour until we reach max_shots.
    while len(shots) > max_shots:
        i = min(range(len(shots) - 1), key=lambda j: (shots[j][1] - shots[j][0]) + (shots[j + 1][1] - shots[j + 1][0]))
        s, _ = shots[i]
        _, e = shots[i + 1]
        shots[i : i + 2] = [(s, e)]
    return [(round(s, 2), round(e, 2)) for s, e in shots]


def extract_keyframe(path: str, t: float, dest_dir: str | None = None) -> str | None:
    """Extract a single JPEG frame at time t. Returns the file path (or None)."""
    s = get_settings()
    out = str(Path(dest_dir or tempfile.mkdtemp(prefix="recut-frames-")) / f"f_{int(t * 100)}.jpg")
    try:
        subprocess.run(
            [s.ffmpeg_bin, "-y", "-ss", f"{t:.2f}", "-i", path, "-frames:v", "1", "-q:v", "3", out],
            capture_output=True, check=True, timeout=30,
        )
        return out if Path(out).exists() else None
    except Exception:
        return None
