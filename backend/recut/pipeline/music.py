"""Music beat-sync — an ISOLATED, toggleable pass (accepted scope, highest deadline
risk, so quarantined by design).

It NEVER mutates the core timeline. `apply_music_sync` returns a NEW timeline copy
(version + 1) with slot durations snapped to the audio bed's beat grid and `music_sync`
set. `clear_music_sync` returns a copy with sync disabled. If it's off, it has zero
effect on the cut. The render and preview read whichever timeline version the project
points at, so a bad sync can be discarded without touching anything else.

Beat detection uses librosa when present; otherwise a deterministic fallback (default
BPM) so the feature degrades instead of breaking.
"""

from __future__ import annotations

from dataclasses import dataclass

from recut.core.schemas import MusicSync, Timeline


@dataclass
class BeatGrid:
    bpm: float
    downbeat_offset_s: float

    @property
    def beat_interval_s(self) -> float:
        return 60.0 / self.bpm if self.bpm else 0.5


def detect_beats(audio_path: str | None, *, default_bpm: float = 120.0) -> BeatGrid:
    """Detect tempo of the audio bed. librosa if available, else deterministic fallback."""
    if audio_path:
        try:
            import librosa  # type: ignore

            y, sr = librosa.load(audio_path, mono=True)
            tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
            bpm = float(tempo) if tempo else default_bpm
            return BeatGrid(bpm=round(bpm, 2), downbeat_offset_s=0.0)
        except Exception:  # noqa: BLE001 — degrade to fallback, never break the edit
            pass
    return BeatGrid(bpm=default_bpm, downbeat_offset_s=0.0)


def snap_duration(duration_s: float, grid: BeatGrid) -> float:
    """Snap a slot duration to the nearest whole number of beats (min one beat)."""
    interval = grid.beat_interval_s
    beats = max(1, round(duration_s / interval))
    return round(beats * interval, 3)


def apply_music_sync(timeline: Timeline, grid: BeatGrid) -> Timeline:
    """Return a NEW timeline version with slot durations snapped to the beat grid.
    The input timeline is untouched."""
    out = timeline.model_copy(deep=True)
    for s in out.slots:
        s.duration_s = snap_duration(s.duration_s, grid)
    out.version = timeline.version + 1
    out.music_sync = MusicSync(enabled=True, bpm=grid.bpm, downbeat_offset_s=grid.downbeat_offset_s)
    # ledger seconds shift slightly after snapping; recompute so the meter stays honest.
    from recut.core.timeline_ops import recompute_ledger

    recompute_ledger(out)
    return out


def clear_music_sync(timeline: Timeline) -> Timeline:
    out = timeline.model_copy(deep=True)
    out.music_sync = MusicSync(enabled=False)
    out.version = timeline.version + 1
    return out
