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
    TONE_REGISTERS,
)

QUALITY_BAR = 0.8
MAX_ROUNDS = 2  # writer + up to 2 critic/revise rounds — keeps live latency ~40-50s while
                # still a visible multi-round debate (stops early once the bar is met)
# The ACTUAL qwen3-tts roster, assigned round-robin so every cast member gets a
# DISTINCT voice (legacy pool ids hashed onto the roster and collided — two
# characters could sound identical). Alternates female/male for contrast.
_VOICE_POOL = ["Cherry", "Ethan", "Serena", "Chelsie"]

_REGISTER = {
    "noir": "Hard-boiled noir: terse, cynical, shadowed, morally grey. Clipped dialogue with subtext.",
    "anime": "Heightened, emotional, big stakes and clear motivations; expressive beats.",
    "claymation": "Whimsical and warm, gentle humor, tactile world, a little melancholy.",
    "storybook": "Fable-like, simple and resonant, a clear moral, wonder.",
    "pixar": "Heartfelt and witty, a strong emotional core, a turn that earns its feeling.",
    "ghibli": "Gentle wonder: quiet moments matter, nature breathes, kindness has weight, melancholy and warmth live together.",
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
        "THE LOGLINE IS A HIGH-CONCEPT HOOK: one breath, instantly pitchable, with a "
        "SPECIFIC ironic engine (not 'X discovers a secret' — WHAT secret, WHY it's the "
        "worst possible one for THIS character). Absurd/comedic premises are welcome — "
        "COMMIT to the bit and play it dead serious; the comedy is in the sincerity. "
        "BANNED: generic 'legacy/memories/progress' sentiment, vague stakes, any scene "
        "that merely continues the previous one — every scene must CHANGE the situation "
        "(a reveal, a betrayal, a reversal, a deadline collapsing). Every scene summary "
        "must name the CONCRETE OBJECT or ACTION carrying the beat (the blender with the "
        "wrong name on it, the letter left unsent) — never abstract emotion. Endings "
        "TURN or WOUND; apology-and-growth wrap-ups are forbidden. "
        "FORMAT: this is a VERTICAL MICRO-DRAMA (ReelShort-style). The FIRST scene opens "
        "mid-conflict — a HOOK the viewer can't scroll past in the first seconds (no slow "
        "establishing). Every scene escalates. The FINAL scene lands a CLIFFHANGER or "
        "gut-punch turn that leaves them needing the next episode. "
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
    llm: TextLLM, premise: str, *, target_seconds: int = 60, style_name: str = "cinematic",
    project_id: str | None = None, tone: str = "",
) -> Production:
    # tone (thriller/heartfelt/…) overrides the style's default register, so the LOOK
    # and the WRITING are independent choices (a claymation thriller stays tense)
    register = TONE_REGISTERS.get(tone) or _REGISTER.get(style_name, _REGISTER["cinematic"])
    transcript: list[dict] = []
    tokens = 0

    user = f"PREMISE: {premise}\nTARGET LENGTH: {target_seconds}s\nWrite the treatment."
    # INVARIANT: no model failure yields a blank/500 — a dead network during the
    # writer call (live-hit: ConnectionResetError mid-create, user saw a stuck
    # button then a 500) falls back to the deterministic stub treatment. The user
    # gets an editable script + a warning instead of a dead end.
    fallback_warning: str | None = None
    try:
        draft_text, t = llm.complete(_writer_sys(register), user, json_mode=True)
        tokens += t
        draft = _parse(draft_text)
        # Guard a degenerate treatment (malformed/empty) — retry once with an explicit nudge.
        if not draft.get("scenes") or not draft.get("characters"):
            draft_text, t = llm.complete(
                _writer_sys(register),
                user + "\nThe premise may be terse — invent specifics. You MUST return at least "
                "2 characters and 3 scenes.",
                json_mode=True,
            )
            tokens += t
            draft = _parse(draft_text) or draft
    except Exception as exc:  # noqa: BLE001 — network/provider outage during create
        draft = {}
        fallback_warning = f"the writers' room couldn't reach the model ({type(exc).__name__}); a starter script was drafted offline — edit it or press the writers' room again"
    if not draft.get("scenes") or not draft.get("characters"):
        from recut.core.models import StubTextLLM

        stub_text, _ = StubTextLLM().complete(_writer_sys(register), user, json_mode=True)
        draft = _parse(stub_text)
        fallback_warning = fallback_warning or (
            "the model returned an unusable treatment; a starter script was drafted offline — edit it or press the writers' room again")
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
    prod.style.tone = tone
    prod.writers_room = transcript
    prod.token_ledger.text_tokens += tokens
    if fallback_warning:
        prod.warnings.append(fallback_warning)
    return prod


import re as _re

_MALE_CUES = _re.compile(
    r"\b(he|his|him|male|man|men|mr|boy|bro|bros|guy|dude|father|dad|king|prince|"
    r"grandpa|uncle|gentleman|beard|mustache|moustache)\b")


def _assign_voices(raw_chars: list[dict]) -> list[str]:
    """Distinct roster voices, GENDER-AWARE: male-coded characters get Ethan (the
    roster's one male voice) first; everyone else rotates the female voices. Still
    guarantees no two cast members share a voice (up to 4). Word-boundary regex —
    'gym-bro' matches, 'woman'/'broken' don't."""
    female = ["Cherry", "Serena", "Chelsie"]
    out: list[str] = []
    male_taken = False
    for c in raw_chars:
        blob = f" {c.get('name', '')} {c.get('description', '')} {c.get('role', '')} ".lower()
        is_male = bool(_MALE_CUES.search(blob))
        if is_male and not male_taken:
            out.append("Ethan")
            male_taken = True
        elif female:
            out.append(female.pop(0))
        else:
            out.append("Ethan")  # 5th+ character: collisions unavoidable on a 4-voice roster
    return out


def _build_production(t: dict, premise: str, target_seconds: int, style_name: str, project_id: str | None) -> Production:
    style = STYLE_PRESETS.get(style_name, STYLE_PRESETS["cinematic"]).model_copy()
    chars = []
    voices = _assign_voices(t.get("characters", []))
    for i, c in enumerate(t.get("characters", [])):
        chars.append(Character(
            name=c.get("name", "Character"), description=c.get("description", ""), role=c.get("role", ""),
            want=c.get("want", ""), flaw=c.get("flaw", ""), voice=voices[i],
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
