"""Storyboard — break each scene's beat into concrete shots.

Each shot gets a visual action (the i2v/t2v prompt source), shot type, camera, the
characters/location in frame (so we can seed i2v from the right reference), and any
dialogue/narration. Cheap text tokens; fully editable before any video spend.
"""

from __future__ import annotations

import json

from recut.core.models import TextLLM
from recut.showrunner.schemas import (
    CameraMove,
    DialogueLine,
    Production,
    Scene,
    Shot,
    ShotStatus,
    ShotType,
    Stage,
)

_SYS = (
    "showrunner:storyboard — You are a director. Break this scene into 2-4 shots as STRICT JSON: "
    "{\"shots\":[{\"action\":str(what we SEE — the visual, for an image/video model),"
    "\"shot_type\":\"wide|medium|close_up|insert|two_shot\",\"camera\":\"static|pan|push_in|pull_out|handheld|aerial\","
    "\"duration_s\":number,\"character_names\":[str],\"location_name\":str,"
    "\"dialogue\":[{\"character\":str,\"line\":str}],\"narration\":str}]}. "
    "Keep total scene length tight. Action lines must be vivid and filmable. "
    "IMPORTANT for visual consistency: for dialogue, use SHOT/REVERSE-SHOT — each speaking "
    "shot features exactly ONE character in frame (single-character close-ups that alternate), "
    "never two named characters in the same shot. Open scenes with an establishing shot of the "
    "location (no characters)."
)


def storyboard_scene(llm: TextLLM, prod: Production, scene: Scene) -> tuple[list[Shot], int]:
    cast = ", ".join(f"{c.name} ({c.description})" for c in prod.characters)
    locs = ", ".join(f"{l.name}" for l in prod.locations)
    user = (
        f"STYLE: {prod.style.name}\nCAST: {cast}\nLOCATIONS: {locs}\n"
        f"SCENE: {scene.heading} — {scene.summary}\nBreak it into shots."
    )
    text, tokens = llm.complete(_SYS, user, json_mode=True)
    data = _parse(text)
    shots = [_to_shot(sd, prod) for sd in data.get("shots", [])]
    return shots, tokens


def build_storyboard(llm: TextLLM, prod: Production) -> Production:
    # First WRITE + CRITIQUE the actual dialogue, then place those approved lines into
    # shots (storyboard no longer invents unreviewed dialogue).
    from recut.showrunner.pipeline.dialogue import write_dialogue

    prod = write_dialogue(llm, prod)

    total = 0
    for scene in prod.scenes:
        try:
            shots, t = storyboard_scene(llm, prod, scene)
            total += t
            if shots:
                scene.shots = shots
            else:
                prod.warnings.append(f"storyboard returned no shots for scene '{scene.heading}'")
        except Exception as exc:  # noqa: BLE001 — surface the dropped scene, don't silently skip
            prod.warnings.append(f"storyboard failed for scene '{scene.heading}': {type(exc).__name__}")
            continue
        _place_dialogue(scene)
    prod.token_ledger.text_tokens += total
    prod.stage = Stage.storyboard
    return Production.model_validate(prod.model_dump())


def _place_dialogue(scene) -> None:
    """Distribute the scene's written, critiqued dialogue onto its shots (shot/reverse-
    shot), replacing any LLM-invented shot dialogue. A line goes to a shot featuring its
    speaker; if none, round-robin across the scene's shots."""
    if not scene.script or not scene.shots:
        return
    for sh in scene.shots:
        sh.dialogue = []
    rr = 0
    for line in scene.script:
        target = next((s for s in scene.shots if line.character_id and line.character_id in s.character_ids and not s.dialogue), None)
        if not target:
            target = next((s for s in scene.shots if line.character_id and line.character_id in s.character_ids), None)
        if not target:
            target = scene.shots[rr % len(scene.shots)]
            rr += 1
            if line.character_id and line.character_id not in target.character_ids:
                target.character_ids.append(line.character_id)
        target.dialogue.append(line)


def _to_shot(sd: dict, prod: Production) -> Shot:
    names = sd.get("character_names", []) or []
    char_ids = [c.id for c in prod.characters if c.name in names]
    loc = next((l for l in prod.locations if l.name == sd.get("location_name")), None)
    dialogue = [
        DialogueLine(character_name=d.get("character", ""), line=d.get("line", ""),
                     character_id=next((c.id for c in prod.characters if c.name == d.get("character")), None))
        for d in sd.get("dialogue", []) or []
    ]
    return Shot(
        action=sd.get("action", ""),
        shot_type=_enum(ShotType, sd.get("shot_type"), ShotType.medium),
        camera=_enum(CameraMove, sd.get("camera"), CameraMove.static),
        duration_s=max(1.0, float(sd.get("duration_s", 4) or 4)),
        character_ids=char_ids,
        location_id=loc.id if loc else None,
        dialogue=dialogue,
        narration=sd.get("narration", "") or "",
        status=ShotStatus.planned,
    )


def _enum(enum_cls, val, default):
    try:
        return enum_cls(val)
    except Exception:  # noqa: BLE001
        return default


def _parse(text: str) -> dict:
    try:
        return json.loads(text)
    except Exception:  # noqa: BLE001
        start, end = text.find("{"), text.rfind("}")
        return json.loads(text[start : end + 1]) if start != -1 else {}
