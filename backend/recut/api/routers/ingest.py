"""Link-fetch ingestion endpoint (best-effort, off by default).

Upload remains the clean path (routers/assets.py). This mirrors it for a pasted link
when RECUT_ENABLE_LINK_FETCH=true.
"""

from __future__ import annotations

import tempfile

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from recut.api.deps import settings, storage
from recut.core import repo
from recut.core.storage import content_hash
from recut.pipeline.ingest_link import LinkFetchError, detect_platform, get_link_fetcher
from recut.pipeline.probe import probe

router = APIRouter(prefix="/api", tags=["ingest"])


class IngestLink(BaseModel):
    url: str


@router.post("/projects/{project_id}/ingest-link", status_code=201)
def ingest_link(project_id: str, body: IngestLink) -> dict:
    s = settings()
    if not s.enable_link_fetch:
        raise HTTPException(
            403,
            "Link fetch is disabled. Upload is the clean path. To enable best-effort "
            "link fetch (grey on platform terms, your responsibility), set "
            "RECUT_ENABLE_LINK_FETCH=true.",
        )
    if not repo.get_project(project_id):
        raise HTTPException(404, "project not found")
    url = body.url.strip()
    if not url:
        raise HTTPException(400, "empty url")

    try:
        media = get_link_fetcher(s).fetch(url)
    except LinkFetchError as exc:
        # 422: we understood the request but the platform/link won't give us the file.
        raise HTTPException(422, f"could not fetch reference from link: {exc}")

    chash = content_hash(media.data)
    key = f"projects/{project_id}/reference/{chash}.mp4"
    st = storage()
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(media.data)
        tmp_path = tmp.name
    info = probe(tmp_path, filename="reference.mp4")
    st.put_file(key, tmp_path, content_type=info.mime or media.mime)
    asset = repo.create_asset(
        kind="reference", storage_key=key, project_id=project_id, mime=info.mime or media.mime,
        duration_s=info.duration_s, width=info.width, height=info.height, content_hash=chash,
        meta={"source_url": media.source_url, "platform": media.platform, "title": media.title},
    )
    asset["url"] = st.url(key)
    return asset
