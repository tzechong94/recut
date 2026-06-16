"""Anti-drift keystone test.

The render (Python) and the live preview (React) both derive caption geometry from
shared/caption-style.json. This test pins the invariants that make them agree:

  canvas_px == preview_px * scale_factor   (for every size)

If someone edits the spec and breaks that ratio, preview and export drift and THIS
test fails loudly before a caption ever lands in the wrong place in an export.
The web side has a mirror test (web/src/preview/captionStyle.test.ts) reading the
same file.
"""

import math

from recut.core.caption import compute_geometry, load_spec, preview_px, scale_factor
from recut.core.schemas import Align, Font, Size, SlotStyle, TextRole


def test_canvas_px_equals_preview_px_times_scale():
    sf = scale_factor()
    for size in Size:
        assert math.isclose(
            load_spec()["sizes"][size.value]["canvas_px"], preview_px(size) * sf
        ), f"caption drift on size={size.value}"


def test_align_maps_to_libass_codes():
    spec = load_spec()
    # lower-third caption uses bottom row libass codes 1/2/3
    g_left = compute_geometry(SlotStyle(align=Align.left), is_text_card=False)
    g_center = compute_geometry(SlotStyle(align=Align.center), is_text_card=False)
    g_right = compute_geometry(SlotStyle(align=Align.right), is_text_card=False)
    assert (g_left.ass_alignment, g_center.ass_alignment, g_right.ass_alignment) == (1, 2, 3)
    assert spec["align_map"]["center"]["css"] == "center"


def test_text_card_is_vertically_centered():
    # text cards center vertically -> libass middle row (+3): center align -> 5
    g = compute_geometry(SlotStyle(align=Align.center), is_text_card=True, text_role=TextRole.on_screen_text)
    assert g.ass_alignment == 5
    assert g.y_frac == 0.5


def test_font_family_resolves_and_falls_back():
    g = compute_geometry(SlotStyle(font=Font.display), is_text_card=True)
    assert g.font_family == "Bricolage Grotesque"
    assert g.font_px == preview_px(Size.m) * scale_factor()


def test_caption_uses_lower_third():
    g = compute_geometry(SlotStyle(), is_text_card=False)
    assert g.y_frac > 0.5  # lower third, not centered
