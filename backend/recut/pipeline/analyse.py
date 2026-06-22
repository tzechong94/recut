"""Reference -> recipe: the analysis pipeline.

Turns a video into a transferable RECIPE across vision (shots/scenes/on-screen text),
audio transcription, and temporal beat detection. STRUCTURE only — never the
reference's content. This is the most defensible technical artifact and the IP-safety
story in one.

    video ─▶ VisionAnalyzer (shots) ─┐
            Transcriber (segments) ──┼─▶ detect_beats ─▶ classify ─▶ label ─▶ Recipe
                                     │        │
                                     │        └─ map transcript to beats by time overlap
                                     └─ on failure ─▶ deterministic fallback recipe
                                                       (never a blank recipe)
"""

from __future__ import annotations

import re

from recut.core.models import (
    Shot,
    TranscriptResult,
    Transcriber,
    VisionAnalyzer,
    VisionResult,
)
from recut.core.schemas import (
    AnalysisMeta,
    Align,
    Beat,
    Font,
    Recipe,
    Size,
    SlotStyle,
    SlotType,
    TextRole,
)

# Keyword cues for classifying a shot into a v1 slot type. Order matters: text card
# first (on-screen claim with no person), then talking head, then generated b-roll
# (wide/establishing/no person), else the creator's own camera-roll clip.
# A real text-slate (title card, no footage) — NOT footage that merely has burned-in
# captions (most reels have captions over real video; those are not text cards).
_TEXTSLATE_CUES = ("text on a plain", "text on plain", "plain background", "solid background",
                   "title card", "title screen", "text slate", "black screen", "white screen",
                   "list of text", "slide with text", "just text", "text-only")
_PERSON_CUES = ("person", "man", "woman", "guy", "girl", "people", "to camera", "talking", "speaking",
                "presenter", "host", "selfie", "vlog", "interview", "hand")
_BROLL_CUES = ("wide", "establishing", "aerial", "drone", "landscape", "cityscape", "screen recording",
               "diagram", "graphic", "animation", "product", "close-up", "macro", "b-roll", "gameplay",
               "chip", "hardware", "device", "computer", "footage")


def _has(text: str, cues) -> bool:
    """Whole-phrase match so 'face' doesn't match inside 'surface'."""
    return any(re.search(r"\b" + re.escape(c) + r"\b", text) for c in cues)


def classify_slot_type(shot: Shot) -> SlotType:
    """Classify on the VISUAL description. On-screen text is a caption overlay, not a
    text card by itself."""
    desc = (shot.description or "").lower()
    if _has(desc, _TEXTSLATE_CUES):
        return SlotType.text
    if _has(desc, _PERSON_CUES):
        return SlotType.talk
    if shot.motion == "fast-cut" or _has(desc, _BROLL_CUES):
        return SlotType.broll
    return SlotType.roll


def _label_beats(beats: list[Beat]) -> None:
    """Assign Hook / Setup / Cut N / Payoff / CTA from position + type."""
    n = len(beats)
    cut = 0
    for i, b in enumerate(beats):
        if i == 0:
            b.label = "Hook"
        elif i == n - 1 and b.slot_type == SlotType.text:
            b.label = "CTA"
        elif b.slot_type == SlotType.talk and i == 1:
            b.label = "Setup"
        elif b.slot_type == SlotType.talk and i >= n - 2:
            b.label = "Payoff"
        else:
            cut += 1
            b.label = f"Cut {cut}"


def _style_for(slot_type: SlotType, is_first: bool, is_last: bool) -> SlotStyle:
    if slot_type == SlotType.text:
        return SlotStyle(font=Font.display, size=Size.l if is_first else Size.m, align=Align.center)
    return SlotStyle(font=Font.clean, size=Size.m, align=Align.left)


def _transcript_for(seg_list: list[dict], start: float, end: float) -> str:
    """Pick the transcript segment(s) overlapping a beat's time window."""
    parts = [s["text"] for s in seg_list if s.get("start_s", 0) < end and s.get("end_s", 0) > start]
    return " ".join(parts).strip()


def detect_beats(vision: VisionResult, transcript: TranscriptResult) -> list[Beat]:
    beats: list[Beat] = []
    for i, shot in enumerate(vision.shots):
        st = classify_slot_type(shot)
        dur = max(1.0, round(shot.end_s - shot.start_s, 2))
        is_first, is_last = i == 0, i == len(vision.shots) - 1
        ost = (shot.on_screen_text or "").strip()
        excerpt = _transcript_for(transcript.segments, shot.start_s, shot.end_s)
        # The caption is the on-screen text if present, else the spoken line.
        caption = ost or excerpt
        # On-screen text is a burned caption on footage; only a true text slate is a card.
        text_role = TextRole.on_screen_text if (st == SlotType.text or ost) else TextRole.voiceover
        beats.append(
            Beat(
                index=i,
                label="Beat",
                slot_type=st,
                duration_s=dur,
                pattern="",
                description=shot.description or "",
                text_role=text_role,
                transcript_excerpt=excerpt,
                on_screen_text=caption,
                style_hint=_style_for(st, is_first, is_last),
            )
        )
    _label_beats(beats)
    _annotate_patterns(beats)
    return beats


def _annotate_patterns(beats: list[Beat]) -> None:
    n = len(beats)
    for i, b in enumerate(beats):
        # Prefer a content-grounded pattern from the actual shot description.
        d = (b.description or "").strip()
        if b.label == "Hook":
            b.pattern = f"Opens on: {d}" if d else "A bold opening in the first seconds."
        elif b.label == "CTA":
            b.pattern = f"Closes on: {d}" if d else "Ends on a call to action."
        elif d:
            b.pattern = d if len(d) < 90 else d[:87] + "…"
        elif b.slot_type == SlotType.talk:
            b.pattern = "Talking head carries the narration."
        elif b.slot_type == SlotType.broll:
            b.pattern = "A quick cut carries the proof."
        else:
            b.pattern = "Supports the story beat."


def _observations(beats: list[Beat]) -> list[str]:
    obs: list[str] = []
    if beats and beats[0].slot_type == SlotType.text:
        obs.append("Hook-first. A short bold-text claim before anything else.")
    proof = sum(1 for b in beats if b.slot_type in (SlotType.broll, SlotType.roll))
    if proof:
        obs.append(f"Proof in the middle. {proof} quick cuts carry the evidence.")
    if any(b.label == "Payoff" for b in beats):
        obs.append("Payoff to camera. The reveal lands on a talking head.")
    obs.append("Captions burned in, punchy and lower-third.")
    return obs


def _fallback_recipe(project_id: str | None, source_asset_id: str | None, reason: str) -> Recipe:
    """Deterministic recipe used when analysis fails. The product never shows a blank
    recipe; the creator still gets a proven structure to build on."""
    specs = [
        ("Hook", SlotType.text, 3, "I saved 60% on this. Here's how."),
        ("Setup", SlotType.talk, 4, ""),
        ("Cut 1", SlotType.roll, 3, ""),
        ("Cut 2", SlotType.broll, 3, ""),
        ("Cut 3", SlotType.roll, 2, ""),
        ("Payoff", SlotType.talk, 5, ""),
        ("CTA", SlotType.text, 2, "Follow for more →"),
    ]
    beats = []
    for i, (label, st, dur, ost) in enumerate(specs):
        beats.append(
            Beat(
                index=i, label=label, slot_type=st, duration_s=dur,
                text_role=TextRole.on_screen_text if st == SlotType.text else TextRole.voiceover,
                on_screen_text=ost,
                style_hint=_style_for(st, i == 0, i == len(specs) - 1),
            )
        )
    _annotate_patterns(beats)
    return Recipe(
        project_id=project_id, source_asset_id=source_asset_id, name="Recipe (default structure)",
        beats=beats, observations=_observations(beats),
        hook_transcript="",
        analysis_meta=AnalysisMeta(models_used=[], fallback_used=True, notes=reason),
    )


def analyse_reference(
    video_path: str,
    *,
    vision: VisionAnalyzer,
    transcriber: Transcriber,
    project_id: str | None = None,
    source_asset_id: str | None = None,
    name: str = "Extracted recipe",
) -> Recipe:
    """Analyse a reference into a recipe. Any model failure falls back to a
    deterministic recipe so the demo is never blank."""
    try:
        vres = vision.analyze(video_path)
    except Exception as exc:  # noqa: BLE001 — degrade to fallback, never blank
        return _fallback_recipe(project_id, source_asset_id, f"vision failed: {type(exc).__name__}")

    try:
        tres = transcriber.transcribe(video_path)
    except Exception:  # transcript is optional; recipe still detectable from shots
        tres = TranscriptResult(text="", segments=[])

    beats = detect_beats(vres, tres)
    if not beats:
        return _fallback_recipe(project_id, source_asset_id, "no shots detected")

    return Recipe(
        project_id=project_id,
        source_asset_id=source_asset_id,
        name=name,
        shot_count=len(vres.shots),
        aspect_ratio=vres.aspect_ratio,
        beats=beats,
        observations=_observations(beats),
        hook_transcript=(tres.segments[0]["text"] if tres.segments else tres.text[:120]),
        analysis_meta=AnalysisMeta(
            models_used=["vision", "asr"],
            tokens=vres.tokens + tres.tokens,
            confidence_per_dimension={"vision": vres.confidence, "asr": tres.confidence},
            fallback_used=False,
        ),
    )
