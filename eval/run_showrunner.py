"""Showrunner eval report — the submission's quality proof, offline (stub models).

Runs the narrative rubric across several premises/genres and the consistency-critic
separation check, then writes eval/showrunner_report.{json,md}. With real Qwen
(RECUT_MODEL_BACKEND=qwen) the same harness produces live numbers; offline it proves the
pipeline + scoring loop end to end with zero spend.

    python -m eval.run_showrunner            # from repo root (uses backend venv)
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / "backend"))
os.environ.setdefault("RECUT_MODEL_BACKEND", "stub")
os.environ.setdefault("RECUT_STORAGE_BACKEND", "local")

from recut.core.models import get_models  # noqa: E402
from recut.showrunner.eval import as_dict, consistency_eval, narrative_rubric, token_efficiency  # noqa: E402
from recut.showrunner.pipeline.storyboard import build_storyboard  # noqa: E402
from recut.showrunner.pipeline.writers_room import develop_treatment  # noqa: E402

PREMISES = [
    ("a detective realizes her partner is the killer she's hunted all night", "noir"),
    ("a shy kid discovers she can hear what machines are thinking", "anime"),
    ("two rival bakers must share one oven the night before the contest", "claymation"),
    ("an old lighthouse keeper writes letters to a ship that never comes", "storybook"),
]


def run() -> dict:
    m = get_models()
    rows = []
    for premise, style in PREMISES:
        prod = build_storyboard(m.text, develop_treatment(m.text, premise, style_name=style))
        rubric = narrative_rubric(m.text, prod)
        rows.append({
            "premise": premise, "style": style, "title": prod.title,
            "narrative": as_dict(rubric),
            "scenes": len(prod.scenes), "shots": len(prod.shots),
            "dialogue_lines": sum(len(s.script) for s in prod.scenes),
            "tokens": token_efficiency(prod),
        })

    # consistency-critic separation: matching pair should outscore a mismatched pair
    ce = consistency_eval(m, "ref.png", "cand_match.png", "cand_a0.png")
    n = len(rows)
    report = {
        "premises": n,
        "narrative_overall_avg": round(sum(r["narrative"]["overall"] for r in rows) / n, 3),
        "consistency": as_dict(ce),
        "rows": rows,
        "model_backend": os.environ.get("RECUT_MODEL_BACKEND"),
    }
    (_ROOT / "eval" / "showrunner_report.json").write_text(json.dumps(report, indent=2))
    (_ROOT / "eval" / "showrunner_report.md").write_text(_markdown(report))
    return report


def _markdown(r: dict) -> str:
    lines = [
        "# Recut Showrunner — Eval Report",
        f"\nModel backend: `{r['model_backend']}` · premises: {r['premises']}",
        f"\n**Narrative rubric (avg overall): {r['narrative_overall_avg']:.2f}/1.00**",
        f"\n**Consistency critic separates match vs mismatch: "
        f"{'YES' if r['consistency']['separates'] else 'NO'}** "
        f"(same={r['consistency']['same_score']}, diff={r['consistency']['diff_score']})",
        "\n| premise | style | title | narrative | scenes | shots | lines |",
        "|---|---|---|---|---|---|---|",
    ]
    for row in r["rows"]:
        lines.append(
            f"| {row['premise'][:42]}… | {row['style']} | {row['title']} | "
            f"{row['narrative']['overall']:.2f} | {row['scenes']} | {row['shots']} | {row['dialogue_lines']} |"
        )
    lines.append("\n_Narrative rubric scores the ACTUAL written+critiqued dialogue, not a synopsis. "
                 "0 video tokens spent (eval is pre-production only)._")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    rep = run()
    print(_markdown(rep))
    print(f"Wrote eval/showrunner_report.json and .md")
