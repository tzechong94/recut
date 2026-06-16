"""Eval runner — emits a JSON report and a markdown table.

Run from the repo root (uses the backend venv):
    backend/.venv/bin/python -m eval.run
or from backend with PYTHONPATH including the repo root.

Simulates the demo flow on stub models: analyse the marble reference, build the base
cut, then have the creator supply real footage for their slots and generate only the
kept auto slots. Reports recipe quality, the token-budget headline, and
time-to-first-playable-cut.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Make `recut` importable without installing the package.
_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / "backend"))
os.environ.setdefault("RECUT_MODEL_BACKEND", "stub")
os.environ.setdefault("RECUT_STORAGE_BACKEND", "local")

from recut.core.models import get_models  # noqa: E402
from recut.core.schemas import ACTOR_YOU, SlotType  # noqa: E402
from recut.core.timeline_ops import (  # noqa: E402
    NAIVE_TOKENS_PER_S,
    attach_upload,
    base_cut_from_recipe,
    mark_generated,
)
from recut.pipeline.analyse import analyse_reference  # noqa: E402
from eval.metrics import (  # noqa: E402
    as_dict,
    recipe_quality,
    time_to_first_cut_ms,
    token_budget,
)

FIXTURE = _ROOT / "eval" / "fixtures" / "marble_reference.json"
REPORT_JSON = _ROOT / "eval" / "report.json"
REPORT_MD = _ROOT / "eval" / "report.md"


def run() -> dict:
    m = get_models()
    expected = json.loads(FIXTURE.read_text())

    # 1. recipe quality
    recipe = analyse_reference("demo_marble.mp4", vision=m.vision, transcriber=m.transcriber, project_id="eval")
    quality = recipe_quality(expected, recipe)

    # 2. token budget — simulate a realistic edit:
    #    creator supplies real footage for their slots; only kept auto slots generate.
    tl = base_cut_from_recipe(recipe, project_id="eval")
    for s in tl.slots:
        if s.type in ACTOR_YOU:
            attach_upload(tl, s.id, f"a_real_{s.id}")  # the creator's footage = the spine
    for s in list(tl.slots):
        if s.type == SlotType.broll and s.kept:
            mark_generated(tl, s.id, f"a_gen_{s.id}", tool="generate_broll", tokens=int(s.duration_s * NAIVE_TOKENS_PER_S[SlotType.broll]))
        elif s.type == SlotType.text and s.kept:
            mark_generated(tl, s.id, f"a_card_{s.id}", tool="generate_text_card", tokens=NAIVE_TOKENS_PER_S[SlotType.text])
    budget = token_budget(tl)

    # 3. time-to-first-playable-cut
    ttfc = time_to_first_cut_ms(recipe)

    report = {
        "recipe_quality": as_dict(quality),
        "token_budget": as_dict(budget),
        "time_to_first_cut_ms": ttfc,
    }
    REPORT_JSON.write_text(json.dumps(report, indent=2))
    REPORT_MD.write_text(_markdown(report))
    return report


def _markdown(r: dict) -> str:
    q, b = r["recipe_quality"], r["token_budget"]
    return f"""# Recut — Eval Report

## Recipe quality (the scored technical artifact)
| metric | value |
|---|---|
| shots detected | {q['shot_count_detected']} / {q['shot_count_expected']} expected ({'match' if q['shot_count_match'] else 'MISS'}) |
| beats detected | {q['beat_count_detected']} / {q['beat_count_expected']} expected ({'match' if q['beat_count_match'] else 'MISS'}) |
| slot-type accuracy | {q['slot_type_accuracy'] * 100:.0f}% |
| beat-label accuracy | {q['label_accuracy'] * 100:.0f}% |
| **overall score** | **{q['score'] * 100:.0f}%** |

## Token budget (the headline)
| metric | value |
|---|---|
| **your real footage** | **{b['real_footage_share'] * 100:.0f}%** of the cut ({b['real_footage_s']:.0f}s / {b['total_s']:.0f}s) |
| generated | {b['generated_s']:.0f}s |
| stand-in remaining | {b['standin_s']:.0f}s |
| tokens spent | {b['tokens_spent']:,} |
| naive full-generation baseline | {b['naive_baseline_tokens']:,} |
| **tokens saved** | **{b['tokens_saved']:,} ({b['savings_pct']:.0f}% cheaper)** |

## Experience
| metric | value |
|---|---|
| time-to-first-playable-cut | {r['time_to_first_cut_ms']:.2f} ms |

_Generation is gap-fill only: the creator's footage is the spine, AI fills the gaps for
kept slots only. That's the token discipline — and the whole point._
"""


if __name__ == "__main__":
    rep = run()
    print(_markdown(rep))
    print(f"\nWrote {REPORT_JSON} and {REPORT_MD}")
