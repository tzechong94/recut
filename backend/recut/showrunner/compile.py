"""Compile a Production into the existing render Timeline.

The drama domain (Production/Scene/Shot) is the creative model; the render Timeline
(recut.core.schemas) is the execution format the ffmpeg engine already understands. Each
Shot becomes one render Slot (a video clip + burned caption). The per-shot dialogue/
narration is assembled into the single voiceover track separately (see pipeline.assemble),
because shots play sequentially so a concatenated VO stays in sync.

This keeps the validated render engine (9:16, ASS captions, concat, audio mix, resumable)
unchanged — the pivot reuses the whole spine.
"""

from __future__ import annotations

from recut.core.schemas import (
    Align,
    Font,
    Size,
    Slot,
    SlotSource,
    SlotStatus,
    SlotStyle,
    SlotType,
    StandIn,
    TextRole,
    Timeline,
)
from recut.showrunner.schemas import AssetSource, Production, Shot, ShotStatus

_SOURCE_MAP = {
    AssetSource.generated: SlotSource.generated,
    AssetSource.uploaded: SlotSource.user_upload,
    AssetSource.standin: SlotSource.standin,
    AssetSource.none: SlotSource.standin,
}
_STATUS_MAP = {
    ShotStatus.ready: SlotStatus.ready,
    ShotStatus.generating: SlotStatus.generating,
    ShotStatus.failed: SlotStatus.failed,
    ShotStatus.standin: SlotStatus.ready,
    ShotStatus.planned: SlotStatus.ready,
}


def shot_to_slot(shot: Shot, *, style_name: str = "", stills: bool = False,
                 duration_override: float | None = None, burn_captions: bool = False) -> Slot:
    """One shot → one render slot. In STILLS mode (the animatic) the slot sources the
    shot's board still instead of its video take — the render's image path (-loop 1)
    plays it for the beat's duration; $0 video tokens. Captions burn only when the
    production opts in (the cast speaks the lines — text on the frame is optional)."""
    caption = shot.caption if burn_captions else ""
    if stills and shot.keyframe_asset_id:
        asset_id, source, status = shot.keyframe_asset_id, SlotSource.generated, SlotStatus.ready
    elif stills:
        asset_id, source, status = None, SlotSource.standin, SlotStatus.ready
    else:
        asset_id = shot.asset_id
        source = _SOURCE_MAP.get(shot.source, SlotSource.standin)
        status = _STATUS_MAP.get(shot.status, SlotStatus.ready)
    return Slot(
        id=shot.id,  # keep the shot id so render cache + lookups line up
        beat_label=f"Shot {shot.index + 1}",
        type=SlotType.broll,  # a drama shot is a video clip; render keys on the asset mime
        duration_s=duration_override if duration_override is not None else shot.duration_s,
        source=source,
        asset_id=asset_id,
        text=caption,
        text_role=TextRole.on_screen_text if caption else TextRole.none,
        # size S: a one-line subtitle in the lower third, never a wall over the frame
        style=SlotStyle(font=Font.clean, size=Size.s, align=Align.center),
        status=status,
        kept=True,
    )


def _card_slot(slot_id: str, text: str, *, size: Size, dur: float = 2.6) -> Slot:
    """A text card (title/end) — a stand-in text slot the render burns over a solid frame.
    Costs zero video tokens but makes the export read as a film, not a clip reel."""
    return Slot(
        id=slot_id, beat_label="Card", type=SlotType.text, duration_s=dur,
        source=SlotSource.standin, text=text, text_role=TextRole.on_screen_text,
        style=SlotStyle(font=Font.display, size=size, align=Align.center),
        status=SlotStatus.ready, kept=True,
        standin=StandIn(color="#000000", label=""),
    )


def compile_to_timeline(prod: Production, *, with_cards: bool = True, stills: bool = False,
                        duration_overrides: dict[str, float] | None = None) -> Timeline:
    """Build the render Timeline from the production's ordered shots, framed by a title
    card and an end card so the export plays as a finished short film. `stills` builds
    the ANIMATIC (board stills instead of video takes, $0 video); `duration_overrides`
    fits animatic beats to the voice job-locally without mutating the Production."""
    overrides = duration_overrides or {}
    burn = bool(getattr(prod, "burn_captions", False)) or stills  # the animatic keeps
    # captions: its stills don't lip-sync, so the text carries the read-along
    slots: list[Slot] = []
    for scene in prod.scenes:
        for i, sh in enumerate(scene.shots):
            slot = shot_to_slot(sh, style_name=prod.style.name, stills=stills,
                                duration_override=overrides.get(sh.id), burn_captions=burn)
            slot.fade_in = i == 0  # dip-from-black as each scene opens
            slot.fade_out = i == len(scene.shots) - 1  # dip-to-black as it closes
            slots.append(slot)
    if not slots:  # productions without scenes (e.g. tests) still compile
        slots = [shot_to_slot(sh, style_name=prod.style.name, stills=stills,
                              duration_override=overrides.get(sh.id), burn_captions=burn) for sh in prod.shots]
    if with_cards and slots:
        title = prod.title or "Untitled"
        end_text = (prod.title or "An AI Showrunner film")  # reprise the title, not the theme label
        title_card = _card_slot(f"title_{prod.id}", title, size=Size.l)
        title_card.fade_in = True
        end_card = _card_slot(f"end_{prod.id}", end_text, size=Size.m)
        end_card.fade_out = True
        slots = [title_card] + slots + [end_card]
    tl = Timeline(timeline_id=f"tl_{prod.id}", project_id=prod.project_id, version=prod.version, slots=slots)
    return tl
