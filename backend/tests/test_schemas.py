from recut.core.schemas import (
    Beat,
    Recipe,
    Slot,
    SlotSource,
    SlotType,
    TextRole,
    Timeline,
)


def test_recipe_recomputes_starts_and_duration():
    r = Recipe(
        beats=[
            Beat(index=0, label="Hook", slot_type=SlotType.text, duration_s=3),
            Beat(index=0, label="Setup", slot_type=SlotType.talk, duration_s=4),
            Beat(index=0, label="CTA", slot_type=SlotType.text, duration_s=2),
        ]
    )
    assert [b.start_s for b in r.beats] == [0.0, 3.0, 7.0]
    assert [b.index for b in r.beats] == [0, 1, 2]
    assert r.duration_s == 9.0
    assert r.shot_count == 3


def test_recipe_coerces_reserved_slot_types_to_v1():
    r = Recipe(beats=[Beat(index=0, label="x", slot_type=SlotType.illus, duration_s=2)])
    assert r.beats[0].slot_type == SlotType.broll  # illus (auto) -> broll
    r2 = Recipe(beats=[Beat(index=0, label="x", slot_type=SlotType.face, duration_s=2)])
    assert r2.beats[0].slot_type == SlotType.talk  # face (you) -> talk


def test_slot_with_asset_becomes_user_upload():
    s = Slot(type=SlotType.roll, duration_s=3, asset_id="a_123")
    assert s.source == SlotSource.user_upload
    assert s.is_real_footage


def test_timeline_orders_slots_and_sums_duration():
    tl = Timeline(
        slots=[
            Slot(type=SlotType.text, duration_s=3, text_role=TextRole.on_screen_text),
            Slot(type=SlotType.talk, duration_s=5, text_role=TextRole.voiceover),
        ]
    )
    assert [s.order for s in tl.slots] == [0, 1]
    assert tl.duration_s == 8.0


def test_round_trips_through_json():
    r = Recipe(beats=[Beat(index=0, label="Hook", slot_type=SlotType.text, duration_s=3)])
    again = Recipe.model_validate_json(r.model_dump_json())
    assert again.duration_s == r.duration_s
    assert again.beats[0].label == "Hook"
