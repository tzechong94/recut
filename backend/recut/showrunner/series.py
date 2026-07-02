"""Serialized micro-drama — greenlight the NEXT EPISODE from a finished film.

The vertical short-drama format is episodic: every episode ends on a cliffhanger and the
next one picks it up. continue_series has the writers' room write that continuation, then
carries the previous episode's LOCKED cast + location references across (matched by
name), so identity consistency is free in episode 2 — no re-casting, no extra image
tokens, the same faces in the same world.
"""

from __future__ import annotations

from recut.core.models import TextLLM
from recut.showrunner.pipeline.writers_room import develop_treatment
from recut.showrunner.schemas import Production


def _series_premise(prev: Production, episode: int) -> str:
    cliff = prev.scenes[-1].summary if prev.scenes else prev.logline
    cast = ", ".join(f"{c.name} ({c.description})" for c in prev.characters) or "none"
    sets_ = ", ".join(l.name for l in prev.locations) or "none"
    return (
        f"EPISODE {episode} of the vertical micro-drama serial '{prev.title}'. "
        f"Previous episode: {prev.logline} It ended on this cliffhanger: {cliff} "
        f"Pick up EXACTLY there, escalate hard, and end on a NEW cliffhanger. "
        f"RETURNING CAST — reuse these exact names and appearances: {cast}. "
        f"RETURNING LOCATIONS — prefer these sets: {sets_}."
    )


def continue_series(llm: TextLLM, prev: Production) -> Production:
    """Write episode N+1 as a fresh Production linked to `prev`, with the locked look
    (style, cast references, location plates) carried over by name."""
    episode = prev.episode + 1
    prod = develop_treatment(
        llm, _series_premise(prev, episode), target_seconds=prev.target_seconds,
        style_name=prev.style.name, project_id=prev.project_id,
    )
    prod.episode = episode
    prod.previous_production_id = prev.id
    prod.style = prev.style.model_copy()  # the exact lock, including any human tweaks

    for c in prod.characters:
        old = next((o for o in prev.characters
                    if o.name.strip().lower() == c.name.strip().lower()), None)
        if old and old.reference_url:
            c.reference_asset_id = old.reference_asset_id
            c.reference_url = old.reference_url
            c.source = old.source
            c.locked = True
            c.voice = old.voice
            c.description = old.description or c.description  # the LOOK is canon now
    for loc in prod.locations:
        old = next((o for o in prev.locations
                    if o.name.strip().lower() == loc.name.strip().lower()), None)
        if old and old.reference_url:
            loc.reference_asset_id = old.reference_asset_id
            loc.reference_url = old.reference_url
            loc.source = old.source
            loc.locked = True
            loc.description = old.description or loc.description
    return prod
