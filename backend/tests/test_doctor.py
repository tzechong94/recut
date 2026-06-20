"""Doctor preflight — harness validated offline in stub mode (no key needed)."""

from __future__ import annotations

from recut import doctor


def test_doctor_runs_in_stub_mode():
    rep = doctor.run(full=False)
    assert rep["backend"] == "stub"
    names = {c["model"] for c in rep["checks"]}
    # the cheap checks always appear
    assert any("text" in n for n in names)
    assert any("image" in n for n in names)
    assert any("voice" in n for n in names)
    # stub responses succeed (validates the harness wiring)
    statuses = {c["model"]: c["status"] for c in rep["checks"]}
    assert statuses[next(n for n in names if "text" in n)] == "ok"
    # asr + wan are skipped without --full
    assert any(c["status"] == "skipped" and "video" in c["model"] for c in rep["checks"])


def test_doctor_full_includes_wan():
    rep = doctor.run(full=True)
    assert any("video" in c["model"] and c["status"] in ("ok", "error") for c in rep["checks"])


def test_doctor_reports_missing_key_for_qwen(monkeypatch):
    from recut.core import config

    config.get_settings.cache_clear()
    monkeypatch.setenv("RECUT_MODEL_BACKEND", "qwen")
    monkeypatch.setenv("RECUT_DASHSCOPE_API_KEY", "")
    rep = doctor.run(full=False)
    assert "fatal" in rep and "API_KEY" in rep["fatal"]
    config.get_settings.cache_clear()
