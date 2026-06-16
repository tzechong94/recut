from recut.core.schemas import Align, Font, Size, Slot, SlotStyle, SlotType, TextRole
from recut.pipeline.caption_ass import _ass_color, _ts, build_ass


def test_ass_color_rgb_to_bgr():
    assert _ass_color("#FFFFFF") == "&H00FFFFFF"
    assert _ass_color("#FF0000") == "&H000000FF"  # red -> BBGGRR


def test_timestamp_format():
    assert _ts(0) == "0:00:00.00"
    assert _ts(3) == "0:00:03.00"
    assert _ts(65.5) == "0:01:05.50"


def test_build_ass_text_card_centered():
    slot = Slot(
        type=SlotType.text, duration_s=3, text="I saved 60% on marble.",
        text_role=TextRole.on_screen_text, style=SlotStyle(font=Font.display, size=Size.l, align=Align.center),
    )
    ass = build_ass(slot)
    assert "PlayResX: 1080" in ass and "PlayResY: 1920" in ass
    assert "Bricolage Grotesque" in ass
    assert "I saved 60% on marble." in ass
    assert "0:00:00.00,0:00:03.00" in ass
    # centered text card -> libass alignment 5 (middle-center)
    assert ",5," in ass


def test_build_ass_caption_lower_third_left():
    slot = Slot(
        type=SlotType.roll, duration_s=2, text="Walking the floor",
        text_role=TextRole.voiceover, style=SlotStyle(align=Align.left),
    )
    ass = build_ass(slot)
    # bottom-left alignment is libass 1
    assert "Walking the floor" in ass
    assert ",1," in ass


def test_newlines_become_ass_breaks():
    slot = Slot(type=SlotType.text, duration_s=2, text="line one\nline two")
    ass = build_ass(slot)
    assert "line one\\Nline two" in ass
