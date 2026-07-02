"""Casting — generate (or accept an uploaded) reference still per character/location.

The reference is the consistency anchor: every shot featuring a character is animated
from its locked reference via i2v, so the character looks the same across the film. The
style-lock is baked into the reference prompt, so the whole cast shares one look.
"""

from __future__ import annotations

from recut.core.models import GenAsset, ModelClients
from recut.showrunner.schemas import Character, Location, StyleLock


def character_reference_prompt(char: Character, style: StyleLock, instruction: str = "") -> str:
    # LEAD with the medium so the style actually lands (claymation reads as clay, not a
    # realistic render). Avoid "portrait / design sheet / sharp, well-lit" — those pull the
    # model toward photoreal. `instruction` is the user's regenerate note ("older, red scarf").
    extra = f" {instruction.strip()}." if instruction.strip() else ""
    return (
        f"{style.prompt_suffix()}. A full-body character reference of {char.name}: "
        f"{char.description}.{extra} Standing against a plain neutral backdrop, even soft "
        f"lighting, consistent character design."
    )


def location_reference_prompt(loc: Location, style: StyleLock, instruction: str = "") -> str:
    extra = f" {instruction.strip()}." if instruction.strip() else ""
    return (
        f"{style.prompt_suffix()}. Establishing location plate: {loc.description}.{extra} "
        f"No people, wide empty set, consistent art direction."
    )


_ANCHOR_MATCH = (
    "Match the EXACT art style, medium, rendering technique, line quality, level of "
    "stylization and palette of this reference image — but the SUBJECT MUST BE A "
    "COMPLETELY DIFFERENT PERSON: different face shape, different hair color AND "
    "hairstyle, different wardrobe colors and garments. Copy ONLY the art style, "
    "never the person, outfit or accessories."
)


def generate_character_reference(
    models: ModelClients, char: Character, style: StyleLock, instruction: str = "",
    anchor_url: str | None = None,
) -> GenAsset:
    """With `anchor_url`, the new reference is DERIVED from an existing image (the custom
    style ref or the first cast member) via image-edit — same rendering, new subject —
    so the whole bible shares one look instead of each t2i rolling its own style."""
    if anchor_url:
        extra = f" {instruction.strip()}." if instruction.strip() else ""
        return models.image.edit(
            anchor_url,
            f"{_ANCHOR_MATCH} New subject: a full-body character reference of {char.name}: "
            f"{char.description}.{extra} Standing against a plain neutral backdrop, even soft "
            f"lighting, vertical composition.",
        )
    return models.image.generate(character_reference_prompt(char, style, instruction), width=720, height=1280)


def generate_location_reference(
    models: ModelClients, loc: Location, style: StyleLock, instruction: str = "",
    anchor_url: str | None = None,
) -> GenAsset:
    if anchor_url:
        extra = f" {instruction.strip()}." if instruction.strip() else ""
        return models.image.edit(
            anchor_url,
            f"{_ANCHOR_MATCH} New subject: an establishing location plate, NO people: "
            f"{loc.description}.{extra} Wide empty set, consistent art direction.",
        )
    return models.image.generate(location_reference_prompt(loc, style, instruction), width=1280, height=720)
