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


# Per-style ambient bed character (base tone Hz, lowpass cutoff). A real royalty-free
# track dropped at assets/music/{style}.{mp3,wav} overrides this generated pad.
_BED_TONE = {"noir": (98.0, 320), "anime": (220.0, 900), "claymation": (146.83, 500),
             "storybook": (196.0, 700), "pixar": (174.61, 800), "cinematic": (130.81, 450)}


def find_or_make_bed(style_name: str, out_path: str, settings: Settings) -> str | None:
    """Return a music-bed audio path: a real asset at assets/music/{style}.* if present,
    else a soft generated ambient pad. The render loops + ducks it under the voiceover."""
    repo_root = Path(__file__).resolve().parents[4]
    for ext in ("mp3", "wav", "m4a"):
        cand = repo_root / "assets" / "music" / f"{style_name}.{ext}"
        if cand.exists():
            return str(cand)
    if not shutil_which(settings.ffmpeg_bin):
        return None
    freq, cutoff = _BED_TONE.get(style_name, _BED_TONE["cinematic"])
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            [settings.ffmpeg_bin, "-y", "-f", "lavfi", "-i", f"sine=frequency={freq}:duration=8",
             "-f", "lavfi", "-i", f"sine=frequency={freq * 1.5:.2f}:duration=8",
             "-filter_complex", f"[0][1]amix=inputs=2,tremolo=f=0.25:d=0.6,lowpass=f={cutoff},volume=0.5[a]",
             "-map", "[a]", "-ar", "44100", "-ac", "2", out_path],
            capture_output=True, check=True, timeout=60,
        )
        return out_path
    except Exception:
        return None


def shutil_which(binary: str) -> bool:
    import shutil

    return shutil.which(binary) is not None


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
