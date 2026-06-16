"""Reference ingestion -> recipe endpoint (Lane A)."""

from __future__ import annotations

import tempfile

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from recut.api.deps import models, storage
from recut.core import repo
from recut.pipeline.analyse import analyse_reference

router = APIRouter(prefix="/api", tags=["analyse"])


class AnalyseRequest(BaseModel):
    asset_id: str
    name: str = "Extracted recipe"


@router.post("/projects/{project_id}/analyse", status_code=201)
def analyse(project_id: str, body: AnalyseRequest) -> dict:
    if not repo.get_project(project_id):
        raise HTTPException(404, "project not found")
    asset = repo.get_asset(body.asset_id)
    if not asset:
        raise HTTPException(404, "asset not found")

    # Pull the reference to a local file for the analyzer (real Qwen-VL needs a path/URL;
    # the stub ignores it). Fallback inside analyse_reference guarantees a usable recipe.
    st = storage()
    with tempfile.NamedTemporaryFile(suffix="_ref", delete=False) as tmp:
        local = tmp.name
    try:
        st.get_to_file(asset["storage_key"], local)
    except Exception:
        local = asset["storage_key"]  # let the analyzer/fallback handle it

    m = models()
    recipe = analyse_reference(
        local, vision=m.vision, transcriber=m.transcriber,
        project_id=project_id, source_asset_id=body.asset_id, name=body.name,
    )
    repo.save_recipe(recipe)
    repo.update_project(project_id, stage=1)
    return recipe.model_dump(mode="json")
