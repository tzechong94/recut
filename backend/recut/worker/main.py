"""Worker loop — claims jobs and runs registered handlers.

    ┌────────────┐ claim ┌──────────┐ handler ok ┌──────┐
    │ poll queue │ ────▶ │ dispatch │ ─────────▶ │ done │
    └────────────┘       └──────────┘            └──────┘
          ▲                    │ raise
          │                    ▼
          └──── backoff ── requeue (attempts<max) ─or─ fail (visible error)

Single process here; horizontal scale is "run more of these" because claim_next uses
FOR UPDATE SKIP LOCKED on Postgres. process_once() is exposed so tests drive it
deterministically without sleeping.
"""

from __future__ import annotations

import time

from recut.core import queue
from recut.core.config import get_settings
from recut.core.db import init_db
from recut.worker import handlers  # noqa: F401  (registers handlers)
from recut.worker.registry import WorkerContext, build_context, get_handler


def process_once(ctx: WorkerContext) -> str | None:
    """Claim and run at most one job. Returns the job id processed, or None if idle."""
    job = queue.claim_next()
    if not job:
        return None
    handler = get_handler(job.type)
    if not handler:
        queue.fail(job.id, f"no handler for job type {job.type!r}")
        return job.id
    try:
        result = handler(job, ctx)
        queue.complete(job.id, result)
    except Exception as exc:  # noqa: BLE001 — top-level boundary; error is recorded on the job
        outcome = queue.fail(job.id, f"{type(exc).__name__}: {exc}")
        if outcome == "failed":
            # Final failure: visible on the job row (status=failed, error set).
            pass
    return job.id


def run() -> None:
    init_db()
    ctx = build_context()
    settings = get_settings()
    from recut.worker.registry import registered_types

    print(f"[recut-worker] ready. handlers: {registered_types()}")
    while True:
        jid = process_once(ctx)
        if jid is None:
            time.sleep(settings.worker_poll_interval_s)
        else:
            time.sleep(0.05)


if __name__ == "__main__":
    run()
