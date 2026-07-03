from recut.core.schemas import SlotSource, SlotType
from recut.showrunner.compile import compile_to_timeline, shot_to_slot
from recut.showrunner.schemas import (
    AssetSource,
    Character,
    DialogueLine,
    Production,
    Scene,
    Shot,
    ShotStatus,
    STYLE_PRESETS,
    Stage,
    StyleLock,
    TokenLedger,
)


def _prod() -> Production:
    c = Character(name="Mara", description="a tired detective", voice="longxiaochun_v2")
    return Production(
        premise="a detective realizes her partner is the killer",
        style=STYLE_PRESETS["noir"].model_copy(),
        characters=[c],
        scenes=[
            Scene(heading="INT. OFFICE - NIGHT", summary="Mara finds the clue", shots=[
                Shot(action="Mara stares at a photo", character_ids=[c.id], duration_s=4,
                     dialogue=[DialogueLine(character_id=c.id, character_name="Mara", line="It was you.")]),
                Shot(action="close on the photo", duration_s=3, narration="The truth was here all along."),
            ]),
        ],
    )


def test_production_indexes_and_durations():
    p = _prod()
    assert p.scenes[0].index == 0
    assert [sh.index for sh in p.shots] == [0, 1]
    assert p.duration_s == 7.0
    assert p.stage == Stage.premise


def test_shot_caption_is_dialogue_only_and_name_free():
    """The caption is what the voice SPEAKS: never the speaker's name (TTS must not
    verbalize 'Mara:'), and narration is dead — a shot without a line is silent."""
    p = _prod()
    assert p.shots[0].caption == "It was you."
    assert p.shots[1].caption == ""  # narration-only -> silent beat


def test_style_preset_prompt_suffix():
    s = STYLE_PRESETS["noir"]
    assert "noir" in s.prompt_suffix().lower()
    assert s.name == "noir"


def test_character_lookup():
    p = _prod()
    cid = p.characters[0].id
    assert p.character(cid).name == "Mara"
    assert p.character("nope") is None


def test_compile_to_timeline_maps_shots_to_slots():
    p = _prod()
    # mark shot 0 generated, shot 1 still standin
    p.scenes[0].shots[0].source = AssetSource.generated
    p.scenes[0].shots[0].asset_id = "a_gen"
    p.scenes[0].shots[0].status = ShotStatus.ready
    tl = compile_to_timeline(p, with_cards=False)  # cards tested separately
    assert len(tl.slots) == 2
    assert tl.slots[0].id == p.shots[0].id  # shot id preserved for render cache
    assert tl.slots[0].source == SlotSource.generated and tl.slots[0].asset_id == "a_gen"
    assert tl.slots[0].text == "It was you."  # the line, name-free (lip-sync attributes)
    assert tl.slots[1].source == SlotSource.standin
    assert all(s.type == SlotType.broll for s in tl.slots)
    assert tl.duration_s == 7.0


def test_token_ledger_total_and_baseline():
    led = TokenLedger(text_tokens=1000, image_tokens=500, video_tokens=20000, voice_tokens=300)
    assert led.total == 21800
    # naive baseline (3x regen, no plan-lock) for 7 shots avg 4s is much higher
    assert led.naive_baseline(7, 4.0) > led.total
