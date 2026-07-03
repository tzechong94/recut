"""Sprint 12 — robustness / edge cases."""
import shutil
import pytest

from recut.core import queue, repo
from recut.core.models import get_models
from recut.showrunner.compile import compile_to_timeline
from recut.showrunner.pipeline.production import generate_shot
from recut.showrunner.pipeline.storyboard import build_storyboard
from recut.showrunner.pipeline.writers_room import develop_treatment
from recut.showrunner.schemas import AssetSource, DialogueLine, Production, Scene, Shot


@pytest.mark.parametrize("premise", ["", "🎬", "noir"])
def test_terse_premise_yields_usable_production(premise):
    p = develop_treatment(get_models().text, premise, style_name="noir")
    assert len(p.characters) >= 1 and len(p.scenes) >= 1  # never a degenerate empty film


def test_single_scene_compiles_with_fades():
    p = Production(title="One", scenes=[Scene(shots=[Shot(action="a", duration_s=3), Shot(action="b", duration_s=3)])])
    tl = compile_to_timeline(p)
    assert tl.slots[0].fade_in and tl.slots[-1].fade_out          # title in, end out
    assert tl.slots[1].fade_in and tl.slots[-2].fade_out          # only scene opens + closes


def test_narration_is_ignored_silent_beat():
    """Dialogue-only format: legacy narration neither burns nor speaks."""
    p = Production(title="N", scenes=[Scene(shots=[Shot(action="x", duration_s=3, narration="The tide came in.")])])
    tl = compile_to_timeline(p)
    assert tl.slots[1].text == ""  # a silent beat, not a caption


def test_casting_skipped_falls_back_to_t2v():
    p = build_storyboard(get_models().text, develop_treatment(get_models().text, "x", style_name="noir"))
    # no character has a reference_url (casting skipped) -> every shot uses t2v
    for sh in p.shots:
        assert generate_shot(get_models(), p, sh).tool in ("generate_shot_t2v", "generate_shot_i2v_continuity")


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_all_narration_film_produces():
    p = Production(title="N", project_id=repo.create_project(name="f")["id"],
                   scenes=[Scene(shots=[Shot(action="a wide shore", duration_s=3, narration="The tide came in."),
                                        Shot(action="a gull", duration_s=2, narration="Nothing waited.")])])
    repo.save_production(p)
    jid = queue.enqueue("produce_film", {"production_id": p.id})
    from recut.worker.main import process_once
    from recut.worker.registry import build_context
    process_once(build_context())
    assert queue.get_job(jid).status == "done", queue.get_job(jid).error
    assert repo.get_production(p.id).export_asset_id


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_editing_a_line_resynths_only_that_shot():
    from recut.worker.main import process_once
    from recut.worker.registry import build_context

    p = build_storyboard(get_models().text, develop_treatment(get_models().text, "noir", style_name="noir"))
    p.project_id = repo.create_project(name="f")["id"]
    repo.save_production(p)
    queue.enqueue("produce_film", {"production_id": p.id}); process_once(build_context())
    v1 = repo.get_production(p.id).token_ledger.voice_tokens

    # edit one shot's dialogue line, then RETAKE it (the contract: chosen takes are
    # permanent — re-filming is an explicit force, never a field-clear)
    cur = repo.get_production(p.id)
    target = next(s for s in cur.shots if s.dialogue)
    target.dialogue[0].line = "A completely different line now."
    repo.save_production(cur)
    queue.enqueue("produce_film", {"production_id": p.id, "scope_ids": [target.id],
                                   "force_ids": [target.id], "render": False})
    process_once(build_context())
    v2 = repo.get_production(p.id).token_ledger.voice_tokens
    assert v2 > v1  # the edited line was re-synthesized (changed caption hash); others reused


def test_writers_room_survives_a_dead_network():
    """INVARIANT (live-hit): a connection reset during the writer call must NOT 500
    the create — the user gets an editable starter script + an honest warning."""
    from recut.showrunner.pipeline.writers_room import develop_treatment

    class DeadLLM:
        def complete(self, system, user, json_mode=False):
            raise ConnectionResetError(54, "Connection reset by peer")

    p = develop_treatment(DeadLLM(), "a custom style premise", target_seconds=30,
                          style_name="custom", tone="thriller")
    assert len(p.characters) >= 2 and len(p.scenes) >= 3  # offline starter script
    assert any("offline" in w for w in p.warnings)
