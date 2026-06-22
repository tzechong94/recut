"""Pure functions over the canonical timeline.

No I/O, no DB. These build a base cut from a recipe and keep the token ledger honest.
Everything here is unit-tested because the whole product reads the timeline.
"""

from __future__ import annotations

from recut.core.config import get_settings
from recut.core.schemas import (
    ACTOR_AUTO,
    Generation,
    Recipe,
    Slot,
    SlotSource,
    SlotStatus,
    SlotType,
    StandIn,
    TextRole,
    Timeline,
    TokenLedger,
)

# Visual slot types that can be AI-generated (all v1 types are visual).
VISUAL_TYPES = frozenset({SlotType.text, SlotType.talk, SlotType.roll, SlotType.broll})


def _ai_first(ai_first: bool | None) -> bool:
    return get_settings().generation_mode == "ai_first" if ai_first is None else ai_first


def _visual_prompt(beat_text: str, pattern: str, slot_type: SlotType) -> str:
    """Build a Wan/image prompt for a slot from its line + structural pattern."""
    base = (beat_text or pattern or "b-roll").strip()
    if slot_type == SlotType.text:
        return f"clean minimal background for a text card: {base}"
    return f"{base}. Cinematic vertical 9:16 b-roll, natural lighting, no on-screen text."

# Stand-in tint per slot type (mirrors the prototype's TYPES colors).
STANDIN_COLORS: dict[SlotType, str] = {
    SlotType.text: "#64748B",
    SlotType.talk: "#FF5C49",
    SlotType.roll: "#0FB5A6",
    SlotType.broll: "#7B5CFF",
    SlotType.illus: "#F5A524",
    SlotType.face: "#EC4899",
}

# Rough token cost of generating one second of each auto type. Used only to compute
# the *naive full-generation baseline* (what it would cost to generate the ENTIRE
# video instead of using the creator's footage). The headline metric is the gap.
NAIVE_TOKENS_PER_S: dict[SlotType, int] = {
    SlotType.broll: 1800,  # Wan video gen
    SlotType.text: 250,  # Qwen-Image card background
    SlotType.talk: 1800,  # would-be generated face (the expensive path we avoid)
    SlotType.roll: 1800,
}


def base_cut_from_recipe(
    recipe: Recipe, project_id: str | None = None, ai_first: bool | None = None
) -> Timeline:
    """Turn a recipe into a base cut: every beat becomes a stand-in slot so the cut
    plays end to end immediately.

    ai_first (revid style, default): EVERY visual slot is marked kept => the whole reel
    auto-generates; the creator swaps in their own uploads per slot.
    gap_fill (the brief): only auto slots (text/b-roll) are kept; talk/roll are the
    creator's footage."""
    ai = _ai_first(ai_first)
    slots: list[Slot] = []
    for b in recipe.beats:
        text_role = b.text_role
        if text_role == TextRole.none:
            text_role = (
                TextRole.on_screen_text if b.slot_type == SlotType.text else TextRole.voiceover
            )
        text = b.on_screen_text or b.transcript_excerpt or ""
        kept = True if ai else (b.slot_type in ACTOR_AUTO)
        # Regenerate the VISUAL from the shot description; for a text card, from the caption.
        visual_src = text if b.slot_type == SlotType.text else (b.description or b.pattern or text)
        gen = (
            Generation(
                tool="generate_text_card" if b.slot_type == SlotType.text else "generate_broll",
                prompt=_visual_prompt(visual_src, b.pattern, b.slot_type),
            )
            if (ai or b.slot_type in ACTOR_AUTO)
            else None
        )
        slots.append(
            Slot(
                beat_label=b.label,
                type=b.slot_type,
                duration_s=b.duration_s,
                source=SlotSource.standin,
                text=text,
                text_role=text_role,
                style=b.style_hint,
                status=SlotStatus.ready,
                standin=StandIn(color=STANDIN_COLORS.get(b.slot_type, "#7B5CFF"), label="stand-in"),
                kept=kept,
                generation=gen,
            )
        )
    tl = Timeline(project_id=project_id or recipe.project_id, slots=slots)
    recompute_ledger(tl)
    return tl


def recompute_ledger(tl: Timeline) -> TokenLedger:
    """Recompute the token ledger from current slot state. Single place this math
    lives, so the on-screen meter and the eval report always agree."""
    real = gen = standin = 0.0
    tokens = 0
    naive = 0
    for s in tl.slots:
        naive += int(s.duration_s * NAIVE_TOKENS_PER_S.get(s.type, 1800))
        if s.source == SlotSource.user_upload:
            real += s.duration_s
        elif s.source == SlotSource.generated:
            gen += s.duration_s
            if s.generation:
                tokens += s.generation.tokens
        else:
            standin += s.duration_s
    # timeline-level audio generation (CosyVoice voiceover) tokens count too
    tokens += tl.audio.voiceover.tokens + tl.audio.bed.tokens
    led = TokenLedger(
        real_footage_s=round(real, 3),
        generated_s=round(gen, 3),
        standin_s=round(standin, 3),
        tokens_spent=tokens,
        naive_baseline_tokens=naive,
    )
    tl.token_ledger = led
    return led


def slots_needing_creator(tl: Timeline) -> list[Slot]:
    """'you' slots that are still stand-ins — what the creator must film or pick."""
    return [s for s in tl.slots if s.is_you and s.source == SlotSource.standin]


def slots_to_generate(tl: Timeline, ai_first: bool | None = None) -> list[Slot]:
    """Slots the creator kept that aren't resolved yet. ai_first => every visual slot
    not replaced by an upload; gap_fill => only auto slots (text/b-roll). Generation is
    deferred, async, and only for kept slots."""
    eligible = VISUAL_TYPES if _ai_first(ai_first) else ACTOR_AUTO
    return [
        s
        for s in tl.slots
        if s.type in eligible
        and s.kept
        and s.source != SlotSource.user_upload
        and s.status in (SlotStatus.ready, SlotStatus.pending_generation, SlotStatus.failed)
        and s.asset_id is None
    ]


def attach_upload(tl: Timeline, slot_id: str, asset_id: str) -> Slot:
    """Replace a slot's stand-in with the creator's real footage."""
    s = _find(tl, slot_id)
    s.asset_id = asset_id
    s.source = SlotSource.user_upload
    s.status = SlotStatus.ready
    recompute_ledger(tl)
    return s


def mark_generated(tl: Timeline, slot_id: str, asset_id: str, tool: str, tokens: int) -> Slot:
    s = _find(tl, slot_id)
    s.asset_id = asset_id
    s.source = SlotSource.generated
    s.status = SlotStatus.ready
    s.generation = Generation(tool=tool, tokens=tokens, prompt=(s.generation.prompt if s.generation else ""))
    recompute_ledger(tl)
    return s


def add_slot_from_prompt(
    tl: Timeline, after_slot_id: str | None, prompt: str, slot_type: SlotType = SlotType.broll
) -> Slot:
    """Agent path: insert a new auto slot (default generated b-roll) described by a
    prompt, after a given slot. Mirrors the storyboard's 'describe it for the agent'."""
    new = Slot(
        beat_label="New",
        type=slot_type,
        duration_s=3.0,
        source=SlotSource.standin,
        text=prompt if slot_type != SlotType.text else prompt,
        text_role=TextRole.on_screen_text if slot_type == SlotType.text else TextRole.voiceover,
        status=SlotStatus.ready,
        standin=StandIn(color=STANDIN_COLORS.get(slot_type, "#7B5CFF"), label="stand-in"),
        kept=slot_type in ACTOR_AUTO,
        generation=Generation(tool="generate_broll", prompt=prompt) if slot_type == SlotType.broll else None,
    )
    if after_slot_id is None:
        tl.slots.append(new)
    else:
        idx = next((i for i, s in enumerate(tl.slots) if s.id == after_slot_id), len(tl.slots) - 1)
        tl.slots.insert(idx + 1, new)
    for i, s in enumerate(tl.slots):
        s.order = i
    recompute_ledger(tl)
    return new


def _find(tl: Timeline, slot_id: str) -> Slot:
    for s in tl.slots:
        if s.id == slot_id:
            return s
    raise KeyError(f"slot {slot_id} not in timeline {tl.timeline_id}")
