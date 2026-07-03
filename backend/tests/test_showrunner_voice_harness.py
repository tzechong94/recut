"""Voice harness — the three live-reported failure modes, locked down forever:
1. TTS must never verbalize the speaker's name.
2. Every cast member gets a DISTINCT roster voice (no hash collisions).
3. A video must never end before its line finishes (audio sets the duration floor).
"""

from __future__ import annotations

import tempfile

from recut.core.models import get_models
from recut.core.qwen_clients import resolve_tts_voice
from recut.showrunner.pipeline.storyboard import build_storyboard
from recut.showrunner.pipeline.writers_room import develop_treatment
from recut.showrunner.schemas import DialogueLine, Production, Scene, Shot


def test_tts_text_never_contains_speaker_names():
    sh = Shot(action="x", dialogue=[
        DialogueLine(character_name="Banana", line="You crossed a line."),
        DialogueLine(character_name="Strawberry", line="Prove it."),
    ])
    assert "Banana" not in sh.caption and "Strawberry" not in sh.caption
    assert ":" not in sh.caption
    assert sh.caption == "You crossed a line. Prove it."


def test_every_cast_member_gets_a_distinct_roster_voice():
    p = develop_treatment(get_models().text, "four rivals, one prize", style_name="noir")
    voices = [resolve_tts_voice(c.voice, "Cherry") for c in p.characters]
    assert len(set(voices)) == min(len(voices), 4), f"voice collision: {voices}"
    # and they're real roster names, not legacy ids
    assert set(voices) <= {"Cherry", "Serena", "Ethan", "Chelsie"}


def test_speaking_shot_duration_never_cuts_the_line():
    """A long line (stub tts: 0.06s/char → ~12s audio) must NOT be clamped to
    max_shot_s (8s) — the audio sets the floor, capped only by wan's 15s ceiling."""
    from recut.worker.handlers.showrunner import _fit_durations_to_voice
    from recut.worker.registry import build_context

    long_line = "This confession is long and it absolutely must not be cut off before it finishes, " \
                "because a half-spoken betrayal is worse than none at all, and the audience deserves the ending."
    p = Production(title="L", scenes=[Scene(shots=[
        Shot(action="x", duration_s=4.0, dialogue=[DialogueLine(character_name="A", line=long_line)]),
    ])])
    ctx = build_context()
    with tempfile.TemporaryDirectory() as d:
        vo_paths, _ = _fit_durations_to_voice(p, ctx, d)
    shot = p.shots[0]
    assert shot.id in vo_paths
    expected_audio = min(20.0, len(shot.caption) * 0.06)  # stub tts pacing
    assert shot.duration_s >= min(15.0, expected_audio), (
        f"duration {shot.duration_s}s cuts a ~{expected_audio:.1f}s line")


def test_storyboard_leaves_dialogue_shots_uncut_end_to_end():
    p = build_storyboard(get_models().text, develop_treatment(get_models().text, "noir", style_name="noir"))
    from recut.worker.handlers.showrunner import _fit_durations_to_voice
    from recut.worker.registry import build_context
    from recut.pipeline.shots import probe_duration

    ctx = build_context()
    with tempfile.TemporaryDirectory() as d:
        vo_paths, _ = _fit_durations_to_voice(p, ctx, d)
        for sh in p.shots:
            vp = vo_paths.get(sh.id)
            if not vp:
                continue
            audio = probe_duration(vp)
            if audio:
                assert sh.duration_s + 0.05 >= min(15.0, audio), (
                    f"shot {sh.id}: {sh.duration_s}s slot vs {audio:.1f}s of speech")


def test_dialogue_attribution_guards():
    """Live-hit: the writer labeled every line of a two-hander 'Ethan'. Guards:
    a vocative self-address swaps to the other lead; a full monologue alternates."""
    from recut.showrunner.pipeline.dialogue import _place_characters
    from recut.showrunner.schemas import Character

    p = Production(title="T", characters=[
        Character(name="Ethan", description="thief"), Character(name="Sarah", description="detective"),
    ], scenes=[Scene(shots=[])])
    eid = p.characters[0].id
    sid = p.characters[1].id

    # vocative self-address: "..., Ethan?" attributed to Ethan → belongs to Sarah
    out = _place_characters([{"character": "Ethan", "line": "Why hand me your end, Ethan?"}], p, p.scenes[0])
    assert out[0].character_id == sid

    # "I'm Ethan" is a self-introduction, NOT a vocative — stays with Ethan
    out = _place_characters([{"character": "Ethan", "line": "I'm Ethan, remember the name."}], p, p.scenes[0])
    assert out[0].character_id == eid

    # monologue collapse → alternates
    out = _place_characters([
        {"character": "Ethan", "line": "You brought the cuffs."},
        {"character": "Ethan", "line": "I brought the truth."},
        {"character": "Ethan", "line": "Then one of us lied twice."},
    ], p, p.scenes[0])
    assert len({l.character_id for l in out}) == 2
