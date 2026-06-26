"""Casting — generate (or accept an uploaded) reference still per character/location.

The reference is the consistency anchor: every shot featuring a character is animated
from its locked reference via i2v, so the character looks the same across the film. The
style-lock is baked into the reference prompt, so the whole cast shares one look.
"""

from __future__ import annotations

from recut.core.models import GenAsset, ModelClients
from recut.showrunner.schemas import Character, Location, StyleLock


def character_reference_prompt(char: Character, style: StyleLock) -> str:
    return (
        f"Character reference portrait of {char.name}: {char.description}. "
        f"{style.prompt_suffix()}. Full figure, neutral plain background, consistent "
        f"character design sheet, sharp, well-lit."
    )


def location_reference_prompt(loc: Location, style: StyleLock) -> str:
    return (
        f"Establishing location plate: {loc.description}. {style.prompt_suffix()}. "
        f"No people, wide empty set, consistent art direction."
    )


def generate_character_reference(models: ModelClients, char: Character, style: StyleLock) -> GenAsset:
    return models.image.generate(character_reference_prompt(char, style), width=720, height=1280)


def generate_location_reference(models: ModelClients, loc: Location, style: StyleLock) -> GenAsset:
    return models.image.generate(location_reference_prompt(loc, style), width=1280, height=720)
