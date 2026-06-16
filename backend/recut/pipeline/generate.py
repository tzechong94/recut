"""Generation gap-fill — Wan b-roll, Qwen-Image text cards, CosyVoice voiceover.

Discipline (the headline metric): generation is gap-fill only, deferred, async, and
runs ONLY for slots the creator KEEPS. Every project has a hard token cap; a slot that
would breach it is skipped with a visible reason, never silently.

These functions produce assets + token counts; the worker handler wires them to the
timeline (mark_generated) and the token ledger.
"""

from __future__ import annotations

from dataclasses import dataclass

from recut.core.models import ModelClients
from recut.core.schemas import Slot, SlotType
from recut.core.storage import Storage, content_hash


class TokenCapExceeded(RuntimeError):
    """Generating this slot would breach the project's token cap."""


@dataclass
class GeneratedAsset:
    storage_key: str
    mime: str
    duration_s: float
    width: int
    height: int
    tokens: int


def _store(storage: Storage, project_id: str | None, kind: str, data: bytes, ext: str, mime: str) -> str:
    key = f"projects/{project_id or 'p'}/generated/{kind}/{content_hash(data)}.{ext}"
    storage.put(key, data, content_type=mime)
    return key


def generate_for_slot(
    slot: Slot, *, models: ModelClients, storage: Storage, project_id: str | None,
    tokens_already_spent: int, token_cap: int,
) -> GeneratedAsset:
    """Generate the asset for one kept auto slot (b-roll video or text-card image).

    Enforces the token cap BEFORE spending: estimate, check, then generate."""
    prompt = (slot.generation.prompt if slot.generation else "") or slot.text or slot.beat_label

    if slot.type == SlotType.broll:
        est = int(slot.duration_s * 1800)
        _check_cap(tokens_already_spent, est, token_cap)
        asset = models.video.generate(prompt, duration_s=slot.duration_s)
        ext = "mp4" if asset.mime.startswith("video/") else "png"
        key = _store(storage, project_id, "broll", asset.data, ext, asset.mime)
        return GeneratedAsset(key, asset.mime, slot.duration_s, 1080, 1920, asset.tokens)

    if slot.type == SlotType.text:
        est = 250
        _check_cap(tokens_already_spent, est, token_cap)
        asset = models.image.generate(prompt, width=1080, height=1920)
        key = _store(storage, project_id, "textcard", asset.data, "png", asset.mime)
        return GeneratedAsset(key, asset.mime, slot.duration_s, 1080, 1920, asset.tokens)

    raise ValueError(f"slot type {slot.type} is not auto-generated")


def generate_voiceover_track(
    text: str, *, models: ModelClients, storage: Storage, project_id: str | None,
    tokens_already_spent: int, token_cap: int, voice: str = "default",
) -> GeneratedAsset:
    est = len(text)
    _check_cap(tokens_already_spent, est, token_cap)
    asset = models.voice.synthesize(text, voice=voice)
    ext = "wav" if asset.mime.endswith("wav") else "mp3"
    key = _store(storage, project_id, "voiceover", asset.data, ext, asset.mime)
    return GeneratedAsset(key, asset.mime, asset.duration_s, 0, 0, asset.tokens)


def _check_cap(spent: int, estimate: int, cap: int) -> None:
    if spent + estimate > cap:
        raise TokenCapExceeded(
            f"would spend {spent + estimate} tokens, cap is {cap}. Drop a generated slot or raise the cap."
        )
