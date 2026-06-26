"""Assemble — per-shot voiceover synthesis + concatenation into one aligned track.

Shots play sequentially, so per-shot dialogue/narration concatenated (each segment
padded/trimmed to its shot's duration) stays in sync and feeds the existing render
engine's single voiceover track unchanged.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from recut.core.config import Settings
from recut.core.models import GenAsset, ModelClients
from recut.showrunner.schemas import Production, Shot


def synth_shot_voice(models: ModelClients, prod: Production, shot: Shot) -> GenAsset | None:
    """Synthesize this shot's spoken audio (dialogue in the speaker's voice, else
    narration in a narrator voice). Returns None for silent shots."""
    text = shot.caption
    if not text:
        return None
    voice = "longwan_v2"  # narrator default
    if shot.dialogue and shot.dialogue[0].character_id:
        c = prod.character(shot.dialogue[0].character_id)
        if c and c.voice:
            voice = c.voice
    return models.voice.synthesize(text, voice=voice)


def concat_voiceover(segments: list[tuple[str, float]], out_path: str, settings: Settings) -> str | None:
    """Concatenate per-shot audio files, each padded/trimmed to its shot duration, into
    one voiceover track aligned to the timeline. `segments` = [(audio_path, shot_dur)].

    A shot with no audio contributes silence of its duration so later shots stay aligned.
    """
    if not segments:
        return None
    ff = settings.ffmpeg_bin
    work = Path(out_path).parent
    work.mkdir(parents=True, exist_ok=True)
    parts: list[str] = []
    for i, (audio, dur) in enumerate(segments):
        seg = str(work / f"seg_{i:03d}.wav")
        if audio:
            # pad with silence then trim to exactly the shot duration
            subprocess.run(
                [ff, "-y", "-i", audio, "-af", f"apad,atrim=0:{dur:.3f}", "-ar", "44100", "-ac", "2", seg],
                capture_output=True, check=True, timeout=60,
            )
        else:
            subprocess.run(
                [ff, "-y", "-f", "lavfi", "-i", f"anullsrc=channel_layout=stereo:sample_rate=44100", "-t", f"{dur:.3f}", seg],
                capture_output=True, check=True, timeout=60,
            )
        parts.append(seg)
    list_file = work / "vo_list.txt"
    list_file.write_text("".join(f"file '{p}'\n" for p in parts), encoding="utf-8")
    subprocess.run(
        [ff, "-y", "-f", "concat", "-safe", "0", "-i", str(list_file), "-c", "copy", out_path],
        capture_output=True, check=True, timeout=120,
    )
    return out_path
