"""Lane E — eval harness tests. Guards the scored metrics and the headline numbers."""

from __future__ import annotations

import sys
from pathlib import Path

# eval/ lives at the repo root (sibling of backend/).
_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from eval.metrics import recipe_quality, time_to_first_cut_ms, token_budget  # noqa: E402
from recut.core.models import StubTranscriber, StubVision  # noqa: E402
from recut.core.schemas import ACTOR_YOU, SlotType  # noqa: E402
from recut.core.timeline_ops import attach_upload, base_cut_from_recipe, mark_generated  # noqa: E402
from recut.pipeline.analyse import analyse_reference  # noqa: E402


def _recipe():
    return analyse_reference("x.mp4", vision=StubVision(), transcriber=StubTranscriber())


def test_recipe_quality_perfect_on_demo():
    import json

    expected = json.loads((_ROOT / "eval" / "fixtures" / "marble_reference.json").read_text())
    q = recipe_quality(expected, _recipe())
    assert q.shot_count_match and q.beat_count_match
    assert q.slot_type_accuracy == 1.0  # classifier matches the labeled structure
    assert q.score >= 0.95


def test_token_budget_real_footage_dominant():
    tl = base_cut_from_recipe(_recipe(), project_id="eval")
    for s in tl.slots:
        if s.type in ACTOR_YOU:
            attach_upload(tl, s.id, f"a_{s.id}")
        elif s.type == SlotType.broll:
            mark_generated(tl, s.id, f"g_{s.id}", tool="generate_broll", tokens=int(s.duration_s * 1800))
    b = token_budget(tl)
    assert b.real_footage_share > 0.5  # the creator's footage is the spine
    assert b.tokens_saved > 0 and b.savings_pct > 50  # cheaper than naive full-gen


def test_time_to_first_cut_is_fast():
    # base cut plays instantly (stand-ins) — well under 50ms even on CI
    assert time_to_first_cut_ms(_recipe()) < 50.0


def test_run_writes_report(tmp_path, monkeypatch):
    import eval.run as runner

    rep = runner.run()
    assert rep["recipe_quality"]["score"] >= 0.95
    assert rep["token_budget"]["real_footage_share"] > 0.5
    assert runner.REPORT_JSON.exists()
