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


def build_keyframe_instruction(prod: Production, shot: Shot, *, has_plate: bool = False,
                               has_style_ref: bool = False) -> str:
    """Instruction for the image-edit model: keep the character's identity but place them
    INTO the shot's location, doing the shot's action, in the show's style. The result is
    the i2v first frame, so the video already has the right world + look. When `has_plate`,
    a SECOND input image is the locked location plate, so we tell the model to reuse that
    exact set — that's what keeps the location consistent shot-to-shot. When
    `has_style_ref`, the LAST input image is a custom-style reference: the look comes from
    that image itself, not just words."""
    loc = prod.location(shot.location_id) if shot.location_id else None
    action = shot.action.strip() or "present in the scene"
    framing = _TYPE_CUES.get(shot.shot_type, "medium shot")
    style_clause = (
        " The FINAL input image is a STYLE reference — match its medium, texture, lighting "
        "and palette exactly (its subject does not matter)." if has_style_ref else ""
    )
    if has_plate:
        return (
            f"{prod.style.prompt_suffix()}. Image 1 is the CHARACTER; image 2 is the SET. "
            f"Place the exact character from image 1 into the exact set from image 2 — keep the "
            f"SAME face, hair, wardrobe and art style, AND keep the SAME location layout, colors "
            f"and props. The character is: {action}. {framing}.{style_clause}"
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
    return " ".join(parts) + style_clause


def still_signature(shot: Shot) -> str:
    """Signature of the fields a board still is composed FROM. Stored on the shot when
    the still is made; if the live fields no longer match, the still is stale and the
    UI flags it — the human never approves a board that lies about the film.
    (Mirrored client-side in Storyboard.tsx — keep the format in sync.)"""
    return "|".join([
        shot.action.strip(),
        shot.shot_type.value,
        ",".join(sorted(shot.character_ids)),
        shot.location_id or "",
    ])


def style_anchor_url(prod: Production) -> str | None:
    """A hosted custom-style reference image, if the production has one. Only http(s)
    URLs can be fetched by the edit model; a local-only ref still styles via words."""
    return next((u for u in prod.style.reference_urls if u.startswith("http")), None)


def compose_shot_still(models: ModelClients, prod: Production, shot: Shot, *, instruction: str = "") -> GenAsset:
    """The BOARD STILL: the exact first frame the film will animate for this shot.
    A character shot composes the locked reference into the (locked) location; a
    location-only shot redresses the plate for the action; a shot with neither is plain
    text-to-image. A custom style's reference image rides along as the LAST input so the
    look is anchored to a real image. `instruction` is the human's steering note."""
    note = f" Note from the director: {instruction.strip()}." if instruction.strip() else ""
    style_ref = style_anchor_url(prod)
    char = _identity_character(prod, shot)
    loc = prod.location(shot.location_id) if shot.location_id else None
    plate_url = loc.reference_url if (loc and loc.reference_url) else None
    if char:
        images = [char.reference_url] + ([plate_url] if plate_url else []) + ([style_ref] if style_ref else [])
        instr = build_keyframe_instruction(prod, shot, has_plate=bool(plate_url), has_style_ref=bool(style_ref))
        return models.image.edit(images if len(images) > 1 else images[0], instr + note)
    if plate_url:
        framing = _TYPE_CUES.get(shot.shot_type, "medium shot")
        style_clause = (" The FINAL input image is a STYLE reference — match its medium, texture "
                        "and palette exactly." if style_ref else "")
        images = [plate_url] + ([style_ref] if style_ref else [])
        return models.image.edit(
            images if len(images) > 1 else images[0],
            f"{prod.style.prompt_suffix()}. Keep this EXACT location — same layout, colors and "
            f"props. Show: {shot.action.strip() or 'the empty set'}. {framing}.{style_clause}{note}",
        )
    if style_ref:
        return models.image.edit(
            style_ref,
            f"{prod.style.prompt_suffix()}. This image is a STYLE reference — keep its medium, "
            f"texture and palette but replace the subject entirely with: "
            f"{shot.action.strip() or 'an establishing scene'}. "
            f"{_TYPE_CUES.get(shot.shot_type, 'medium shot')}, vertical 9:16.{note}",
        )
    return models.image.generate(build_shot_prompt(prod, shot) + note, width=720, height=1280)


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

    if shot.keyframe_url:
        # The human approved this exact still on the shot board — animate IT, never
        # recompose. Re-rolls vary the seed/prompt only; the approved frame is sacred.
        try:
            asset = models.video.generate_from_image(shot.keyframe_url, prompt, duration_s=shot.duration_s, seed=seed)
            anchor = _identity_character(prod, shot)
            return ShotRender(asset=asset, tool="generate_shot_board_i2v",
                              reference_url=anchor.reference_url if anchor else shot.keyframe_url)
        except Exception:  # noqa: BLE001 — provider still URLs expire (~24h); recompose below
            pass

    char = _identity_character(prod, shot)
    if char:
        # 1) keyframe: same character, now IN the location + action + style (and anchored
        # to the custom-style reference image when there is one) — compose_shot_still is
        # the single composition path for board AND produce time.
        try:
            keyframe = compose_shot_still(
                models, prod, shot,
                instruction=(f"Correction from the consistency critic: {corrective}" if corrective else ""),
            )
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
