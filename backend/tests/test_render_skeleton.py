"""Phase 0 gate: a stand-in-only project renders to a real MP4 locally.

These are the de-risking tests — they prove the hardest part (render + canonical
timeline) end to end before any AI is wired. Skipped cleanly if ffmpeg is absent.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from recut.core.config import get_settings
from recut.core.schemas import Beat, Recipe, SlotType, TextRole
from recut.core.storage import LocalStorage
from recut.core.timeline_ops import base_cut_from_recipe
from recut.pipeline.render import AssetMeta, render_timeline

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


def _ffprobe(path: str) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path],
        capture_output=True, text=True,
    )
    return json.loads(out.stdout)


def _demo_recipe() -> Recipe:
    return Recipe(
        name="Marble sourcing reel",
        beats=[
            Beat(index=0, label="Hook", slot_type=SlotType.text, duration_s=2, text_role=TextRole.on_screen_text, on_screen_text="I saved 60% on marble."),
            Beat(index=0, label="Setup", slot_type=SlotType.talk, duration_s=2, transcript_excerpt="Everyone overpays."),
            Beat(index=0, label="Cut", slot_type=SlotType.roll, duration_s=1, transcript_excerpt="On the floor"),
            Beat(index=0, label="B", slot_type=SlotType.broll, duration_s=1, transcript_excerpt="Sparks"),
            Beat(index=0, label="CTA", slot_type=SlotType.text, duration_s=1, text_role=TextRole.on_screen_text, on_screen_text="Follow →"),
        ],
    )


def test_standin_only_project_renders_mp4(work_dir):
    tl = base_cut_from_recipe(_demo_recipe(), project_id="p1")
    storage = LocalStorage(work_dir + "/store")
    out = render_timeline(tl, assets={}, storage=storage)
    assert Path(out).exists() and Path(out).stat().st_size > 0

    probe = _ffprobe(out)
    vstream = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert (vstream["width"], vstream["height"]) == (1080, 1920)  # 9:16
    # duration within 0.4s of the timeline total (concat/encode rounding)
    assert abs(float(probe["format"]["duration"]) - tl.duration_s) < 0.5
    # has an audio track (silent) so it plays everywhere
    assert any(s["codec_type"] == "audio" for s in probe["streams"])


def test_progress_callback_reaches_one(work_dir):
    tl = base_cut_from_recipe(_demo_recipe())
    storage = LocalStorage(work_dir + "/store")
    seen: list[float] = []
    render_timeline(tl, assets={}, storage=storage, on_progress=seen.append)
    assert seen and seen[-1] == 1.0
    assert seen == sorted(seen)  # monotonic


def test_render_is_resumable_via_clip_cache(work_dir):
    """A worker that dies mid-render and restarts must skip already-built slots."""
    tl = base_cut_from_recipe(_demo_recipe())
    storage = LocalStorage(work_dir + "/store")
    render_timeline(tl, assets={}, storage=storage)

    cache = Path(get_settings().work_dir) / "cache"
    clips = sorted(cache.glob("*.mp4"))
    assert clips, "expected cached slot clips"
    mtimes = {p: p.stat().st_mtime_ns for p in clips}

    # Render again: cached clips must be reused, not rebuilt (mtimes unchanged).
    render_timeline(tl, assets={}, storage=storage)
    for p, m in mtimes.items():
        assert p.stat().st_mtime_ns == m, f"slot clip {p.name} was rebuilt, not resumed"


def test_empty_timeline_raises(work_dir):
    from recut.core.schemas import Timeline

    storage = LocalStorage(work_dir + "/store")
    with pytest.raises(ValueError):
        render_timeline(Timeline(slots=[]), assets={}, storage=storage)
