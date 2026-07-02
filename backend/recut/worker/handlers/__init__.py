"""Importing this package registers all job handlers.

Each lane adds its handler module import here. Keep imports side-effect-only
(the @register decorator does the work)."""

from recut.worker.handlers import render  # noqa: F401

try:
    from recut.worker.handlers import generate  # noqa: F401  (legacy reel generation)
except ImportError:
    pass

from recut.worker.handlers import showrunner  # noqa: F401  (drama production)
