"""Sprint 3 — crit round 2: speaker captions, title/end cards, music bed, graceful
render, and an eval harness that measures the NEW product."""

from __future__ import annotations

import shutil

import pytest

from recut.core import queue, repo
from recut.core.models import get_models
from recut.core.schemas import SlotType
from recut.showrunner.compile import compile_to_timeline
from recut.showrunner.eval import consistency_eval, narrative_rubric, token_efficiency
from recut.showrunner.pipeline.storyboard import build_storyboard
from recut.showrunner.pipeline.writers_room import develop_treatment
from recut.showrunner.schemas import DialogueLine, Production, Scene, Shot
from recut.worker.main import process_once
from recut.worker.registry import build_context


def test_caption_names_the_speaker():
    sh = Shot(action="x", dialogue=[
        DialogueLine(character_name="Mara", line="It was you."),
        DialogueLine(character_name="Vince", line="Prove it."),
    ])
    assert sh.caption == "Mara: It was you.\nVince: Prove it."
    sh2 = Shot(action="x", narration="The city never sleeps.")
    assert sh2.caption == "The city never sleeps."


def test_compile_adds_title_and_end_cards():
    p = Production(title="Last Call", theme="Trust is expensive.",
                   scenes=[Scene(shots=[Shot(action="a", duration_s=3), Shot(action="b", duration_s=3)])])
    tl = compile_to_timeline(p)
    assert len(tl.slots) == 4  # title + 2 shots + end
    assert tl.slots[0].type == SlotType.text and "Last Call" in tl.slots[0].text
    assert tl.slots[-1].type == SlotType.text and "Last Call" in tl.slots[-1].text  # end card reprises title
    # opt-out
    assert len(compile_to_timeline(p, with_cards=False).slots) == 2


def test_narrative_rubric_scores():
    p = develop_treatment(get_models().text, "a detective realizes her partner is the killer", style_name="noir")
    score = narrative_rubric(get_models().text, p)
    assert 0.0 <= score.overall <= 1.0
    assert {"dramatic_question_payoff", "character_arc", "subtext", "ending_earned"} <= set(score.scores)


def test_consistency_eval_structure_and_separation():
    # stub critic scores by candidate filename: '*_a0'/'*0.png' low, else high.
    ev = consistency_eval(get_models(), "ref.png", "cand_match.png", "cand_a0.png")
    assert ev.same_score is not None and ev.diff_score is not None
    assert ev.separates  # matching pair scored higher than the mismatch


def test_token_efficiency_facts():
    p = develop_treatment(get_models().text, "x")
    eff = token_efficiency(p)
    assert eff["video_tokens_pre_approval"] == 0
    assert "baseline_estimate" in eff and eff["total_token_estimate"] >= 0


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_bed_generation():
    from recut.core.config import get_settings
    from recut.showrunner.pipeline.assemble import find_or_make_bed

    # real-only by default (no hum shipped); explicit opt-in still generates a pad
    assert find_or_make_bed("noir", get_settings().work_dir + "/b0.wav", get_settings()) is None
    bed = find_or_make_bed("noir", get_settings().work_dir + "/b1.wav", get_settings(), generate_fallback=True)
    assert bed  # opt-in pad produced


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_produce_film_has_cards_and_bed():
    p = develop_treatment(get_models().text, "noir betrayal", style_name="noir")
    p = build_storyboard(get_models().text, p)
    p.project_id = repo.create_project(name="f")["id"]
    repo.save_production(p)
    jid = queue.enqueue("produce_film", {"production_id": p.id})
    process_once(build_context())
    job = queue.get_job(jid)
    assert job.status == "done", job.error
    assert job.result.get("export_asset_id")


def test_produce_render_failure_degrades_gracefully(monkeypatch):
    # generation succeeds but the final render throws -> partial result, shots preserved
    p = develop_treatment(get_models().text, "x", style_name="noir")
    p = build_storyboard(get_models().text, p)
    p.project_id = repo.create_project(name="f")["id"]
    repo.save_production(p)

    import recut.worker.handlers.showrunner as H

    monkeypatch.setattr(H, "render_timeline", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("ffmpeg boom")))
    jid = queue.enqueue("produce_film", {"production_id": p.id})
    process_once(build_context())
    job = queue.get_job(jid)
    assert job.status == "done"
    assert job.result.get("partial") is True and job.result["stage"] == "render_failed"
    final = repo.get_production(p.id)
    assert all(s.asset_id for s in final.shots)  # generated shots preserved, not lost
