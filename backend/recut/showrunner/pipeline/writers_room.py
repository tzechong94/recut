"""Writers' room — premise -> treatment via a MULTI-ROUND writer + critic loop.

The loop iterates to a quality bar (or a round cap), and the whole debate is captured as
a transcript for the UI — the scored "narrative ability" showpiece. The writer is given
dramatic structure (a dramatic question, per-character want/flaw, a midpoint turn and a
climax) and a genre register derived from the chosen style, so noir reads terse and
cynical while a fable reads warm. Failures are surfaced, never silently swallowed.
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
    STYLE_PRESETS,
)

QUALITY_BAR = 0.8
MAX_ROUNDS = 3
_VOICE_POOL = ["longxiaochun_v2", "longshu_v2", "longwan_v2", "longcheng_v2", "longhua_v2"]

_REGISTER = {
    "noir": "Hard-boiled noir: terse, cynical, shadowed, morally grey. Clipped dialogue with subtext.",
    "anime": "Heightened, emotional, big stakes and clear motivations; expressive beats.",
    "claymation": "Whimsical and warm, gentle humor, tactile world, a little melancholy.",
    "storybook": "Fable-like, simple and resonant, a clear moral, wonder.",
    "pixar": "Heartfelt and witty, a strong emotional core, a turn that earns its feeling.",
    "cinematic": "Grounded, character-driven realism; restraint and subtext.",
}


def _writer_sys(register: str) -> str:
    return (
        "showrunner:treatment — You are a screenwriter. Write a tight short-film treatment with REAL "
        "dramatic structure as STRICT JSON: {\"title\":str,\"logline\":str,\"dramatic_question\":str,"
        "\"theme\":str,\"characters\":[{\"name\":str,\"description\":str(appearance+wardrobe),\"role\":str,"
        "\"want\":str,\"flaw\":str}],\"locations\":[{\"name\":str,\"description\":str}],"
        "\"scenes\":[{\"heading\":str,\"summary\":str(the beat: what happens + the turn/escalation)}]}. "
        "Rules: 2-4 characters each with a clear want AND flaw; 3-5 scenes that build setup -> midpoint "
        "turn -> climax answering the dramatic question; subtext over on-the-nose. "
        f"GENRE REGISTER: {register}"
    )


_CRITIC_SYS = (
    "showrunner:critic — You are a demanding script editor. Critique this treatment in STRICT JSON "
    "{\"notes\":str(specific + actionable: stakes, character arc, the turn, clarity),\"score\":float 0..1}. "
    "Score harshly; 0.8+ only for genuinely strong, structured drama."
)
_REVISER_SYS = (
    "showrunner:treatment reviser — Revise the treatment to address EVERY critic note. Return the SAME "
    "JSON shape as the writer, improved."
)


def develop_treatment(
    llm: TextLLM, premise: str, *, target_seconds: int = 60, style_name: str = "cinematic", project_id: str | None = None
) -> Production:
    register = _REGISTER.get(style_name, _REGISTER["cinematic"])
    transcript: list[dict] = []
    tokens = 0

    draft_text, t = llm.complete(_writer_sys(register), f"PREMISE: {premise}\nTARGET LENGTH: {target_seconds}s\nWrite the treatment.", json_mode=True)
    tokens += t
    draft = _parse(draft_text)
    transcript.append({"role": "writer", "text": _summ(draft)})

    for rnd in range(1, MAX_ROUNDS + 1):
        try:
            crit_text, t = llm.complete(_CRITIC_SYS, f"ROUND {rnd}.\nTREATMENT:\n{json.dumps(draft)}", json_mode=True)
            tokens += t
            crit = _parse(crit_text)
            score = float(crit.get("score", 0.0))
            transcript.append({"role": "critic", "text": crit.get("notes", ""), "score": round(score, 2)})
            if score >= QUALITY_BAR:
                break
            rev_text, t = llm.complete(_REVISER_SYS, f"TREATMENT:\n{json.dumps(draft)}\nNOTES: {crit.get('notes','')}", json_mode=True)
            tokens += t
            revised = _parse(rev_text)
            if revised:
                draft = revised
                transcript.append({"role": "writer", "text": "Revised: " + _summ(draft)})
        except Exception as exc:  # noqa: BLE001 — surface, don't silently ship an unreviewed draft
            transcript.append({"role": "system", "text": f"writers' room stopped early: {type(exc).__name__}"})
            break

    prod = _build_production(draft, premise, target_seconds, style_name, project_id)
    prod.writers_room = transcript
    prod.token_ledger.text_tokens += tokens
    return prod


def _build_production(t: dict, premise: str, target_seconds: int, style_name: str, project_id: str | None) -> Production:
    style = STYLE_PRESETS.get(style_name, STYLE_PRESETS["cinematic"]).model_copy()
    chars = []
    for i, c in enumerate(t.get("characters", [])):
        chars.append(Character(
            name=c.get("name", "Character"), description=c.get("description", ""), role=c.get("role", ""),
            want=c.get("want", ""), flaw=c.get("flaw", ""), voice=_VOICE_POOL[i % len(_VOICE_POOL)],
        ))
    locs = [Location(name=l.get("name", "Location"), description=l.get("description", "")) for l in t.get("locations", [])]
    scenes = [Scene(heading=s.get("heading", ""), summary=s.get("summary", "")) for s in t.get("scenes", [])]
    return Production(
        project_id=project_id, premise=premise, target_seconds=target_seconds,
        title=t.get("title", "Untitled"), logline=t.get("logline", ""),
        dramatic_question=t.get("dramatic_question", ""), theme=t.get("theme", ""),
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
