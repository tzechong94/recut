"""Co-writing agent endpoints (Lane C). Thin REST over the draft_script pipeline;
the same operations are exposed as MCP tools in recut.mcp.server."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from recut.api.deps import models
from recut.core import repo
from recut.core.schemas import SlotType
from recut.core.timeline_ops import add_slot_from_prompt
from recut.pipeline.draft_script import (
    cowrite_reply,
    draft_caption_and_cover,
    draft_script_on_beats,
    refine_beat,
)

router = APIRouter(prefix="/api", tags=["agent"])


class CowriteRequest(BaseModel):
    message: str
    history: list[dict] = []
    recipe_id: str | None = None


@router.post("/projects/{project_id}/cowrite")
def cowrite(project_id: str, body: CowriteRequest) -> dict:
    recipe = repo.get_recipe(body.recipe_id) if body.recipe_id else None
    reply = cowrite_reply(models().text, body.history, body.message, recipe)
    return {"reply": reply}


class DraftScriptRequest(BaseModel):
    recipe_id: str
    story: str = ""


@router.post("/projects/{project_id}/draft-script")
def draft_script(project_id: str, body: DraftScriptRequest) -> dict:
    recipe = repo.get_recipe(body.recipe_id)
    if not recipe:
        raise HTTPException(404, "recipe not found")
    drafted = draft_script_on_beats(models().text, recipe, body.story)
    repo.save_recipe(drafted)
    repo.update_project(project_id, stage=2)
    return drafted.model_dump(mode="json")


class RefineRequest(BaseModel):
    instruction: str = "make it punchier"


@router.post("/timelines/{timeline_id}/slots/{slot_id}/refine")
def refine(timeline_id: str, slot_id: str, body: RefineRequest) -> dict:
    tl = repo.get_timeline(timeline_id)
    if not tl:
        raise HTTPException(404, "timeline not found")
    slot = next((s for s in tl.slots if s.id == slot_id), None)
    if not slot:
        raise HTTPException(404, "slot not found")
    slot.text = refine_beat(models().text, slot.text, body.instruction)
    repo.save_timeline(tl)
    return {"text": slot.text, "timeline": tl.model_dump(mode="json")}


class AddSlotRequest(BaseModel):
    prompt: str
    after_slot_id: str | None = None
    slot_type: SlotType = SlotType.broll


@router.post("/timelines/{timeline_id}/slots", status_code=201)
def add_slot(timeline_id: str, body: AddSlotRequest) -> dict:
    tl = repo.get_timeline(timeline_id)
    if not tl:
        raise HTTPException(404, "timeline not found")
    add_slot_from_prompt(tl, body.after_slot_id, body.prompt, body.slot_type)
    repo.save_timeline(tl)
    return tl.model_dump(mode="json")


@router.post("/timelines/{timeline_id}/caption-cover")
def caption_cover(timeline_id: str) -> dict:
    tl = repo.get_timeline(timeline_id)
    if not tl:
        raise HTTPException(404, "timeline not found")
    lines = [s.text for s in tl.slots if s.text]
    result = draft_caption_and_cover(models().text, lines)
    repo.update_project(tl.project_id, stage=4) if tl.project_id else None
    return result
