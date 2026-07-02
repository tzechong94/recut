"""The offline submission proof artifact (eval/run_showrunner.py)."""
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def test_eval_report_runs_and_writes_artifact():
    import eval.run_showrunner as r

    rep = r.run()
    assert rep["premises"] == 4
    assert 0.0 <= rep["narrative_overall_avg"] <= 1.0
    assert rep["consistency"]["separates"] is True  # critic separates match vs mismatch
    assert len(rep["rows"]) == 4
    assert all(row["narrative"]["overall"] >= 0 and row["dialogue_lines"] >= 0 for row in rep["rows"])
    assert (_ROOT / "eval" / "showrunner_report.json").exists()
    assert (_ROOT / "eval" / "showrunner_report.md").exists()
