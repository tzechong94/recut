from __future__ import annotations

import io

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from recut.api.deps import storage
from recut.core import repo
from recut.core.storage import content_hash
from recut.pipeline.probe import probe

router = APIRouter(prefix="/api", tags=["assets"])


@router.post("/projects/{project_id}/assets", status_code=201)
async def upload_asset(project_id: str, kind: str = "upload", file: UploadFile = File(...)) -> dict:
    if not repo.get_project(project_id):
        raise HTTPException(404, "project not found")
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty upload")
    chash = content_hash(data)
    key = f"projects/{project_id}/{kind}/{chash}_{file.filename}"
    st = storage()
    # Persist to storage, then probe a local temp copy for dims/duration.
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=f"_{file.filename}", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    info = probe(tmp_path, filename=file.filename)
    st.put_file(key, tmp_path, content_type=info.mime)
    asset = repo.create_asset(
        kind=kind, storage_key=key, project_id=project_id, mime=info.mime,
        duration_s=info.duration_s, width=info.width, height=info.height, content_hash=chash,
    )
    asset["url"] = st.url(key)
    return asset


@router.post("/uploads", status_code=201)
async def upload_reference(kind: str = "style_ref", file: UploadFile = File(...)) -> dict:
    """Project-less upload (e.g. a custom-style reference chosen on the premise screen,
    before any production exists). Returns the model-usable storage URL and an asset id
    the browser can render via /assets/{id}/raw."""
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty upload")
    chash = content_hash(data)
    key = f"uploads/{kind}/{chash}_{file.filename or 'image'}"
    st = storage()
    st.put(key, data, content_type=file.content_type or "image/png")
    asset = repo.create_asset(kind=kind, storage_key=key, mime=file.content_type or "image/png", content_hash=chash)
    return {"asset_id": asset["id"], "url": st.url(key)}


@router.get("/assets/{asset_id}")
def get_asset(asset_id: str) -> dict:
    a = repo.get_asset(asset_id)
    if not a:
        raise HTTPException(404, "asset not found")
    a["url"] = storage().url(a["storage_key"])
    return a


@router.get("/assets/{asset_id}/raw")
def get_asset_raw(asset_id: str):
    """Stream the raw bytes — lets the browser load media in local dev without a
    public MinIO URL."""
    a = repo.get_asset(asset_id)
    if not a:
        raise HTTPException(404, "asset not found")
    data = storage().get(a["storage_key"])
    return StreamingResponse(io.BytesIO(data), media_type=a["mime"])
