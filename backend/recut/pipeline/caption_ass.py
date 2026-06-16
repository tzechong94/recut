"""Generate ASS subtitles for a slot's caption/text-card, using the SAME geometry
the React preview uses (recut.core.caption -> shared/caption-style.json).

libass alignment (\\an): 1-3 bottom row, 4-6 middle row, 7-9 top row, where the
middle column is 2/5/8. compute_geometry already returns these codes.
"""

from __future__ import annotations

from recut.core.caption import CaptionGeometry, compute_geometry
from recut.core.schemas import Slot, SlotType, TextRole


def _ass_color(hex_color: str) -> str:
    """#RRGGBB -> ASS &H00BBGGRR (opaque)."""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H00{b}{g}{r}".upper()


def _ts(seconds: float) -> str:
    cs = int(round(seconds * 100))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, c = divmod(rem, 100)
    return f"{h:d}:{m:02d}:{s:02d}.{c:02d}"


def _margin_v(geo: CaptionGeometry) -> int:
    # For bottom alignments, MarginV is distance up from the bottom edge.
    # For top alignments, distance down from the top. Middle ignores it.
    if geo.ass_alignment in (1, 2, 3):  # bottom row
        return int((1.0 - geo.y_frac) * geo.canvas_h)
    if geo.ass_alignment in (7, 8, 9):  # top row
        return int(geo.y_frac * geo.canvas_h)
    return 0


def build_ass(slot: Slot, *, end_s: float | None = None, spec: dict | None = None) -> str:
    """Return a complete ASS document for one slot caption (start 0 .. duration)."""
    is_text_card = slot.type == SlotType.text
    geo = compute_geometry(
        slot.style, is_text_card=is_text_card, text_role=slot.text_role, spec=spec
    )
    end = end_s if end_s is not None else slot.duration_s
    text = (slot.text or "").replace("\n", "\\N")
    margin_v = _margin_v(geo)
    side_margin = int(geo.canvas_w * 0.07)

    primary = _ass_color(geo.fill)
    outline = _ass_color(geo.stroke)

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {geo.canvas_w}
PlayResY: {geo.canvas_h}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{geo.font_family},{geo.font_px},{primary},{outline},&H64000000,{1 if geo.font_weight >= 700 else 0},0,0,0,100,100,0,0,1,{geo.stroke_px},2,{geo.ass_alignment},{side_margin},{side_margin},{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,{_ts(0)},{_ts(end)},Cap,,0,0,0,,{text}
"""
    return header
