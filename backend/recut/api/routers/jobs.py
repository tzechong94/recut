from __future__ import annotations

from fastapi import APIRouter, HTTPException

from recut.core import queue, repo

router = APIRouter(prefix="/api", tags=["jobs"])


@router.post("/timelines/{timeline_id}/export", status_code=202)
def export_timeline(timeline_id: str) -> dict:
    """Enqueue a render. The worker renders async and writes the MP4 to storage;
    poll GET /api/jobs/{id} for progress + the result asset."""
    tl = repo.get_timeline(timeline_id)
    if not tl:
        raise HTTPException(404, "timeline not found")
    job_id = queue.enqueue("render_export", {"timeline_id": timeline_id}, project_id=tl.project_id)
    return {"job_id": job_id, "status": "queued"}


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = queue.get_job(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return {
        "id": job.id, "type": job.type, "status": job.status, "progress": job.progress,
        "result": job.result, "error": job.error, "attempts": job.attempts,
    }


@router.get("/projects/{project_id}/jobs")
def project_jobs(project_id: str) -> list[dict]:
    return [
        {"id": j.id, "type": j.type, "status": j.status, "progress": j.progress, "result": j.result, "error": j.error}
        for j in queue.jobs_for_project(project_id)
    ]
