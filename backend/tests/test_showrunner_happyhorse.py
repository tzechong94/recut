"""HappyHorse tier — dialogue shots SPEAK (native joint audio+video, lip-sync).

The track names Wan / HappyHorse; this wires HappyHorse as a quality tier: the shot
prompt carries the exact line to speak, TTS is skipped for spoken shots (the clip IS
the voice), durations are text-estimated in HappyHorse's 3-15s range, and the clip's
native audio is extracted into the VO track so the final render keeps the performance.
"""

from __future__ import annotations

import shutil

import pytest

from recut.core.models import get_models
from recut.showrunner.pipeline.production import build_shot_prompt
from recut.showrunner.schemas import Character, DialogueLine, Production, Scene, Shot, STYLE_PRESETS


def _prod(quality: str = "happyhorse") -> Production:
    eli = Character(name="Eliot", description="a magician")
    line = DialogueLine(character_id=eli.id, character_name="Eliot", line="Lena, where are you?")
    p = Production(title="x", logline="x", target_seconds=20,
                   style=STYLE_PRESETS["claymation"].model_copy(),
                   characters=[eli], video_quality=quality)
    p.scenes = [Scene(heading="INT. STAGE - NIGHT", summary="s",
                      shots=[Shot(action="Eliot searches backstage", character_ids=[eli.id],
                                  dialogue=[line])])]
    return p


def test_happyhorse_prompt_carries_the_exact_spoken_line():
    p = _prod("happyhorse")
    prompt = build_shot_prompt(p, p.shots[0])
    assert 'Eliot speaks these exact words aloud' in prompt
    assert '"Lena, where are you?"' in prompt
    # other tiers do NOT ask the video model to speak
    p2 = _prod("final")
    assert "speaks these exact words" not in build_shot_prompt(p2, p2.shots[0])


def test_happyhorse_skips_tts_and_estimates_duration():
    from recut.worker.handlers.showrunner import _fit_durations_to_voice
    from recut.worker.registry import build_context

    import tempfile

    p = _prod("happyhorse")
    ctx = build_context()
    with tempfile.TemporaryDirectory() as d:
        vo = _fit_durations_to_voice(p, ctx, d)
    shot = p.shots[0]
    assert shot.id not in vo  # no TTS file — the clip speaks for itself
    assert 3 <= shot.duration_s <= 15 and float(shot.duration_s).is_integer()
    assert p.token_ledger.voice_tokens == 0  # no TTS spend for spoken shots


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_extract_clip_audio_pulls_the_native_performance(tmp_path):
    import subprocess

    from recut.worker.handlers.showrunner import _extract_clip_audio

    clip = tmp_path / "clip.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error",
                    "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                    "-c:v", "libx264", "-c:a", "aac", "-shortest", str(clip)], check=True)
    wav = _extract_clip_audio(clip.read_bytes(), tmp_path, "shot_x")
    assert wav and wav.endswith(".wav")
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type",
                            "-of", "csv=p=0", wav], capture_output=True, text=True)
    assert "audio" in probe.stdout


def test_tier_model_map_selects_happyhorse():
    from recut.core.config import get_settings

    s = get_settings()
    assert s.happyhorse_i2v_model.startswith("happyhorse")
    assert s.price_video_second_happyhorse > 0
