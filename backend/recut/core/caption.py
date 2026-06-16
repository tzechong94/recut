"""Caption geometry — the Python half of the anti-drift keystone.

Loads shared/caption-style.json (the SINGLE source of truth shared with the React
preview) and computes caption geometry for the render. The parity test asserts that
the numbers here match what the web preview computes, so a caption can never land in
a different place in the export than it did in the preview.
"""

from __future__ import annotations

import functools
import json
from dataclasses import dataclass
from pathlib import Path

from recut.core.schemas import Align, Font, Size, SlotStyle, TextRole

# shared/caption-style.json lives at repo root /shared. Resolve relative to this file:
# backend/recut/core/caption.py -> repo root is parents[3].
_DEFAULT_SPEC_PATH = Path(__file__).resolve().parents[3] / "shared" / "caption-style.json"


@functools.lru_cache(maxsize=4)
def load_spec(path: str | None = None) -> dict:
    p = Path(path) if path else _DEFAULT_SPEC_PATH
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


@dataclass(frozen=True)
class CaptionGeometry:
    """Resolved geometry for one caption/text-card on the full canvas."""

    canvas_w: int
    canvas_h: int
    font_family: str
    font_file: str
    font_weight: int
    font_px: int  # font size on the full canvas
    align_css: str
    ass_alignment: int  # libass \an code (1-9)
    fill: str
    stroke: str
    stroke_px: int
    x_frac: float
    y_frac: float
    max_width_px: int
    line_spacing: float


def _layout_key(text_role: TextRole, slot_type_is_text: bool) -> str:
    # Text cards use the centered "text_card" layout; everything else uses the
    # lower-third "caption" layout.
    return "text_card" if slot_type_is_text else "caption"


def compute_geometry(
    style: SlotStyle,
    *,
    is_text_card: bool,
    text_role: TextRole = TextRole.none,
    spec: dict | None = None,
) -> CaptionGeometry:
    s = spec or load_spec()
    canvas = s["canvas"]
    font_def = s["fonts"].get(style.font.value, s["fonts"][s["fallback_font"]])
    size_def = s["sizes"][style.size.value]
    align_def = s["align_map"][style.align.value]
    layout = s["layout"][_layout_key(text_role, is_text_card)]
    colors = s["colors"]

    # Vertical anchor row for libass: base codes 1-3 are the BOTTOM row.
    # +3 -> middle row, +6 -> top row.
    vertical = layout["vertical"]
    base = align_def["ass"]
    if vertical == "center":
        ass_alignment = base + 3
        y_frac = 0.5
    elif vertical == "top":
        ass_alignment = base + 6
        y_frac = layout.get("y_frac", 0.1)
    else:  # lower_third / bottom
        ass_alignment = base
        y_frac = layout.get("lower_third_y_frac", 0.72)

    max_width_px = int(canvas["width"] * layout["max_width_frac"])

    return CaptionGeometry(
        canvas_w=canvas["width"],
        canvas_h=canvas["height"],
        font_family=font_def["family"],
        font_file=font_def["file"],
        font_weight=font_def["weight"],
        font_px=int(size_def["canvas_px"]),
        align_css=align_def["css"],
        ass_alignment=ass_alignment,
        fill=colors["text_fill"],
        stroke=colors["text_stroke"],
        stroke_px=int(colors["stroke_width_canvas_px"]),
        x_frac=align_def["anchor_x_frac"],
        y_frac=y_frac,
        max_width_px=max_width_px,
        line_spacing=layout["line_spacing"],
    )


def preview_px(size: Size, spec: dict | None = None) -> int:
    """Font size the React preview should use at phone scale. Exposed so the
    parity test can assert canvas_px == preview_px * scale_factor."""
    s = spec or load_spec()
    return int(s["sizes"][size.value]["px"])


def scale_factor(spec: dict | None = None) -> float:
    s = spec or load_spec()
    return float(s["scale_factor"])
