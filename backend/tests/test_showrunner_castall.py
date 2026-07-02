"""Anchored casting — one look for the whole show bible.

cast_all generates every reference DERIVED from one anchor (the custom style's image,
an uploaded face, or the first generated cast member) via image-edit: same rendering,
new subject. Individual regenerates anchor to the existing look too, so no single card
can drift the style (the huge-eyes-on-one-character problem).
"""

from __future__ import annotations

from recut.core import queue, repo
from recut.core.models import get_models
from recut.showrunner.pipeline.writers_room import develop_treatment
from recut.showrunner.schemas import AssetSource, StyleLock
from recut.worker.main import process_once
from recut.worker.registry import build_context


def _seed(style_refs: list[str] | None = None):
    p = develop_treatment(get_models().text, "a magician's assistant plans her own act",
                          target_seconds=20, style_name="pixar")
    if style_refs:
        p.style = StyleLock(name="custom", descriptors="hand-painted gouache", reference_urls=style_refs)
    p.project_id = repo.create_project(name="film")["id"]
    repo.save_production(p)
    return p


def _record_edits(ctx):
    calls: list[tuple[object, str]] = []
    orig = ctx.models.image.edit

    def rec(images, instruction):
        calls.append((images, instruction))
        return orig(images[0] if isinstance(images, list) else images, instruction)

    ctx.models.image.edit = rec
    return calls


def test_cast_all_locks_everything_in_one_anchored_look():
    p = _seed()
    ctx = build_context()
    calls = _record_edits(ctx)
    queue.enqueue("cast_all", {"production_id": p.id}, project_id=p.project_id)
    process_once(ctx)
    updated = repo.get_production(p.id)
    assert all(c.reference_url and c.locked for c in updated.characters)
    assert all(l.reference_url and l.locked for l in updated.locations)
    assert all(c.identity_notes for c in updated.characters)  # anchors named
    # first character was t2i (the anchor); EVERYONE else derived from it via edit
    n_others = (len(updated.characters) - 1) + len(updated.locations)
    assert len(calls) == n_others
    anchor_url = updated.characters[0].reference_url
    assert all(images == anchor_url for images, _ in calls)
    assert all("COMPLETELY DIFFERENT" in instr for _, instr in calls)


def test_cast_all_custom_style_image_anchors_everyone():
    p = _seed(style_refs=["https://example.com/moodboard.png"])
    ctx = build_context()
    calls = _record_edits(ctx)
    queue.enqueue("cast_all", {"production_id": p.id}, project_id=p.project_id)
    process_once(ctx)
    updated = repo.get_production(p.id)
    assert all(c.reference_url for c in updated.characters)
    # every single reference (including the first character) matched the style image
    assert len(calls) == len(updated.characters) + len(updated.locations)
    assert all(images == "https://example.com/moodboard.png" for images, _ in calls)


def test_cast_all_never_overwrites_an_uploaded_face():
    p = _seed()
    p.characters[0].reference_url = "https://example.com/my-face.png"
    p.characters[0].source = AssetSource.uploaded
    p.characters[0].locked = True
    repo.save_production(p)
    ctx = build_context()
    calls = _record_edits(ctx)
    queue.enqueue("cast_all", {"production_id": p.id}, project_id=p.project_id)
    process_once(ctx)
    updated = repo.get_production(p.id)
    assert updated.characters[0].reference_url == "https://example.com/my-face.png"  # untouched
    # and the human's upload became the anchor for everyone else
    assert calls and all(images == "https://example.com/my-face.png" for images, _ in calls)


def test_individual_regenerate_anchors_to_the_existing_look():
    p = _seed()
    p.characters[0].reference_url = "https://example.com/first.png"
    p.characters[0].locked = True
    repo.save_production(p)
    other = p.characters[1].id
    ctx = build_context()
    calls = _record_edits(ctx)
    queue.enqueue("cast_reference", {"production_id": p.id, "target": "character", "target_id": other})
    process_once(ctx)
    assert calls and calls[0][0] == "https://example.com/first.png"  # anchored, not a fresh t2i
    # regenerating the anchor character itself must NOT anchor to its own old image
    calls.clear()
    queue.enqueue("cast_reference", {"production_id": p.id, "target": "character",
                                     "target_id": p.characters[0].id})
    process_once(ctx)
    if calls:  # anchored to some OTHER locked ref, never itself
        assert calls[0][0] != "https://example.com/first.png"
