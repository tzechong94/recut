"""Persistence — single-tenant for the demo, but the data model stays clean so
multi-tenant is a later add (a tenant_id column + scoping), not a rewrite.

Tables:
  projects   — the creator's projects, each with a stage
  assets     — every piece of media (reference, upload, generated, standin, export)
  recipes    — extracted recipe JSON (document)
  timelines  — the canonical timeline JSON (document, versioned) — source of truth
  jobs       — async generation/render queue; resumable, observable

JSON columns use SQLAlchemy's portable JSON type so the same models run on Postgres
(prod/local docker) and SQLite (fast offline tests). The queue uses FOR UPDATE SKIP
LOCKED on Postgres and degrades to a guarded UPDATE on SQLite.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import JSON, Float, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from recut.core.config import get_settings


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _now() -> float:
    return time.time()


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uid("p"))
    name: Mapped[str] = mapped_column(String, default="Untitled project")
    stage: Mapped[int] = mapped_column(Integer, default=0)
    tone: Mapped[str] = mapped_column(String, default="#5B3DF5")
    token_cap: Mapped[int] = mapped_column(Integer, default=200_000)
    created_at: Mapped[float] = mapped_column(Float, default=_now)
    updated_at: Mapped[float] = mapped_column(Float, default=_now, onupdate=_now)


class Asset(Base):
    __tablename__ = "assets"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uid("a"))
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String)  # reference|upload|generated|standin|export|audio
    storage_key: Mapped[str] = mapped_column(String)
    mime: Mapped[str] = mapped_column(String, default="application/octet-stream")
    duration_s: Mapped[float] = mapped_column(Float, default=0.0)
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    content_hash: Mapped[str] = mapped_column(String, default="")
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[float] = mapped_column(Float, default=_now)


class RecipeRow(Base):
    __tablename__ = "recipes"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uid("rcp"))
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id"), nullable=True)
    source_asset_id: Mapped[str | None] = mapped_column(String, nullable=True)
    name: Mapped[str] = mapped_column(String, default="Untitled recipe")
    saved: Mapped[int] = mapped_column(Integer, default=0)  # recipe-library flag
    doc: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[float] = mapped_column(Float, default=_now)


class TimelineRow(Base):
    __tablename__ = "timelines"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uid("tl"))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    doc: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[float] = mapped_column(Float, default=_now)


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: _uid("job"))
    project_id: Mapped[str | None] = mapped_column(String, nullable=True)
    type: Mapped[str] = mapped_column(String)  # render_export|generate_broll|generate_voiceover|...
    status: Mapped[str] = mapped_column(String, default="queued")  # queued|running|done|failed
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str] = mapped_column(Text, default="")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[float] = mapped_column(Float, default=_now)
    updated_at: Mapped[float] = mapped_column(Float, default=_now, onupdate=_now)


_engine = None
_SessionLocal: sessionmaker | None = None


def get_engine():
    global _engine
    if _engine is None:
        url = get_settings().database_url
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        _engine = create_engine(url, future=True, connect_args=connect_args)
    return _engine


def reset_engine() -> None:
    """For tests that switch DATABASE_URL between modules."""
    global _engine, _SessionLocal
    _engine = None
    _SessionLocal = None


def init_db() -> None:
    Base.metadata.create_all(get_engine())


def get_sessionmaker() -> sessionmaker:
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=get_engine(), expire_on_commit=False, future=True)
    return _SessionLocal


@contextmanager
def session_scope() -> Iterator[Session]:
    s = get_sessionmaker()()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def dialect_name() -> str:
    return get_engine().dialect.name
