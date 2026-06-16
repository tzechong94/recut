"""Postgres-backed job queue — no broker. A `jobs` table + FOR UPDATE SKIP LOCKED
gives a durable, resumable, observable queue with zero extra infra. Hidden behind
this module so Alibaba can swap to RocketMQ as a config change.

State machine::

    queued ──claim──▶ running ──complete──▶ done
       ▲                  │
       └──fail(retry)─────┘  (attempts < max)
                          │
                          └──fail(final)──▶ failed   (attempts >= max)

Resumability: a job's payload + result are JSON, so a worker that dies mid-render
re-claims the same job and skips work already cached in storage (by content hash).
"""

from __future__ import annotations

import time

from sqlalchemy import text

from recut.core.config import get_settings
from recut.core.db import Job, dialect_name, session_scope


def enqueue(job_type: str, payload: dict, project_id: str | None = None) -> str:
    with session_scope() as s:
        job = Job(type=job_type, payload=payload, project_id=project_id, status="queued")
        s.add(job)
        s.flush()
        return job.id


def claim_next(worker_id: str = "worker") -> Job | None:
    """Atomically claim one queued (or retryable) job. Returns a detached copy."""
    max_attempts = get_settings().job_max_attempts
    with session_scope() as s:
        if dialect_name() == "postgresql":
            row = s.execute(
                text(
                    "SELECT id FROM jobs WHERE status='queued' "
                    "ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1"
                )
            ).first()
            if not row:
                return None
            job = s.get(Job, row[0])
        else:
            # SQLite / others: no SKIP LOCKED; a single-worker dev setup is fine.
            job = (
                s.query(Job)
                .filter(Job.status == "queued")
                .order_by(Job.created_at)
                .first()
            )
            if not job:
                return None
        job.status = "running"
        job.attempts += 1
        job.updated_at = time.time()
        s.flush()
        s.expunge(job)
        return job


def update_progress(job_id: str, progress: float) -> None:
    with session_scope() as s:
        job = s.get(Job, job_id)
        if job:
            job.progress = max(0.0, min(1.0, progress))
            job.updated_at = time.time()


def complete(job_id: str, result: dict) -> None:
    with session_scope() as s:
        job = s.get(Job, job_id)
        if job:
            job.status = "done"
            job.progress = 1.0
            job.result = result
            job.updated_at = time.time()


def fail(job_id: str, error: str) -> str:
    """Mark failed. Requeues for retry if attempts remain, else final 'failed'."""
    max_attempts = get_settings().job_max_attempts
    with session_scope() as s:
        job = s.get(Job, job_id)
        if not job:
            return "missing"
        job.error = error[:2000]
        job.updated_at = time.time()
        if job.attempts < max_attempts:
            job.status = "queued"  # retry with backoff handled by the worker loop
            return "requeued"
        job.status = "failed"
        return "failed"


def get_job(job_id: str) -> Job | None:
    with session_scope() as s:
        job = s.get(Job, job_id)
        if job:
            s.expunge(job)
        return job


def jobs_for_project(project_id: str) -> list[Job]:
    with session_scope() as s:
        jobs = s.query(Job).filter(Job.project_id == project_id).order_by(Job.created_at).all()
        for j in jobs:
            s.expunge(j)
        return jobs
