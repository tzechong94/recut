"""Production — generate a shot's video, the consistency-critic centerpiece.

A shot featuring a cast member is animated from that character's LOCKED reference still
via image-to-video (consistency). A shot with only a location uses the location plate;
a pure establishing shot with neither falls back to text-to-video. After generation the
consistency critic (Qwen-VL) scores the result against the reference and the worker
re-rolls if it drifts.
"""

from __future__ import annotations

from dataclasses import dataclass

from recut.core.models import GenAsset, ModelClients
from recut.showrunner.schemas import Production, Shot, ShotType

_CAMERA_CUES = {
    "static": "locked-off camera",
    "pan": "slow panning camera",
    "push_in": "slow push-in",
    "pull_out": "slow pull-out",
    "handheld": "handheld camera",
    "aerial": "aerial drone shot",
}
_TYPE_CUES = {
    ShotType.wide: "wide establishing shot",
    ShotType.medium: "medium shot",
    ShotType.close: "close-up",
    ShotType.insert: "insert detail shot",
    ShotType.two_shot: "two-shot",
}


def build_shot_prompt(prod: Production, shot: Shot) -> str:
    bits = [shot.action.strip() or "a cinematic moment"]
    bits.append(_TYPE_CUES.get(shot.shot_type, "medium shot"))
    bits.append(_CAMERA_CUES.get(shot.camera.value, "locked-off camera"))
    bits.append(prod.style.prompt_suffix())
    bits.append("vertical 9:16, high quality")
    return ", ".join(b for b in bits if b)


@dataclass
class ShotRender:
    asset: GenAsset
    tool: str
    reference_url: str | None  # the still used for i2v + the critic comparison


def reference_for_shot(prod: Production, shot: Shot) -> str | None:
    """The locked reference URL to seed i2v + check consistency against: a character in
    frame first, else the location."""
    for cid in shot.character_ids:
        c = prod.character(cid)
        if c and c.reference_url:
            return c.reference_url
    if shot.location_id:
        loc = prod.location(shot.location_id)
        if loc and loc.reference_url:
            return loc.reference_url
    return None


def generate_shot(models: ModelClients, prod: Production, shot: Shot) -> ShotRender:
    prompt = build_shot_prompt(prod, shot)
    ref_url = reference_for_shot(prod, shot)
    if ref_url:
        asset = models.video.generate_from_image(ref_url, prompt, duration_s=shot.duration_s)
        return ShotRender(asset=asset, tool="generate_shot_i2v", reference_url=ref_url)
    asset = models.video.generate(prompt, duration_s=shot.duration_s)
    return ShotRender(asset=asset, tool="generate_shot_t2v", reference_url=None)


def should_reroll(score: float | None, *, threshold: float = 0.6, rerolls_done: int, max_rerolls: int = 1) -> bool:
    """Re-roll a drifted shot, but bounded so the critic can't burn the token budget."""
    if score is None:
        return False
    return score < threshold and rerolls_done < max_rerolls
