"""Job handler registry. Lanes register handlers here; the worker loop stays closed.

A handler is `(job: Job, ctx: WorkerContext) -> dict` and returns the job result.
Raising re-queues (with backoff) until attempts are exhausted, then the job is failed
with a visible error — never a silent drop.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from recut.core.config import Settings, get_settings
from recut.core.db import Job
from recut.core.models import ModelClients, get_models
from recut.core.storage import Storage, get_storage

Handler = Callable[["Job", "WorkerContext"], dict]
_REGISTRY: dict[str, Handler] = {}


def register(job_type: str) -> Callable[[Handler], Handler]:
    def deco(fn: Handler) -> Handler:
        _REGISTRY[job_type] = fn
        return fn

    return deco


def get_handler(job_type: str) -> Handler | None:
    return _REGISTRY.get(job_type)


def registered_types() -> list[str]:
    return sorted(_REGISTRY)


@dataclass
class WorkerContext:
    settings: Settings
    storage: Storage
    models: ModelClients


def build_context(settings: Settings | None = None) -> WorkerContext:
    s = settings or get_settings()
    return WorkerContext(settings=s, storage=get_storage(s), models=get_models(s))
