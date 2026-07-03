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
from recut.showrunner.schemas import DialogueLine, Production, TONE_REGISTERS

QUALITY_BAR = 0.78

_WRITER_SYS = (
    "showrunner:dialogue — You are a screenwriter writing the spoken lines for ONE scene. "
    "Return STRICT JSON {\"lines\":[{\"character\":str,\"line\":str}]}. Use ONLY the given "
    "characters. ATTRIBUTION IS SACRED: character = who SPEAKS the line; a line addressed "
    "TO someone ('..., Maya.') is spoken by the OTHER person; alternate speakers in a "
    "two-hander. SCREEN TIME IS PAID FOR: every line ≤12 words, speakable in one breath. "
    "WHAT A GREAT LINE DOES: attacks or defends a WANT through a SPECIFIC concrete detail, "
    "never states the theme. GOLD (steal this energy): "
    "'The blender has your name on it, champ.' / "
    "'You called it a loan. The lawyers called it theft.' / "
    "'Don't. You'll say it kind, and I'll believe you again.' "
    "BANNED FOREVER: apology-and-growth speeches ('I was blinded by...', 'Let's start fresh'), "
    "saying the theme aloud ('this is about trust'), trailer-speak ('everything changes now'), "
    "gratitude wrap-ups, any line that could belong to any character. The LAST line of the "
    "scene must turn or wound — never resolve."
)
_CRITIC_SYS = (
    "showrunner:dialogue-critic — Score this scene's dialogue as STRICT JSON "
    "{\"scores\":{\"dialogue_quality\":f,\"subtext\":f,\"distinct_voices\":f},\"overall\":f,\"notes\":str}. "
    "HUNT these failure modes and cap overall at 0.5 if ANY appear: theme said aloud; "
    "apology-and-growth speech; a line with no want colliding with another want; "
    "trailer-speak; interchangeable voices; a scene that RESOLVES instead of turning. "
    "Notes must quote the offending line and prescribe the fix. 0.8+ is rare."
)
_REVISER_SYS = (
    "showrunner:dialogue reviser — Rewrite the lines to address the notes. Same JSON shape. "
    "PUNCH-UP, not padding: each rewritten line ≤12 words, loaded with a concrete detail, "
    "sayable in one breath; the scene's last line must turn or wound."
)


def write_dialogue(llm: TextLLM, prod: Production) -> Production:
    register = TONE_REGISTERS.get(prod.style.tone) or _REGISTER.get(prod.style.name, _REGISTER["cinematic"])
    cast = "; ".join(f"{c.name} (wants: {c.want or '?'}; flaw: {c.flaw or '?'})" for c in prod.characters)
    tokens = 0
    best_overall: list[float] = []
    # WRITE TO THE BUDGET: a spoken beat costs ~6s of screen time, so a 30s film
    # affords ~5 lines TOTAL. Allocating per scene here (remainder to later scenes —
    # the climax earns extra) means the writer crafts exactly the lines the film can
    # hold, instead of over-writing and having the storyboard amputate the best ones.
    budget = max(3, round((prod.target_seconds or 60) / 6))
    n_scenes = max(1, len(prod.scenes))
    base, rem = divmod(budget, n_scenes)
    allocs = [max(1, base + (1 if i >= n_scenes - rem else 0)) for i in range(n_scenes)]
    for scene, alloc in zip(prod.scenes, allocs):
        user = (f"REGISTER: {register}\nCHARACTERS: {cast}\nSCENE: {scene.heading} — {scene.summary}\n"
                f"Write EXACTLY {alloc} line{'s' if alloc != 1 else ''} — this scene's entire spoken "
                f"allowance. Each line must carry the scene's turn; alternate speakers when possible.")
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
            # HARD pacing guard LAST (the quality revise above loves to re-expand):
            # live models drift past the 12-word instruction; one targeted pass cuts
            if any(len((l.get("line") or "").split()) > 14 for l in draft):
                short_text, t2 = llm.complete(
                    _REVISER_SYS,
                    f"LINES: {json.dumps(draft)}\nNOTES: punch-up pass — every line at most 12 words, "
                    "a natural spoken sentence loaded with one concrete detail. Telegraphing "
                    "('Clean. This hurts.') and padding are both failures; "
                    "'I'm clean, and it hurts that you'd ask' is the standard.",
                    json_mode=True,
                )
                tokens += t2
                shortened = _parse(short_text).get("lines", [])
                if shortened:
                    draft = shortened
                if any(len((l.get("line") or "").split()) > 18 for l in draft):
                    prod.warnings.append(f"lines in '{scene.heading}' run long despite revision — pacing may stretch")
            best_overall.append(overall)
            scene.script = _place_characters(draft, prod, scene)
            prod.writers_room.append({"role": "dialogue", "text": f"{scene.heading}: {len(scene.script)} lines (dialogue score {overall:.2f})", "score": round(overall, 2)})
        except Exception as exc:  # noqa: BLE001 — surface, keep going scene by scene
            prod.warnings.append(f"dialogue pass failed for scene '{scene.heading}': {type(exc).__name__}")
    prod.token_ledger.text_tokens += tokens
    return prod


def _place_characters(lines: list[dict], prod: Production, scene) -> list[DialogueLine]:
    """Resolve each line to a character: by name when the model named one, else round-robin.
    Two ATTRIBUTION GUARDS (live-hit: qwen labeled every diner line 'Ethan'):
    1. a line that addresses its own speaker by name ('..., Ethan?') belongs to the
       OTHER character in a two-hander;
    2. if the writer pinned ALL lines on one speaker, alternate — a scene is a
       collision, not a monologue."""
    import re

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
        if c and len(chars) > 1:
            # vocative self-address: "..., Ethan." / "Ethan, ..." spoken BY Ethan → swap
            first = c.name.split()[0]
            if re.search(rf"(^|[,\s]){re.escape(first)}[.,!?]", line_text) and not line_text.lower().startswith(("i'm " + first.lower(), "i am " + first.lower())):
                c = next((o for o in chars if o.id != c.id), c)
        out.append(DialogueLine(character_id=c.id if c else None, character_name=c.name if c else name, line=line_text))
    if len(chars) > 1 and len(out) > 1 and len({l.character_id for l in out}) == 1:
        for i, l in enumerate(out):  # monologue collapse → alternate the two leads
            c = chars[i % 2]
            out[i] = DialogueLine(character_id=c.id, character_name=c.name, line=l.line)
    return out


def _parse(text: str) -> dict:
    try:
        return json.loads(text)
    except Exception:  # noqa: BLE001
        start, end = text.find("{"), text.rfind("}")
        return json.loads(text[start : end + 1]) if start != -1 else {}
