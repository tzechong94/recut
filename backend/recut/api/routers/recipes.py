from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from recut.core import repo
from recut.core.schemas import Recipe

router = APIRouter(prefix="/api/recipes", tags=["recipes"])


class SaveToLibrary(BaseModel):
    saved: bool = True


@router.get("/library")
def list_library() -> list[dict]:
    """Recipe library: saved formats the creator can reuse on a new story."""
    return [r.model_dump(mode="json") for r in repo.list_saved_recipes()]


@router.get("/{recipe_id}")
def get_recipe(recipe_id: str) -> dict:
    r = repo.get_recipe(recipe_id)
    if not r:
        raise HTTPException(404, "recipe not found")
    return r.model_dump(mode="json")


@router.post("/{recipe_id}/save")
def save_to_library(recipe_id: str, body: SaveToLibrary) -> dict:
    if not repo.set_recipe_saved(recipe_id, body.saved):
        raise HTTPException(404, "recipe not found")
    return {"recipe_id": recipe_id, "saved": body.saved}
