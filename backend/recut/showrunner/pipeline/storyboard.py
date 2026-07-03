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
    "showrunner:storyboard — You are a director. Break this scene into shots as STRICT JSON: "
    "{\"shots\":[{\"action\":str(what we SEE — the visual, for an image/video model),"
    "\"shot_type\":\"wide|medium|close_up|insert|two_shot\",\"camera\":\"static|pan|push_in|pull_out|handheld|aerial\","
    "\"duration_s\":number,\"character_names\":[str],\"location_name\":str,"
    "\"dialogue\":[{\"character\":str,\"line\":str}]}]}. "
    "NO narration — this is dialogue-only vertical drama: a shot either has a spoken "
    "line or plays SILENT (silent beats are good pacing). "
    "FEWER, LONGER shots beat many micro-cuts: each shot should hold ~3-4 seconds and earn "
    "its place. Action lines must be vivid and filmable. "
    "IMPORTANT for visual consistency: for dialogue, use SHOT/REVERSE-SHOT — each speaking "
    "shot features exactly ONE character in frame, never two named characters together. "
    "COVERAGE for dialogue (the line plays as off-screen/over dialogue, so the speaker need "
    "NOT be lip-syncing to camera): prefer over-the-shoulder, profile, a reaction shot of the "
    "LISTENER, or a meaningful cutaway/insert while the line is heard — avoid frontal "
    "talking-head close-ups. Action lines should describe such coverage explicitly."
)


def _shot_budget(prod: Production) -> int:
    """Total shots for the whole film, from the target runtime — so a 20s film is ~6 shots
    of ~3-4s, not 22 one-second jump-cuts."""
    from recut.core.config import get_settings

    spp = get_settings().seconds_per_shot or 3.5
    return max(3, round(prod.target_seconds / spp))


def storyboard_scene(llm: TextLLM, prod: Production, scene: Scene, n_shots: int, position: str = "") -> tuple[list[Shot], int]:
    cast = ", ".join(f"{c.name} ({c.description})" for c in prod.characters)
    locs = ", ".join(f"{l.name}" for l in prod.locations)
    user = (
        f"STYLE: {prod.style.name}\nCAST: {cast}\nLOCATIONS: {locs}\n"
        f"SCENE: {scene.heading} — {scene.summary}\n"
        f"Break it into about {n_shots} shot(s) (no more than {n_shots + 1})."
        + (f"\nPOSITION: {position}" if position else "")
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

    budget = _shot_budget(prod)
    n_scenes = len(prod.scenes) or 1
    per_scene = max(1, round(budget / n_scenes))  # spread the budget across scenes

    total = 0
    last = len(prod.scenes) - 1
    for i, scene in enumerate(prod.scenes):
        # micro-drama beats: the film opens on a HOOK and closes on the CLIFFHANGER
        position = ""
        if i == 0:
            position = "OPENING — the very FIRST shot is the HOOK: start mid-conflict, arresting, no slow establishing."
        if i == last:
            position = (position + " " if position else "") + "FINALE — the LAST shot lands the CLIFFHANGER/turn and holds on it."
        try:
            shots, t = storyboard_scene(llm, prod, scene, per_scene, position)
            total += t
            if shots:
                scene.shots = shots
            else:
                prod.warnings.append(f"storyboard returned no shots for scene '{scene.heading}'")
        except Exception as exc:  # noqa: BLE001 — surface the dropped scene, don't silently skip
            prod.warnings.append(f"storyboard failed for scene '{scene.heading}': {type(exc).__name__}")
            continue
        dropped = _place_dialogue(scene)
        if dropped:
            prod.warnings.append(
                f"{dropped} line(s) in '{scene.heading}' didn't fit the shot budget and were cut — pacing over cramming")
    _enforce_line_budget(prod)  # a 30s film affords ~5 spoken beats, not 12
    _enforce_budget(prod, budget)  # hard cap if the model over-produced
    _fit_durations(prod)  # …and honor the TARGET RUNTIME, not just the shot count
    prod.token_ledger.text_tokens += total
    prod.stage = Stage.storyboard
    return Production.model_validate(prod.model_dump())


def _fit_durations(prod: Production) -> None:
    """Scale shot durations so the film lands near target_seconds — the shot budget
    caps the COUNT, but the model can still assign 8s shots and blow a 30s target out
    to 67s. Clamped to the settings floor/ceiling; small overshoot is left alone
    (produce's audio-fit re-times spoken shots anyway)."""
    from recut.core.config import get_settings

    shots = prod.shots
    total = sum(sh.duration_s for sh in shots)
    target = float(prod.target_seconds or 0)
    if not shots or total <= 0 or target <= 0 or total <= target * 1.15:
        return
    s = get_settings()
    scale = target / total
    for sh in shots:
        sh.duration_s = round(min(s.max_shot_s, max(s.min_shot_s, sh.duration_s * scale)), 1)


def _enforce_budget(prod: Production, budget: int) -> None:
    """Trim to the shot budget if scenes over-produced. Drop the least essential shots
    first — silent shots (no dialogue) before shots that carry a line — and never empty a
    scene. Dialogue is re-placed afterwards so no line is lost."""
    total = sum(len(s.shots) for s in prod.scenes)
    if total <= budget:
        return
    # candidates to cut: (scene, shot) for silent shots, scenes with >1 shot, last-first
    while total > budget:
        cut = None
        for scene in sorted(prod.scenes, key=lambda s: len(s.shots), reverse=True):
            if len(scene.shots) <= 1:
                continue
            silent = [sh for sh in scene.shots if not sh.dialogue]
            victim = silent[-1] if silent else scene.shots[-1]
            cut = (scene, victim)
            break
        if not cut:
            break  # every scene down to 1 shot; stop even if still over budget
        scene, victim = cut
        scene.shots.remove(victim)
        total -= 1
    for scene in prod.scenes:
        _place_dialogue(scene)  # re-home any lines that were on a removed shot


def _enforce_line_budget(prod) -> None:
    """THE LINE BUDGET: a spoken beat costs ~6s of screen time all-in (line + air),
    so a 30s film affords ~5 lines total. Live runs proved unbudgeted dialogue blows
    the runtime 2-3x past target. Trims the SCENE SCRIPTS (the source of truth —
    shot placement re-derives from them), always keeping each scene's LAST line
    (the turn/cliffhanger lives there), dropping earliest-first. Re-places after."""
    budget = max(3, round((prod.target_seconds or 60) / 6))
    total = sum(len(sc.script or []) for sc in prod.scenes)
    if total <= budget:
        return
    excess = total - budget
    for sc in prod.scenes:
        if excess <= 0:
            break
        script = sc.script or []
        keep_last = script[-1:] if sc is prod.scenes[-1] or len(script) > 1 else script
        cuttable = script[:-1] if len(script) > 1 else []
        cut = min(excess, len(cuttable))
        sc.script = cuttable[cut:] + keep_last if len(script) > 1 else script
        excess -= cut
    for sc in prod.scenes:
        _place_dialogue(sc)  # re-home from the trimmed scripts
    prod.warnings.append(
        f"dialogue trimmed to the line budget ({budget} spoken beats for {prod.target_seconds}s) — pacing over volume")


def _place_dialogue(scene) -> int:
    """Distribute the scene's written, critiqued dialogue onto its shots (shot/reverse-
    shot). ONE line per shot — a shot is one beat: captions stay readable (no subtitle
    walls), speaking shots stay short, and some shots stay silent (pacing needs air).
    Overflow lines allow a second per shot; anything beyond is dropped with a warning
    rather than crammed."""
    if not scene.script or not scene.shots:
        return
    for sh in scene.shots:
        sh.dialogue = []

    def pick(line, cap: int):
        # prefer an empty shot featuring the speaker, then any shot featuring them,
        # then any shot under the cap
        t = next((s for s in scene.shots if line.character_id and line.character_id in s.character_ids
                  and len(s.dialogue) < cap and not s.dialogue), None)
        t = t or next((s for s in scene.shots if line.character_id and line.character_id in s.character_ids
                       and len(s.dialogue) < cap), None)
        t = t or next((s for s in scene.shots if len(s.dialogue) < cap), None)
        return t

    dropped = 0
    for line in scene.script:
        # STRICTLY one line per shot: a second line means a second SPEAKER sharing
        # the first speaker's voice and a caption pile-up (live-verified) — drop
        # over cram, always.
        target = pick(line, cap=1)
        if not target:
            dropped += 1
            continue
        if line.character_id and line.character_id not in target.character_ids:
            target.character_ids.append(line.character_id)
        target.dialogue.append(line)
    return dropped


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
        narration="",  # narration is dead — dialogue-only format (field kept for legacy docs)
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
