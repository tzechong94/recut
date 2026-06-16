from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from recut.core import repo
from recut.core.schemas import Timeline
from recut.core.timeline_ops import attach_upload, base_cut_from_recipe, recompute_ledger

router = APIRouter(prefix="/api", tags=["timelines"])


class BaseCutRequest(BaseModel):
    recipe_id: str


@router.post("/projects/{project_id}/base-cut", status_code=201)
def build_base_cut(project_id: str, body: BaseCutRequest) -> dict:
    """Generate the base cut: every beat becomes a stand-in slot so it plays now."""
    recipe = repo.get_recipe(body.recipe_id)
    if not recipe:
        raise HTTPException(404, "recipe not found")
    tl = base_cut_from_recipe(recipe, project_id=project_id)
    repo.save_timeline(tl)
    repo.update_project(project_id, stage=3)
    return tl.model_dump(mode="json")


@router.get("/projects/{project_id}/timeline")
def latest_timeline(project_id: str) -> dict:
    tl = repo.latest_timeline_for_project(project_id)
    if not tl:
        raise HTTPException(404, "no timeline for project")
    return tl.model_dump(mode="json")


@router.get("/timelines/{timeline_id}")
def get_timeline(timeline_id: str) -> dict:
    tl = repo.get_timeline(timeline_id)
    if not tl:
        raise HTTPException(404, "timeline not found")
    return tl.model_dump(mode="json")


@router.put("/timelines/{timeline_id}")
def save_timeline(timeline_id: str, body: dict) -> dict:
    """Frontend autosave. Validates the doc through the schema, recomputes the
    ledger (so the on-screen meter is always honest), bumps version."""
    body["timeline_id"] = timeline_id
    try:
        tl = Timeline.model_validate(body)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, f"invalid timeline: {exc}")
    recompute_ledger(tl)
    tl.version = body.get("version", tl.version)
    repo.save_timeline(tl)
    return tl.model_dump(mode="json")


class AttachUpload(BaseModel):
    asset_id: str


@router.post("/timelines/{timeline_id}/slots/{slot_id}/upload")
def attach_slot_upload(timeline_id: str, slot_id: str, body: AttachUpload) -> dict:
    """Swap a slot's stand-in for the creator's real footage."""
    tl = repo.get_timeline(timeline_id)
    if not tl:
        raise HTTPException(404, "timeline not found")
    if not repo.get_asset(body.asset_id):
        raise HTTPException(404, "asset not found")
    try:
        attach_upload(tl, slot_id, body.asset_id)
    except KeyError:
        raise HTTPException(404, "slot not found")
    repo.save_timeline(tl)
    return tl.model_dump(mode="json")
