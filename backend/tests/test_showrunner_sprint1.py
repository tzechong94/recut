"""Sprint 1 — YC-CEO crit fixes: real critic/re-roll, narrative depth, audio-fit, honest scoreboard."""

from __future__ import annotations

import shutil

import pytest

from recut.core import queue, repo
from recut.core.models import StubVision, get_models
from recut.showrunner.pipeline.storyboard import build_storyboard
from recut.showrunner.pipeline.writers_room import develop_treatment
from recut.worker.main import process_once
from recut.worker.registry import build_context


# ---- #3 narrative depth ---------------------------------------------------------
def test_writers_room_multi_round_with_climbing_scores():
    p = develop_treatment(get_models().text, "a detective realizes her partner is the killer", style_name="noir")
    crit_scores = [m["score"] for m in p.writers_room if m["role"] == "critic"]
    assert len(crit_scores) >= 2, "expected a multi-round debate"
    assert crit_scores == sorted(crit_scores), "critic score should climb across rounds"
    # structure + arcs populated
    assert p.dramatic_question and p.theme
    assert all(c.want and c.flaw for c in p.characters)
    # distinct voices assigned
    assert len({c.voice for c in p.characters}) == len(p.characters)


def test_genre_register_changes_writer_prompt():
    from recut.showrunner.pipeline.writers_room import _REGISTER, _writer_sys

    assert "noir" in _writer_sys(_REGISTER["noir"]).lower()
    assert _writer_sys(_REGISTER["noir"]) != _writer_sys(_REGISTER["storybook"])


# ---- #1 functional re-roll ------------------------------------------------------
def test_consistency_verdict_has_reason_and_skips_on_unavailable():
    from recut.core.models import ConsistencyVerdict, VisionAnalyzer

    v = StubVision().score_consistency("ref", "cand_a0.png")
    assert isinstance(v, ConsistencyVerdict) and v.score is not None and v.reason
    # base VisionAnalyzer default = unavailable (skip), never a fake pass
    class _Bare(VisionAnalyzer):
        def analyze(self, *a, **k):
            ...
    assert _Bare().score_consistency("r", "c").score is None


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_reroll_improves_and_is_recorded():
    p = develop_treatment(get_models().text, "noir betrayal", style_name="noir")
    p = build_storyboard(get_models().text, p)
    p.project_id = repo.create_project(name="f")["id"]
    # cast so shots have references (-> i2v -> critic runs)
    repo.save_production(p)
    for c in p.characters:
        queue.enqueue("cast_reference", {"production_id": p.id, "target": "character", "target_id": c.id})
        process_once(build_context())
    jid = queue.enqueue("produce_film", {"production_id": p.id})
    process_once(build_context())
    assert queue.get_job(jid).status == "done"
    final = repo.get_production(p.id)
    scored = [s for s in final.shots if s.critic_score is not None]
    assert scored, "consistency critic should have scored i2v shots"
    # best-of-N: final kept score is at/above threshold and at least one shot re-rolled
    assert all(s.critic_score >= 0.6 for s in scored)
    assert any(s.reroll_count >= 1 for s in final.shots)


# ---- #4 audio-fit ---------------------------------------------------------------
@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_durations_fit_voice_not_truncated():
    p = develop_treatment(get_models().text, "x", style_name="noir")
    p = build_storyboard(get_models().text, p)
    p.project_id = repo.create_project(name="f")["id"]
    repo.save_production(p)
    jid = queue.enqueue("produce_film", {"production_id": p.id})
    process_once(build_context())
    assert queue.get_job(jid).status == "done"
    final = repo.get_production(p.id)
    # every shot duration within the clamp window (set to fit its line)
    assert all(2.0 <= s.duration_s <= 12.0 for s in final.shots)


# ---- #5 honest scoreboard -------------------------------------------------------
def test_scoreboard_leads_with_true_facts():
    from fastapi.testclient import TestClient

    from recut.api.main import create_app

    c = TestClient(create_app())
    p = c.post("/api/productions", json={"premise": "x", "style": "noir"}).json()
    sb = c.get(f"/api/productions/{p['id']}/scoreboard").json()
    assert sb["video_tokens_pre_approval"] == 0 and sb["approval_gated"] is True
    assert "headline" in sb and "baseline_estimate_tokens" in sb
