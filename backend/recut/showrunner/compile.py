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


def shot_to_slot(shot: Shot, *, style_name: str = "") -> Slot:
    caption = shot.caption
    return Slot(
        id=shot.id,  # keep the shot id so render cache + lookups line up
        beat_label=f"Shot {shot.index + 1}",
        type=SlotType.broll,  # a drama shot is a video clip; render keys on the asset mime
        duration_s=shot.duration_s,
        source=_SOURCE_MAP.get(shot.source, SlotSource.standin),
        asset_id=shot.asset_id,
        text=caption,
        text_role=TextRole.on_screen_text if caption else TextRole.none,
        style=SlotStyle(font=Font.clean, size=Size.m, align=Align.center),
        status=_STATUS_MAP.get(shot.status, SlotStatus.ready),
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


def compile_to_timeline(prod: Production, *, with_cards: bool = True) -> Timeline:
    """Build the render Timeline from the production's ordered shots, framed by a title
    card and an end card so the export plays as a finished short film."""
    slots = [shot_to_slot(sh, style_name=prod.style.name) for sh in prod.shots]
    if with_cards and slots:
        title = prod.title or "Untitled"
        end_text = (prod.title or "An AI Showrunner film")  # reprise the title, not the theme label
        slots = (
            [_card_slot(f"title_{prod.id}", title, size=Size.l)]
            + slots
            + [_card_slot(f"end_{prod.id}", end_text, size=Size.m)]
        )
    tl = Timeline(timeline_id=f"tl_{prod.id}", project_id=prod.project_id, version=prod.version, slots=slots)
    return tl
