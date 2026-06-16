"""Generation + music-sync endpoints (Lane D).

Generation is queued (async). Music-sync is applied as a separate timeline version so
it can never corrupt the core cut.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from recut.core import queue, repo
from recut.core.timeline_ops import slots_to_generate
from recut.pipeline.music import apply_music_sync, clear_music_sync, detect_beats

router = APIRouter(prefix="/api", tags=["generation"])


class GenerateRequest(BaseModel):
    slot_id: str | None = None  # None => queue all kept auto slots that need generating
    voiceover: bool = False


@router.post("/timelines/{timeline_id}/generate", status_code=202)
def generate(timeline_id: str, body: GenerateRequest) -> dict:
    tl = repo.get_timeline(timeline_id)
    if not tl:
        raise HTTPException(404, "timeline not found")
    jobs: list[str] = []
    if body.slot_id:
        jobs.append(queue.enqueue("generate_slot", {"timeline_id": timeline_id, "slot_id": body.slot_id}, project_id=tl.project_id))
    else:
        for s in slots_to_generate(tl):
            jobs.append(queue.enqueue("generate_slot", {"timeline_id": timeline_id, "slot_id": s.id}, project_id=tl.project_id))
    if body.voiceover:
        jobs.append(queue.enqueue("generate_voiceover", {"timeline_id": timeline_id}, project_id=tl.project_id))
    return {"job_ids": jobs, "queued": len(jobs)}


class MusicSyncRequest(BaseModel):
    enabled: bool = True
    audio_asset_id: str | None = None
    bpm: float | None = None


@router.post("/timelines/{timeline_id}/music-sync")
def music_sync(timeline_id: str, body: MusicSyncRequest) -> dict:
    """Apply or clear music beat-sync. Produces a NEW timeline version; the core cut
    is never mutated in place."""
    tl = repo.get_timeline(timeline_id)
    if not tl:
        raise HTTPException(404, "timeline not found")
    if not body.enabled:
        out = clear_music_sync(tl)
    else:
        audio_path = None
        if body.audio_asset_id:
            a = repo.get_asset(body.audio_asset_id)
            if a:
                audio_path = a["storage_key"]
        grid = detect_beats(audio_path, default_bpm=body.bpm or 120.0)
        out = apply_music_sync(tl, grid)
    repo.save_timeline(out)
    return out.model_dump(mode="json")
