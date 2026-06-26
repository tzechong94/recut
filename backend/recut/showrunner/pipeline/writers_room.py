"""Writers' room — premise -> treatment via a writer + critic loop.

The loop is the scored "narrative ability" showpiece and is captured as a transcript for
the UI: a writer drafts a treatment (logline, cast, locations, scene beats), a critic
pushes for stakes/turns, the writer revises. All cheap text tokens, fully human-editable
after.
"""

from __future__ import annotations

import json

from recut.core.models import TextLLM
from recut.showrunner.schemas import (
    Character,
    Location,
    Production,
    Scene,
    Stage,
    StyleLock,
    STYLE_PRESETS,
)

_WRITER_SYS = (
    "showrunner:treatment — You are a screenwriter. Given a premise, write a tight short-film "
    "treatment as STRICT JSON: {\"title\":str,\"logline\":str,"
    "\"characters\":[{\"name\":str,\"description\":str(appearance+wardrobe),\"role\":str,\"voice\":str}],"
    "\"locations\":[{\"name\":str,\"description\":str}],"
    "\"scenes\":[{\"heading\":str,\"summary\":str(one beat: what happens + why it matters)}]}. "
    "Keep it to 2-4 characters, 2-4 locations, 3-5 scenes. Vivid, filmable, real stakes."
)
_CRITIC_SYS = (
    "showrunner:critic — You are a demanding script editor. Critique this treatment in STRICT "
    "JSON {\"notes\":str(specific, actionable: stakes, turns, clarity),\"score\":float 0..1}. Be tough."
)
_REVISER_SYS = (
    "showrunner:treatment reviser — Revise the treatment addressing the critic's notes. Return the "
    "SAME JSON shape as the writer."
)


def develop_treatment(
    llm: TextLLM, premise: str, *, target_seconds: int = 60, style_name: str = "cinematic", project_id: str | None = None
) -> Production:
    transcript: list[dict] = []
    tokens = 0

    draft_text, t = llm.complete(_WRITER_SYS, f"PREMISE: {premise}\nTARGET LENGTH: {target_seconds}s\nWrite the treatment.", json_mode=True)
    tokens += t
    draft = _parse(draft_text)
    transcript.append({"role": "writer", "text": _summ(draft)})

    try:
        crit_text, t = llm.complete(_CRITIC_SYS, f"TREATMENT:\n{json.dumps(draft)}", json_mode=True)
        tokens += t
        crit = _parse(crit_text)
        transcript.append({"role": "critic", "text": crit.get("notes", ""), "score": crit.get("score")})
        rev_text, t = llm.complete(_REVISER_SYS, f"TREATMENT:\n{json.dumps(draft)}\nNOTES: {crit.get('notes','')}", json_mode=True)
        tokens += t
        final = _parse(rev_text) or draft
        transcript.append({"role": "writer", "text": "Revised per notes: " + _summ(final)})
    except Exception:  # noqa: BLE001 — critique is best-effort; keep the draft
        final = draft

    prod = _build_production(final, premise, target_seconds, style_name, project_id)
    prod.writers_room = transcript
    prod.token_ledger.text_tokens += tokens
    return prod


def _build_production(t: dict, premise: str, target_seconds: int, style_name: str, project_id: str | None) -> Production:
    style = STYLE_PRESETS.get(style_name, STYLE_PRESETS["cinematic"]).model_copy()
    chars = [
        Character(name=c.get("name", "Character"), description=c.get("description", ""), role=c.get("role", ""), voice=c.get("voice", "longxiaochun_v2"))
        for c in t.get("characters", [])
    ]
    locs = [Location(name=l.get("name", "Location"), description=l.get("description", "")) for l in t.get("locations", [])]
    scenes = [Scene(heading=s.get("heading", ""), summary=s.get("summary", "")) for s in t.get("scenes", [])]
    return Production(
        project_id=project_id, premise=premise, target_seconds=target_seconds,
        title=t.get("title", "Untitled"), logline=t.get("logline", ""),
        style=style, characters=chars, locations=locs, scenes=scenes, stage=Stage.script,
    )


def _parse(text: str) -> dict:
    try:
        return json.loads(text)
    except Exception:  # noqa: BLE001
        start, end = text.find("{"), text.rfind("}")
        return json.loads(text[start : end + 1]) if start != -1 else {}


def _summ(t: dict) -> str:
    return f"{t.get('title','?')} — {t.get('logline','')}"
