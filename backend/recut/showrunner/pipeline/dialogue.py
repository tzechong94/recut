"""Dialogue pass — write the ACTUAL spoken lines, then critique them.

Crit finding: the words the audience hears were the one creative artifact no agent
reviewed (storyboard invented them; the narrative rubric judged only the synopsis). This
pass has a writer draft real lines per scene against each character's want/flaw + the
genre register, a dialogue critic score them for quality/subtext/distinct-voices, and a
revise round. Storyboard then PLACES these approved lines into shots; the narrative
rubric scores them. Cheap text tokens, offline-runnable.
"""

from __future__ import annotations

import json

from recut.core.models import TextLLM
from recut.showrunner.pipeline.writers_room import _REGISTER
from recut.showrunner.schemas import DialogueLine, Production

QUALITY_BAR = 0.78

_WRITER_SYS = (
    "showrunner:dialogue — You are a screenwriter writing the spoken lines for ONE scene. "
    "Return STRICT JSON {\"lines\":[{\"character\":str,\"line\":str}]}. Use ONLY the given "
    "characters. Subtext over on-the-nose; each character must sound distinct (per their "
    "want/flaw); keep it to 2-5 short lines that play the scene's beat."
)
_CRITIC_SYS = (
    "showrunner:dialogue-critic — Score this scene's dialogue as STRICT JSON "
    "{\"scores\":{\"dialogue_quality\":f,\"subtext\":f,\"distinct_voices\":f},\"overall\":f,\"notes\":str}. "
    "Be tough; 0.8+ only for lines with real subtext and distinct voices."
)
_REVISER_SYS = "showrunner:dialogue reviser — Rewrite the lines to address the notes. Same JSON shape."


def write_dialogue(llm: TextLLM, prod: Production) -> Production:
    register = _REGISTER.get(prod.style.name, _REGISTER["cinematic"])
    cast = "; ".join(f"{c.name} (wants: {c.want or '?'}; flaw: {c.flaw or '?'})" for c in prod.characters)
    tokens = 0
    best_overall: list[float] = []
    for scene in prod.scenes:
        user = f"REGISTER: {register}\nCHARACTERS: {cast}\nSCENE: {scene.heading} — {scene.summary}\nWrite the lines."
        try:
            text, t = llm.complete(_WRITER_SYS, user, json_mode=True)
            tokens += t
            draft = _parse(text).get("lines", [])
            crit_text, t = llm.complete(_CRITIC_SYS, json.dumps({"scene": scene.summary, "lines": draft}), json_mode=True)
            tokens += t
            crit = _parse(crit_text)
            overall = float(crit.get("overall", 0.0))
            if overall < QUALITY_BAR:
                rev_text, t = llm.complete(_REVISER_SYS, f"LINES: {json.dumps(draft)}\nNOTES: {crit.get('notes','')}", json_mode=True)
                tokens += t
                draft = _parse(rev_text).get("lines", draft) or draft
            best_overall.append(overall)
            scene.script = _place_characters(draft, prod, scene)
            prod.writers_room.append({"role": "dialogue", "text": f"{scene.heading}: {len(scene.script)} lines (dialogue score {overall:.2f})", "score": round(overall, 2)})
        except Exception as exc:  # noqa: BLE001 — surface, keep going scene by scene
            prod.warnings.append(f"dialogue pass failed for scene '{scene.heading}': {type(exc).__name__}")
    prod.token_ledger.text_tokens += tokens
    return prod


def _place_characters(lines: list[dict], prod: Production, scene) -> list[DialogueLine]:
    """Resolve each line to a character: by name when the model named one, else round-robin
    across the production's characters (so a stub with no names still attributes lines)."""
    chars = prod.characters or []
    out: list[DialogueLine] = []
    rr = 0
    for ln in lines:
        line_text = (ln.get("line") or "").strip()
        if not line_text:
            continue
        name = (ln.get("character") or "").strip()
        c = next((c for c in chars if c.name.lower() == name.lower()), None)
        if not c and chars:
            c = chars[rr % len(chars)]
            rr += 1
        out.append(DialogueLine(character_id=c.id if c else None, character_name=c.name if c else name, line=line_text))
    return out


def _parse(text: str) -> dict:
    try:
        return json.loads(text)
    except Exception:  # noqa: BLE001
        start, end = text.find("{"), text.rfind("}")
        return json.loads(text[start : end + 1]) if start != -1 else {}
