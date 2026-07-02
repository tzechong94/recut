"""Sprint 5 (crit round 3): real dialogue written + critiqued + placed + scored;
director's decision log; honest token counts; robustness."""

from __future__ import annotations

import shutil

import pytest

from recut.core import queue, repo
from recut.core.models import get_models
from recut.showrunner.eval import token_efficiency
from recut.showrunner.pipeline.dialogue import write_dialogue
from recut.showrunner.pipeline.storyboard import build_storyboard
from recut.showrunner.pipeline.writers_room import develop_treatment
from recut.worker.main import process_once
from recut.worker.registry import build_context


def test_dialogue_pass_writes_and_critiques_lines():
    p = develop_treatment(get_models().text, "a detective realizes her partner is the killer", style_name="noir")
    p = write_dialogue(get_models().text, p)
    # every scene got written, critiqued dialogue attributed to real characters
    assert all(sc.script for sc in p.scenes)
    cids = {c.id for c in p.characters}
    assert any(d.character_id in cids for sc in p.scenes for d in sc.script)
    # dialogue critic turns recorded in the transcript with scores
    assert any(m["role"] == "dialogue" and "score" in m for m in p.writers_room)


def test_storyboard_places_written_dialogue_onto_shots():
    p = develop_treatment(get_models().text, "noir betrayal", style_name="noir")
    p = build_storyboard(get_models().text, p)
    # shots' dialogue comes from the written scene.script (placed), not invented
    for sc in p.scenes:
        placed = [d.line for sh in sc.shots for d in sh.dialogue]
        scripted = [d.line for d in sc.script]
        assert set(placed) <= set(scripted) or not scripted


def test_narrative_rubric_runs_with_dialogue():
    from recut.showrunner.eval import narrative_rubric

    p = build_storyboard(get_models().text, develop_treatment(get_models().text, "x", style_name="noir"))
    score = narrative_rubric(get_models().text, p)
    assert 0.0 <= score.overall <= 1.0


def test_token_efficiency_reports_real_counts():
    p = develop_treatment(get_models().text, "x")
    eff = token_efficiency(p)
    for k in ("video_seconds_generated", "shots_generated", "reference_images", "tts_chars", "video_tokens_pre_approval"):
        assert k in eff
    assert eff["video_tokens_pre_approval"] == 0


def test_end_card_reprises_title_not_theme():
    from recut.showrunner.compile import compile_to_timeline
    from recut.showrunner.schemas import Production, Scene, Shot

    p = Production(title="Last Call", theme="the cost of ambition", scenes=[Scene(shots=[Shot(action="a", duration_s=3)])])
    tl = compile_to_timeline(p)
    assert "Last Call" in tl.slots[-1].text and "ambition" not in tl.slots[-1].text


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_director_log_records_decisions():
    p = build_storyboard(get_models().text, develop_treatment(get_models().text, "noir", style_name="noir"))
    p.project_id = repo.create_project(name="f")["id"]
    repo.save_production(p)
    jid = queue.enqueue("produce_film", {"production_id": p.id})
    process_once(build_context())
    assert queue.get_job(jid).status == "done"
    final = repo.get_production(p.id)
    assert len(final.director_log) >= 1
    entry = final.director_log[0]
    assert entry["decision"] and entry["reason"]
