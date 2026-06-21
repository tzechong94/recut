"""Generation job handlers (Lane D). Async, gap-fill, kept-slots-only, token-capped.

    generate_slot       — one kept auto slot -> Wan b-roll or Qwen-Image text card
    generate_voiceover  — CosyVoice voiceover for the whole timeline

A slot that would breach the project's token cap is marked failed (=> stand-in in the
render) and the job completes with a `skipped` result. Never a silent drop, never a
blank frame.
"""

from __future__ import annotations

from recut.core import repo
from recut.core.db import Job
from recut.core.schemas import SlotSource, SlotStatus
from recut.core.timeline_ops import mark_generated, recompute_ledger
from recut.pipeline.generate import (
    TokenCapExceeded,
    generate_for_slot,
    generate_voiceover_track,
)
from recut.worker.registry import WorkerContext, register


def _project_cap(project_id: str | None, ctx: WorkerContext) -> int:
    if project_id:
        p = repo.get_project(project_id)
        if p:
            return p["token_cap"]
    return ctx.settings.project_token_cap


@register("generate_slot")
def handle_generate_slot(job: Job, ctx: WorkerContext) -> dict:
    tl = repo.get_timeline(job.payload["timeline_id"])
    if not tl:
        raise ValueError("timeline not found")
    slot = next((s for s in tl.slots if s.id == job.payload["slot_id"]), None)
    if not slot:
        raise ValueError("slot not found")

    # Generate kept slots that the creator hasn't replaced with their own upload.
    # (ai_first generates every visual slot; gap_fill marks only auto slots kept, so
    # this single guard is correct for both modes.)
    if not slot.kept or slot.source == SlotSource.user_upload:
        return {"skipped": True, "reason": "slot replaced by upload or not kept"}

    slot.status = SlotStatus.generating
    repo.save_timeline(tl)

    try:
        gen = generate_for_slot(
            slot, models=ctx.models, storage=ctx.storage, project_id=tl.project_id,
            tokens_already_spent=tl.token_ledger.tokens_spent, token_cap=_project_cap(tl.project_id, ctx),
        )
    except TokenCapExceeded as exc:
        slot.status = SlotStatus.failed  # render falls back to the stand-in
        repo.save_timeline(tl)
        return {"skipped": True, "reason": str(exc)}

    asset = repo.create_asset(
        kind="generated", storage_key=gen.storage_key, project_id=tl.project_id, mime=gen.mime,
        duration_s=gen.duration_s, width=gen.width, height=gen.height,
    )
    mark_generated(tl, slot.id, asset["id"], tool=("generate_broll" if slot.type.value == "broll" else "generate_text_card"), tokens=gen.tokens)
    repo.save_timeline(tl)
    return {"slot_id": slot.id, "asset_id": asset["id"], "tokens": gen.tokens}


@register("generate_voiceover")
def handle_generate_voiceover(job: Job, ctx: WorkerContext) -> dict:
    tl = repo.get_timeline(job.payload["timeline_id"])
    if not tl:
        raise ValueError("timeline not found")
    lines = [s.text for s in tl.slots if s.text_role.value == "voiceover" and s.text]
    if not lines:
        return {"skipped": True, "reason": "no voiceover lines"}
    text = " ".join(lines)

    try:
        gen = generate_voiceover_track(
            text, models=ctx.models, storage=ctx.storage, project_id=tl.project_id,
            tokens_already_spent=tl.token_ledger.tokens_spent, token_cap=_project_cap(tl.project_id, ctx),
            voice=job.payload.get("voice", "default"),
        )
    except TokenCapExceeded as exc:
        return {"skipped": True, "reason": str(exc)}

    asset = repo.create_asset(
        kind="audio", storage_key=gen.storage_key, project_id=tl.project_id, mime=gen.mime,
        duration_s=gen.duration_s,
    )
    tl.audio.voiceover.asset_id = asset["id"]
    tl.audio.voiceover.enabled = True
    tl.audio.voiceover.tokens = gen.tokens
    recompute_ledger(tl)
    repo.save_timeline(tl)
    return {"asset_id": asset["id"], "tokens": gen.tokens}
