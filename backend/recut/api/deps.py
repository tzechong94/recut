"""Shared API dependencies."""

from __future__ import annotations

from functools import lru_cache

from recut.core.config import get_settings
from recut.core.models import get_models
from recut.core.storage import get_storage


@lru_cache
def storage():
    return get_storage(get_settings())


@lru_cache
def models():
    return get_models(get_settings())


def settings():
    return get_settings()
