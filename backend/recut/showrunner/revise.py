"""Script revision — make the Script stage feel like a writers' room.

Two ways to change the script without hand-editing every field:

  rename_character — deterministic: change a name once, it propagates everywhere
                     (logline, question, theme, scene beats, every dialogue line + action).
  revise_treatment — conversational: a plain-English note ("darker tone", "merge the two
                     sisters") -> the writer rewrites the affected treatment parts
                     consistently, preserving character IDs by name where it can.
"""

from __future__ import annotations

import json
import re

from recut.core.models import TextLLM
from recut.showrunner.schemas import Character, Location, Production, Scene


def _sub(text: str, old: str, new: str) -> str:
    if not text or not old:
        return text
    return re.sub(rf"\b{re.escape(old)}\b", new, text)


def rename_character(prod: Production, character_id: str, new_name: str) -> Production:
    """Rename a character and propagate the new name across the whole script. Free, instant."""
    c = prod.character(character_id)
    new_name = (new_name or "").strip()
    if not c or not new_name or new_name == c.name:
        return prod
    old = c.name
    prod.title = _sub(prod.title, old, new_name)
    prod.logline = _sub(prod.logline, old, new_name)
    prod.dramatic_question = _sub(prod.dramatic_question, old, new_name)
    prod.theme = _sub(prod.theme, old, new_name)
    for sc in prod.scenes:
        sc.summary = _sub(sc.summary, old, new_name)
        for d in sc.script:
            d.line = _sub(d.line, old, new_name)
            if d.character_id == character_id:
                d.character_name = new_name
        for sh in sc.shots:
            sh.action = _sub(sh.action, old, new_name)
            sh.narration = _sub(sh.narration, old, new_name)
            for d in sh.dialogue:
                d.line = _sub(d.line, old, new_name)
                if d.character_id == character_id:
                    d.character_name = new_name
    c.name = new_name
    return prod


_REVISE_SYS = (
    "showrunner:revise — You are the writers' room revising an existing short-film treatment per "
    "a director's note. Apply the note and keep everything consistent. Return the SAME STRICT JSON "
    "shape as the original treatment: {\"title\",\"logline\",\"dramatic_question\",\"theme\","
    "\"characters\":[{\"name\",\"description\",\"role\",\"want\",\"flaw\"}],"
    "\"locations\":[{\"name\",\"description\"}],\"scenes\":[{\"heading\",\"summary\"}]}."
)


def revise_treatment(llm: TextLLM, prod: Production, instruction: str) -> Production:
    """Rewrite the treatment per a plain-English note, preserving character IDs by name."""
    current = {
        "title": prod.title, "logline": prod.logline, "dramatic_question": prod.dramatic_question,
        "theme": prod.theme,
        "characters": [{"name": c.name, "description": c.description, "role": c.role, "want": c.want, "flaw": c.flaw} for c in prod.characters],
        "locations": [{"name": loc.name, "description": loc.description} for loc in prod.locations],
        "scenes": [{"heading": s.heading, "summary": s.summary} for s in prod.scenes],
    }
    prod.writers_room.append({"role": "note", "text": instruction})
    try:
        text, tokens = llm.complete(_REVISE_SYS, f"NOTE: {instruction}\n\nTREATMENT:\n{json.dumps(current)}", json_mode=True)
        t = _parse(text)
        prod.token_ledger.text_tokens += tokens
    except Exception as exc:  # noqa: BLE001 — keep the current script if revision fails
        prod.writers_room.append({"role": "system", "text": f"revision failed: {type(exc).__name__}"})
        return prod
    if not t.get("scenes") or not t.get("characters"):
        prod.writers_room.append({"role": "system", "text": "revision returned nothing usable; kept current script"})
        return prod

    _apply_treatment(prod, t)
    prod.writers_room.append({"role": "writer", "text": f"Revised per note: {t.get('title', prod.title)}"})
    return prod


def _apply_treatment(prod: Production, t: dict) -> None:
    """Apply a revised treatment, preserving character IDs by (case-insensitive) name."""
    by_name = {c.name.lower(): c for c in prod.characters}
    new_chars: list[Character] = []
    for cd in t.get("characters", []):
        name = cd.get("name", "Character")
        keep = by_name.get(name.lower())
        if keep:  # same name -> keep id + reference (cast survives)
            keep.description, keep.role = cd.get("description", keep.description), cd.get("role", keep.role)
            keep.want, keep.flaw = cd.get("want", keep.want), cd.get("flaw", keep.flaw)
            new_chars.append(keep)
        else:
            new_chars.append(Character(name=name, description=cd.get("description", ""), role=cd.get("role", ""), want=cd.get("want", ""), flaw=cd.get("flaw", "")))
    prod.characters = new_chars
    prod.locations = [Location(name=l.get("name", "Location"), description=l.get("description", "")) for l in t.get("locations", [])]
    prod.title = t.get("title", prod.title)
    prod.logline = t.get("logline", prod.logline)
    prod.dramatic_question = t.get("dramatic_question", prod.dramatic_question)
    prod.theme = t.get("theme", prod.theme)
    new_scenes = [Scene(heading=s.get("heading", ""), summary=s.get("summary", "")) for s in t.get("scenes", [])]
    # a treatment revision invalidates any prior storyboard — surface it, don't silently keep stale shots
    if any(sc.shots for sc in prod.scenes):
        prod.warnings.append("Script was revised — re-run Storyboard to regenerate shots from the new script.")
    prod.scenes = new_scenes


def _parse(text: str) -> dict:
    try:
        return json.loads(text)
    except Exception:  # noqa: BLE001
        start, end = text.find("{"), text.rfind("}")
        return json.loads(text[start : end + 1]) if start != -1 else {}
