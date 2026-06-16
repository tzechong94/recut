"""The export render engine — server-side ffmpeg.

One canonical timeline JSON in, one 9:16 MP4 out. Mirrors what the React preview
plays, beat for beat, reading the same caption-style spec.

Pipeline (per the architecture)::

    timeline ─▶ per-slot clip (1080x1920, fit, duration, ASS caption burned)
                      │  cached by content hash  ──▶ resumable
                      ▼
                 concat demuxer ─▶ mix audio (VO + ducked bed | silent) ─▶ MP4

Resumability: each slot clip is cached at work/cache/<hash>.mp4. A worker that dies
mid-render re-runs and skips every slot whose clip already exists. The integration
test kills and restarts to prove it.

Failure handling: ffmpeg non-zero -> TranscodeError(named) with stderr tail. Missing
asset -> falls back to a stand-in clip (never a blank frame, never a 500).
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from recut.core.caption import load_spec
from recut.core.config import Settings, get_settings
from recut.core.schemas import SlotSource, SlotType, TextRole, Timeline
from recut.pipeline.caption_ass import build_ass

CANVAS_W = 1080
CANVAS_H = 1920
FPS = 30


class TranscodeError(RuntimeError):
    """ffmpeg failed on a specific step. Carries the stderr tail for debugging."""


@dataclass
class AssetMeta:
    storage_key: str
    mime: str = "application/octet-stream"
    duration_s: float = 0.0
    width: int = 0
    height: int = 0

    @property
    def is_video(self) -> bool:
        return self.mime.startswith("video/")

    @property
    def is_image(self) -> bool:
        return self.mime.startswith("image/")

    @property
    def is_audio(self) -> bool:
        return self.mime.startswith("audio/")


ProgressCb = Callable[[float], None]


def _run(args: list[str], *, cwd: str | None = None, step: str = "ffmpeg") -> None:
    proc = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if proc.returncode != 0:
        tail = (proc.stderr or "")[-1200:]
        raise TranscodeError(f"{step} failed (exit {proc.returncode}): {tail}")


def ffmpeg_available(settings: Settings | None = None) -> bool:
    s = settings or get_settings()
    return shutil.which(s.ffmpeg_bin) is not None


def _hex_to_lavfi(color: str) -> str:
    return "0x" + color.lstrip("#")


def _slot_cache_key(slot_dict: dict, asset_hash: str, spec_hash: str) -> str:
    blob = json.dumps(slot_dict, sort_keys=True) + asset_hash + spec_hash
    return hashlib.sha256(blob.encode()).hexdigest()[:20]


def _fit_filter() -> str:
    return (
        f"scale={CANVAS_W}:{CANVAS_H}:force_original_aspect_ratio=decrease,"
        f"pad={CANVAS_W}:{CANVAS_H}:(ow-iw)/2:(oh-ih)/2:color=black,"
        f"setsar=1,fps={FPS}"
    )


def _build_slot_clip(
    slot,
    *,
    src_path: str | None,
    is_video: bool,
    is_image: bool,
    out_path: str,
    fonts_dir: str | None,
    settings: Settings,
) -> None:
    """Render one slot to a normalized 1080x1920 clip with its caption burned in."""
    work = Path(out_path).parent
    work.mkdir(parents=True, exist_ok=True)

    # Write the ASS caption next to the clip; reference it relatively (cwd=work) so
    # we never fight ffmpeg's subtitles-filter path escaping.
    ass_name = "cap.ass"
    (work / ass_name).write_text(build_ass(slot), encoding="utf-8")
    sub = f"subtitles={ass_name}"
    if fonts_dir:
        sub += f":fontsdir={_escape_filter_path(fonts_dir)}"

    ff = settings.ffmpeg_bin
    dur = f"{slot.duration_s:.3f}"

    if src_path and is_video:
        # Real footage / generated video: loop if shorter than the beat, trim to dur.
        vf = _fit_filter() + "," + sub
        args = [
            ff, "-y", "-stream_loop", "-1", "-i", src_path, "-t", dur,
            "-vf", vf, "-an", "-r", str(FPS), "-pix_fmt", "yuv420p",
            "-c:v", "libx264", "-preset", "veryfast", out_path,
        ]
    elif src_path and is_image:
        vf = _fit_filter() + "," + sub
        args = [
            ff, "-y", "-loop", "1", "-i", src_path, "-t", dur,
            "-vf", vf, "-an", "-r", str(FPS), "-pix_fmt", "yuv420p",
            "-c:v", "libx264", "-preset", "veryfast", out_path,
        ]
    else:
        # Stand-in: solid type-tinted background. A faint ghost label for non-text
        # slots; text cards just show the caption (which IS the text).
        color = _hex_to_lavfi(slot.standin.color)
        chain = []
        if slot.type != SlotType.text:
            label = (slot.standin.label or "stand-in").replace(":", "\\:").replace("'", "")
            chain.append(
                f"drawtext=text='{label}':fontcolor=white@0.45:fontsize=46:"
                f"x=(w-text_w)/2:y=h*0.4"
            )
        chain.append(sub)
        vf = ",".join(chain)
        args = [
            ff, "-y", "-f", "lavfi", "-i",
            f"color=c={color}:s={CANVAS_W}x{CANVAS_H}:r={FPS}:d={dur}",
            "-vf", vf, "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast",
            out_path,
        ]
    _run(args, cwd=str(work), step=f"slot[{slot.beat_label}]")


def _escape_filter_path(p: str) -> str:
    # Minimal escaping for use inside an ffmpeg filter argument value.
    return p.replace("\\", "/").replace(":", "\\:")


def render_timeline(
    timeline: Timeline,
    *,
    assets: dict[str, AssetMeta],
    storage,
    settings: Settings | None = None,
    on_progress: ProgressCb | None = None,
    fonts_dir: str | None = None,
) -> str:
    """Render the timeline to an MP4 on local disk; returns the output path.

    `assets` maps asset_id -> AssetMeta (storage key + mime + dims). The caller
    (worker) builds this from the DB; tests pass it directly. Media is pulled from
    `storage` to a local scratch dir.
    """
    s = settings or get_settings()
    if not ffmpeg_available(s):
        raise TranscodeError("ffmpeg not found on PATH")
    if not timeline.slots:
        raise ValueError("cannot render an empty timeline")

    root = Path(s.work_dir) / f"render_{timeline.timeline_id}_v{timeline.version}"
    cache = Path(s.work_dir) / "cache"
    src_dir = root / "src"
    clips_dir = root / "clips"
    for d in (root, cache, src_dir, clips_dir):
        d.mkdir(parents=True, exist_ok=True)

    spec = load_spec()
    spec_hash = hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()[:8]

    clip_paths: list[str] = []
    total = len(timeline.slots)
    for i, slot in enumerate(timeline.slots):
        meta = assets.get(slot.asset_id) if slot.asset_id else None
        asset_hash = ""
        src_path = None
        is_video = is_image = False
        if meta and slot.source in (SlotSource.user_upload, SlotSource.generated):
            asset_hash = meta.storage_key
            local = src_dir / f"{slot.id}_{Path(meta.storage_key).name}"
            if not local.exists():
                try:
                    storage.get_to_file(meta.storage_key, str(local))
                except Exception:
                    meta = None  # missing asset -> stand-in fallback
            if meta:
                src_path = str(local)
                is_video, is_image = meta.is_video, meta.is_image

        key = _slot_cache_key(slot.model_dump(mode="json"), asset_hash, spec_hash)
        cached = cache / f"{key}.mp4"
        if not cached.exists():
            tmp = clips_dir / f"{i:03d}_{slot.id}.mp4"
            try:
                _build_slot_clip(
                    slot, src_path=src_path, is_video=is_video, is_image=is_image,
                    out_path=str(tmp), fonts_dir=fonts_dir, settings=s,
                )
            except TranscodeError:
                # A corrupt/unsupported asset must not kill the whole export — degrade
                # this one slot to its stand-in (the cut still plays end to end).
                if src_path is None:
                    raise  # stand-in build itself failed; that's a real error
                _build_slot_clip(
                    slot, src_path=None, is_video=False, is_image=False,
                    out_path=str(tmp), fonts_dir=fonts_dir, settings=s,
                )
            shutil.move(str(tmp), str(cached))
        clip_paths.append(str(cached))
        if on_progress:
            on_progress((i + 1) / total * 0.8)  # 80% for clips, 20% for concat+audio

    out_silent = root / "silent.mp4"
    _concat(clip_paths, str(out_silent), settings=s)

    out_final = root / "out.mp4"
    _mux_audio(timeline, str(out_silent), str(out_final), assets=assets, storage=storage, src_dir=str(src_dir), settings=s)
    if on_progress:
        on_progress(1.0)
    return str(out_final)


def _concat(clip_paths: list[str], out_path: str, *, settings: Settings) -> None:
    list_file = Path(out_path).with_suffix(".txt")
    list_file.write_text("".join(f"file '{p}'\n" for p in clip_paths), encoding="utf-8")
    args = [
        settings.ffmpeg_bin, "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
        "-c", "copy", out_path,
    ]
    try:
        _run(args, step="concat")
    except TranscodeError:
        # Fallback: re-encode concat if stream copy can't stitch (param mismatch).
        args = [
            settings.ffmpeg_bin, "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
            "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", out_path,
        ]
        _run(args, step="concat-reencode")


def _mux_audio(
    timeline: Timeline, video_path: str, out_path: str, *, assets, storage, src_dir: str, settings: Settings
) -> None:
    """Mix voiceover + ducked bed onto the video. If no audio, add a silent track so
    the MP4 is universally playable."""
    total = timeline.duration_s
    vo = timeline.audio.voiceover
    bed = timeline.audio.bed
    inputs = [settings.ffmpeg_bin, "-y", "-i", video_path]
    filters = []
    amix_labels = []
    idx = 1

    def _fetch(track) -> str | None:
        meta = assets.get(track.asset_id) if track and track.asset_id else None
        if not meta:
            return None
        local = Path(src_dir) / f"audio_{Path(meta.storage_key).name}"
        if not local.exists():
            try:
                storage.get_to_file(meta.storage_key, str(local))
            except Exception:
                return None
        return str(local)

    vo_path = _fetch(vo) if vo and vo.enabled else None
    bed_path = _fetch(bed) if bed and bed.enabled else None

    if vo_path:
        inputs += ["-i", vo_path]
        filters.append(f"[{idx}:a]apad,atrim=0:{total:.3f}[vo]")
        amix_labels.append("[vo]")
        idx += 1
    if bed_path:
        inputs += ["-stream_loop", "-1", "-i", bed_path]
        gain = bed.gain_db
        filters.append(f"[{idx}:a]volume={gain}dB,atrim=0:{total:.3f}[bed]")
        amix_labels.append("[bed]")
        idx += 1

    if amix_labels:
        if len(amix_labels) > 1:
            filters.append(
                "".join(amix_labels) + f"amix=inputs={len(amix_labels)}:duration=longest:dropout_transition=0[aout]"
            )
            amap = "[aout]"
        else:
            amap = amix_labels[0]
        args = inputs + [
            "-filter_complex", ";".join(filters),
            "-map", "0:v", "-map", amap,
            "-c:v", "copy", "-c:a", "aac", "-shortest", out_path,
        ]
        _run(args, step="mux-audio")
    else:
        # Silent track
        args = [
            settings.ffmpeg_bin, "-y", "-i", video_path,
            "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac",
            "-shortest", out_path,
        ]
        _run(args, step="mux-silent")
