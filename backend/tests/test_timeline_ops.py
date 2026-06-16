from recut.core.schemas import Beat, Recipe, SlotSource, SlotType, TextRole
from recut.core.timeline_ops import (
    attach_upload,
    base_cut_from_recipe,
    mark_generated,
    recompute_ledger,
    slots_needing_creator,
    slots_to_generate,
)


def _recipe() -> Recipe:
    return Recipe(
        beats=[
            Beat(index=0, label="Hook", slot_type=SlotType.text, duration_s=3, text_role=TextRole.on_screen_text, on_screen_text="Saved 60%"),
            Beat(index=0, label="Setup", slot_type=SlotType.talk, duration_s=4),
            Beat(index=0, label="Cut", slot_type=SlotType.roll, duration_s=3),
            Beat(index=0, label="B", slot_type=SlotType.broll, duration_s=3),
        ]
    )


def test_base_cut_all_standins_plays_end_to_end():
    tl = base_cut_from_recipe(_recipe(), project_id="p1")
    assert len(tl.slots) == 4
    assert all(s.source == SlotSource.standin for s in tl.slots)
    assert tl.duration_s == 13.0
    # the text card carried its on-screen text from the recipe
    assert tl.slots[0].text == "Saved 60%"


def test_ledger_starts_all_standin():
    tl = base_cut_from_recipe(_recipe())
    led = tl.token_ledger
    assert led.standin_s == 13.0
    assert led.real_footage_s == 0.0
    assert led.real_footage_share == 0.0
    # naive baseline = cost of generating the WHOLE thing
    assert led.naive_baseline_tokens > 0


def test_attach_upload_moves_seconds_to_real_footage():
    tl = base_cut_from_recipe(_recipe())
    talk = tl.slots[1]
    attach_upload(tl, talk.id, "a_upload")
    led = tl.token_ledger
    assert led.real_footage_s == 4.0
    assert round(led.real_footage_share, 4) == round(4.0 / 13.0, 4)


def test_slots_needing_creator_are_you_standins():
    tl = base_cut_from_recipe(_recipe())
    need = slots_needing_creator(tl)
    assert {s.type for s in need} == {SlotType.talk, SlotType.roll}
    attach_upload(tl, need[0].id, "a1")
    assert len(slots_needing_creator(tl)) == 1


def test_slots_to_generate_only_kept_auto():
    tl = base_cut_from_recipe(_recipe())
    gen = slots_to_generate(tl)
    # text + broll are auto and kept by default
    assert {s.type for s in gen} == {SlotType.text, SlotType.broll}
    # drop the broll -> only text remains to generate
    for s in tl.slots:
        if s.type == SlotType.broll:
            s.kept = False
    assert {s.type for s in slots_to_generate(tl)} == {SlotType.text}


def test_mark_generated_accrues_tokens_and_seconds():
    tl = base_cut_from_recipe(_recipe())
    broll = next(s for s in tl.slots if s.type == SlotType.broll)
    mark_generated(tl, broll.id, "a_gen", tool="generate_broll", tokens=5400)
    led = tl.token_ledger
    assert led.generated_s == 3.0
    assert led.tokens_spent == 5400
    assert led.tokens_saved == led.naive_baseline_tokens - 5400


def test_recompute_is_idempotent():
    tl = base_cut_from_recipe(_recipe())
    a = recompute_ledger(tl).model_dump()
    b = recompute_ledger(tl).model_dump()
    assert a == b
