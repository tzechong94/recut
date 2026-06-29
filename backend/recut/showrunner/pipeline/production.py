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
    # LEAD with the medium/style so it dominates the render (image/video models weight the
    # first tokens heavily — burying "claymation" mid-prompt is why the look didn't land).
    bits = [prod.style.prompt_suffix()]
    bits.append(shot.action.strip() or "a cinematic moment")
    bits.append(_TYPE_CUES.get(shot.shot_type, "medium shot"))
    bits.append(_CAMERA_CUES.get(shot.camera.value, "locked-off camera"))
    bits.append("vertical 9:16, high quality")
    return ", ".join(b for b in bits if b)


def build_keyframe_instruction(prod: Production, shot: Shot, *, has_plate: bool = False) -> str:
    """Instruction for the image-edit model: keep the character's identity but place them
    INTO the shot's location, doing the shot's action, in the show's style. The result is
    the i2v first frame, so the video already has the right world + look. When `has_plate`,
    a SECOND input image is the locked location plate, so we tell the model to reuse that
    exact set — that's what keeps the location consistent shot-to-shot."""
    loc = prod.location(shot.location_id) if shot.location_id else None
    action = shot.action.strip() or "present in the scene"
    framing = _TYPE_CUES.get(shot.shot_type, "medium shot")
    if has_plate:
        return (
            f"{prod.style.prompt_suffix()}. Image 1 is the CHARACTER; image 2 is the SET. "
            f"Place the exact character from image 1 into the exact set from image 2 — keep the "
            f"SAME face, hair, wardrobe and art style, AND keep the SAME location layout, colors "
            f"and props. The character is: {action}. {framing}."
        )
    parts = [
        f"{prod.style.prompt_suffix()}.",
        "Keep the SAME character (same face, hair, wardrobe, art style) but place them into a "
        "full scene with a detailed background — not a plain backdrop.",
    ]
    if loc:
        parts.append(f"Setting: {loc.name} — {loc.description}.")
    parts.append(f"The character is: {action}.")
    parts.append(f"Shot framing: {framing}.")
    return " ".join(parts)


@dataclass
class ShotRender:
    asset: GenAsset
    tool: str
    reference_url: str | None  # the locked still used for the critic comparison (identity)
    keyframe: GenAsset | None = None  # the composed character-in-scene still fed to i2v


def _identity_character(prod: Production, shot: Shot):
    """The character whose locked reference anchors this shot's identity (first in frame)."""
    for cid in shot.character_ids:
        c = prod.character(cid)
        if c and c.reference_url:
            return c
    return None


def reference_for_shot(prod: Production, shot: Shot) -> tuple[str | None, bool]:
    """The locked reference URL to seed i2v + check consistency against, and whether it's
    an IDENTITY reference (character/location → critic should verify) vs continuity.
    A character in frame wins (identity), else the location plate."""
    c = _identity_character(prod, shot)
    if c:
        return c.reference_url, True
    if shot.location_id:
        loc = prod.location(shot.location_id)
        if loc and loc.reference_url:
            return loc.reference_url, True
    return None, False


def generate_shot(
    models: ModelClients, prod: Production, shot: Shot, *, seed: int = 0, corrective: str = "",
    prev_frame_url: str | None = None,
) -> ShotRender:
    """Generate one shot via KEYFRAME-FIRST: for a character shot, compose a still that puts
    the locked character into the scene/location/action (qwen-image-edit), then animate THAT
    with image-to-video. `seed` varies per attempt so a re-roll is a real redraw; `corrective`
    is the critic's drift note fed back in. A location-only shot animates its plate; a pure
    establishing shot chains the previous frame, else text-to-video."""
    prompt = build_shot_prompt(prod, shot)
    if corrective:
        prompt += f". IMPORTANT continuity correction: {corrective}"

    char = _identity_character(prod, shot)
    if char:
        # 1) keyframe: same character, now IN the location + action + style. If the shot's
        # location has a locked plate, feed it as a 2nd image so the SAME set carries across
        # every shot (cross-shot consistency).
        loc = prod.location(shot.location_id) if shot.location_id else None
        plate_url = loc.reference_url if (loc and loc.reference_url) else None
        images = [char.reference_url, plate_url] if plate_url else char.reference_url
        instruction = build_keyframe_instruction(prod, shot, has_plate=bool(plate_url))
        if corrective:
            instruction += f" Correction from the consistency critic: {corrective}."
        try:
            keyframe = models.image.edit(images, instruction)
            kf_url = keyframe.url or char.reference_url  # stub has no hosted url → i2v ignores it
            # 2) animate the composed keyframe; critic still checks identity vs the LOCKED ref
            asset = models.video.generate_from_image(kf_url, prompt, duration_s=shot.duration_s, seed=seed)
            return ShotRender(asset=asset, tool="generate_shot_keyframe_i2v",
                              reference_url=char.reference_url, keyframe=keyframe)
        except Exception:  # noqa: BLE001 — edit model hiccup → fall back to plain i2v from the ref
            asset = models.video.generate_from_image(char.reference_url, prompt, duration_s=shot.duration_s, seed=seed)
            return ShotRender(asset=asset, tool="generate_shot_i2v", reference_url=char.reference_url)

    ref_url, is_identity = reference_for_shot(prod, shot)  # location plate (no character)
    if ref_url:
        asset = models.video.generate_from_image(ref_url, prompt, duration_s=shot.duration_s, seed=seed)
        return ShotRender(asset=asset, tool="generate_shot_i2v", reference_url=ref_url if is_identity else None)
    if prev_frame_url:
        asset = models.video.generate_from_image(prev_frame_url, prompt, duration_s=shot.duration_s, seed=seed)
        return ShotRender(asset=asset, tool="generate_shot_i2v_continuity", reference_url=None)
    asset = models.video.generate(prompt, duration_s=shot.duration_s, seed=seed)
    return ShotRender(asset=asset, tool="generate_shot_t2v", reference_url=None)


def should_reroll(score: float | None, *, threshold: float = 0.6, rerolls_done: int, max_rerolls: int = 1) -> bool:
    """Re-roll a drifted shot, but bounded so the critic can't burn the token budget."""
    if score is None:
        return False
    return score < threshold and rerolls_done < max_rerolls
