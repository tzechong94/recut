"""Importing this package registers all job handlers.

Each lane adds its handler module import here. Keep imports side-effect-only
(the @register decorator does the work)."""

from recut.worker.handlers import render  # noqa: F401

try:  # Lane D adds these; tolerate absence during early phases.
    from recut.worker.handlers import generate  # noqa: F401
except ImportError:
    pass
