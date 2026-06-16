"""MCP tool implementations — plain, testable functions.

These ARE the pipeline operations the co-writing agent calls over MCP (scored). They
wrap the same core/pipeline functions the REST API uses, so MCP is real but the
deterministic API path is never at the mercy of an agent loop. server.py registers
each of these as an MCP tool.
"""

from __future__ import annotations

import tempfile

from recut.core import queue, repo
from recut.core.models import get_models
from recut.core.schemas import SlotType
from recut.core.storage import get_storage
from recut.core.timeline_ops import add_slot_from_prompt as _add_slot
from recut.core.timeline_ops import base_cut_from_recipe
from recut.pipeline.analyse import analyse_reference as _analyse
from recut.pipeline.draft_script import (
    draft_caption_and_cover as _caption,
    draft_script_on_beats as _draft,
    refine_beat as _refine,
)


def analyse_reference(project_id: str, asset_id: str) -> dict:
    """Analyse a reference asset into a transferable recipe (structure only)."""
    asset = repo.get_asset(asset_id)
    if not asset:
        raise ValueError("asset not found")
    st = get_storage()
    with tempfile.NamedTemporaryFile(suffix="_ref", delete=False) as tmp:
        local = tmp.name
    try:
        st.get_to_file(asset["storage_key"], local)
    except Exception:
        local = asset["storage_key"]
    m = get_models()
    recipe = _analyse(local, vision=m.vision, transcriber=m.transcriber, project_id=project_id, source_asset_id=asset_id)
    repo.save_recipe(recipe)
    return recipe.model_dump(mode="json")


def build_base_cut(project_id: str, recipe_id: str) -> dict:
    """Turn a recipe into a base cut (all stand-ins, plays end to end now)."""
    recipe = repo.get_recipe(recipe_id)
    if not recipe:
        raise ValueError("recipe not found")
    tl = base_cut_from_recipe(recipe, project_id=project_id)
    repo.save_timeline(tl)
    return tl.model_dump(mode="json")


def draft_script_on_beats(recipe_id: str, story: str) -> dict:
    """Write the creator's story onto the recipe's beats."""
    recipe = repo.get_recipe(recipe_id)
    if not recipe:
        raise ValueError("recipe not found")
    drafted = _draft(get_models().text, recipe, story)
    repo.save_recipe(drafted)
    return drafted.model_dump(mode="json")


def refine_beat(timeline_id: str, slot_id: str, instruction: str) -> dict:
    """Refine one beat's line in place."""
    tl = repo.get_timeline(timeline_id)
    if not tl:
        raise ValueError("timeline not found")
    slot = next((s for s in tl.slots if s.id == slot_id), None)
    if not slot:
        raise ValueError("slot not found")
    slot.text = _refine(get_models().text, slot.text, instruction)
    repo.save_timeline(tl)
    return {"slot_id": slot_id, "text": slot.text}


def add_slot_from_prompt(timeline_id: str, prompt: str, after_slot_id: str | None = None) -> dict:
    """Insert a new generated-b-roll slot described by a prompt."""
    tl = repo.get_timeline(timeline_id)
    if not tl:
        raise ValueError("timeline not found")
    new = _add_slot(tl, after_slot_id, prompt, SlotType.broll)
    repo.save_timeline(tl)
    return {"slot_id": new.id, "timeline": tl.model_dump(mode="json")}


def draft_caption_and_cover(timeline_id: str) -> dict:
    """Draft caption, hashtags, and 3 cover concepts from the timeline's script."""
    tl = repo.get_timeline(timeline_id)
    if not tl:
        raise ValueError("timeline not found")
    lines = [s.text for s in tl.slots if s.text]
    return _caption(get_models().text, lines)


def generate_broll(timeline_id: str, slot_id: str) -> dict:
    """Queue async generated b-roll for a kept slot."""
    if not repo.get_timeline(timeline_id):
        raise ValueError("timeline not found")
    job_id = queue.enqueue("generate_slot", {"timeline_id": timeline_id, "slot_id": slot_id})
    return {"job_id": job_id, "status": "queued"}


def generate_voiceover(timeline_id: str) -> dict:
    """Queue async voiceover for the timeline."""
    if not repo.get_timeline(timeline_id):
        raise ValueError("timeline not found")
    job_id = queue.enqueue("generate_voiceover", {"timeline_id": timeline_id})
    return {"job_id": job_id, "status": "queued"}


def render_export(timeline_id: str) -> dict:
    """Queue the final 9:16 MP4 export render."""
    tl = repo.get_timeline(timeline_id)
    if not tl:
        raise ValueError("timeline not found")
    job_id = queue.enqueue("render_export", {"timeline_id": timeline_id}, project_id=tl.project_id)
    return {"job_id": job_id, "status": "queued"}


def job_status(job_id: str) -> dict:
    job = queue.get_job(job_id)
    if not job:
        raise ValueError("job not found")
    return {"id": job.id, "status": job.status, "progress": job.progress, "result": job.result, "error": job.error}


# The toolset the MCP server exposes. (name -> callable)
TOOLS = {
    "analyse_reference": analyse_reference,
    "build_base_cut": build_base_cut,
    "draft_script_on_beats": draft_script_on_beats,
    "refine_beat": refine_beat,
    "add_slot_from_prompt": add_slot_from_prompt,
    "draft_caption_and_cover": draft_caption_and_cover,
    "generate_broll": generate_broll,
    "generate_voiceover": generate_voiceover,
    "render_export": render_export,
    "job_status": job_status,
}
