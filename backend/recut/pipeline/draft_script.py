"""The co-writing agent: maps the creator's story onto the recipe's beats, drafts a
line per beat, refines lines, and drafts caption + cover copy.

All model access goes through the TextLLM interface (Qwen-Max in prod, deterministic
stub offline). Every function degrades gracefully: a model failure keeps the prior
line rather than blanking it.
"""

from __future__ import annotations

import json

from recut.core.models import TextLLM
from recut.core.schemas import Recipe, SlotType, TextRole

_COWRITE_SYS = (
    "You are a co-writing agent for short videos. You do script-on-beats: given a beat "
    "structure and the creator's story, write ONE punchy line per beat in the creator's "
    "voice. Return STRICT JSON: {\"beats\":[{\"index\":int,\"text\":str}]}. On-screen-text "
    "beats get a few bold words; voiceover beats get a spoken sentence."
)
_CHAT_SYS = (
    "You are a co-writing chat partner helping a creator shape their story onto a proven "
    "beat structure. Be warm, specific, and brief. Ask one sharp question at a time."
)
_REFINE_SYS = "You refine a single short-video line. Return STRICT JSON {\"text\":str}. Keep it punchy and in-voice."
_CAPTION_SYS = (
    "You draft the social caption, hashtags, and 3 cover concepts for a short video, from "
    "its script. Return STRICT JSON {\"caption\":str,\"hashtags\":[str],"
    "\"covers\":[{\"id\":str,\"label\":str,\"big\":str,\"small\":str}]}."
)


def _beats_brief(recipe: Recipe) -> str:
    rows = [
        f"{b.index}: [{b.label} / {b.slot_type.value} / {b.text_role.value}] {b.pattern}"
        for b in recipe.beats
    ]
    return "\n".join(rows)


def cowrite_reply(llm: TextLLM, history: list[dict], message: str, recipe: Recipe | None = None) -> str:
    """One co-writing chat turn. history = [{role, text}]."""
    convo = "\n".join(f"{m.get('role','user')}: {m.get('text','')}" for m in history[-8:])
    beats = _beats_brief(recipe) if recipe else "(no recipe yet)"
    user = f"BEATS:\n{beats}\n\nCONVERSATION:\n{convo}\n\nCREATOR: {message}\n\nReply:"
    try:
        text, _ = llm.complete(_CHAT_SYS + " co-writing chat", user, json_mode=True)
        return json.loads(text).get("text", text)
    except Exception:  # noqa: BLE001
        return "Tell me the one moment that surprised you most — that's usually the hook."


def draft_script_on_beats(llm: TextLLM, recipe: Recipe, story: str) -> Recipe:
    """Write a line onto every beat. Mutates a copy of the recipe and returns it.

    Lines land where the slot will read them: on_screen_text for text cards,
    transcript_excerpt for voiceover beats (base_cut_from_recipe reads both)."""
    out = recipe.model_copy(deep=True)
    user = f"STORY:\n{story}\n\nBEATS:\n{_beats_brief(out)}\n\nWrite one line per beat."
    try:
        text, tokens = llm.complete(_COWRITE_SYS + " script-on-beats", user, json_mode=True)
        lines = {b["index"]: b["text"] for b in json.loads(text).get("beats", [])}
        out.analysis_meta.tokens += tokens
    except Exception:  # noqa: BLE001 — keep existing beat text rather than blanking
        lines = {}

    for b in out.beats:
        line = lines.get(b.index)
        if not line:
            continue
        if b.slot_type == SlotType.text or b.text_role == TextRole.on_screen_text:
            b.on_screen_text = line
        else:
            b.transcript_excerpt = line
    return out


def refine_beat(llm: TextLLM, current_text: str, instruction: str) -> str:
    user = f"CURRENT LINE: {current_text}\nINSTRUCTION: {instruction}\nReturn the improved line."
    try:
        text, _ = llm.complete(_REFINE_SYS + " refine", user, json_mode=True)
        return json.loads(text).get("text", current_text)
    except Exception:  # noqa: BLE001 — refine is best-effort; keep the current line
        return current_text


def draft_caption_and_cover(llm: TextLLM, script_lines: list[str]) -> dict:
    user = "SCRIPT:\n" + "\n".join(script_lines) + "\n\nDraft caption, hashtags, 3 covers."
    try:
        text, _ = llm.complete(_CAPTION_SYS + " caption cover", user, json_mode=True)
        data = json.loads(text)
        data.setdefault("hashtags", [])
        data.setdefault("covers", [])
        return data
    except Exception:  # noqa: BLE001
        return {
            "caption": "Here's exactly how I did it 👇",
            "hashtags": ["#howto", "#creator"],
            "covers": [
                {"id": "claim", "label": "Bold claim", "big": "HOW", "small": "THE FULL STORY"},
            ],
        }
