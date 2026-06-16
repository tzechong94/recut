"""Test harness — offline by default.

Forces SQLite + local filesystem storage + stub models so the whole suite runs with
no Postgres, no MinIO, no API keys. Integration tests that need ffmpeg are marked and
skip cleanly if ffmpeg is absent.
"""

from __future__ import annotations

import os
import tempfile

import pytest

# Configure env BEFORE importing recut modules that read settings.
_TMP = tempfile.mkdtemp(prefix="recut-test-")
os.environ["RECUT_DATABASE_URL"] = f"sqlite:///{_TMP}/test.db"
os.environ["RECUT_STORAGE_BACKEND"] = "local"
os.environ["RECUT_WORK_DIR"] = _TMP
os.environ["RECUT_MODEL_BACKEND"] = "stub"

from recut.core.config import get_settings  # noqa: E402
from recut.core import db  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_db():
    get_settings.cache_clear()
    db.reset_engine()
    # Truly fresh schema each test — drop then create, so rows (esp. queued jobs)
    # never leak across tests and pollute claim_next ordering.
    db.Base.metadata.drop_all(db.get_engine())
    db.init_db()
    yield
    db.reset_engine()


@pytest.fixture
def work_dir() -> str:
    return _TMP
