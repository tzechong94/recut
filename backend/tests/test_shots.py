"""Shot-boundary normalization — the temporal detection front-half of analysis.

ffmpeg itself isn't invoked here; we mock cut detection to test the subdivide/merge
logic that turns raw cuts into a sensible 5-8 beat structure."""

from __future__ import annotations

from recut.pipeline import shots


def _patch(monkeypatch, cuts, dur):
    monkeypatch.setattr(shots, "detect_scene_cuts", lambda *a, **k: cuts)
    monkeypatch.setattr(shots, "probe_duration", lambda *a, **k: dur)


def test_many_cuts_merged_down_to_max(monkeypatch):
    _patch(monkeypatch, [i * 1.0 for i in range(1, 60)], 60.0)  # 59 cuts
    b = shots.shot_boundaries("x.mp4", 60.0, min_shots=5, max_shots=8)
    assert 5 <= len(b) <= 8
    assert b[0][0] == 0.0 and abs(b[-1][1] - 60.0) < 0.01
    # contiguous, increasing
    for (s, e) in b:
        assert e > s
    for i in range(len(b) - 1):
        assert abs(b[i][1] - b[i + 1][0]) < 0.01


def test_no_cuts_subdivided_up_to_min(monkeypatch):
    _patch(monkeypatch, [], 20.0)  # one continuous shot
    b = shots.shot_boundaries("x.mp4", 20.0, min_shots=5, max_shots=8)
    assert len(b) >= 5
    assert abs(b[-1][1] - 20.0) < 0.01


def test_short_clip_stays_single(monkeypatch):
    _patch(monkeypatch, [], 2.0)  # too short to subdivide meaningfully
    b = shots.shot_boundaries("x.mp4", 2.0, min_shots=5, max_shots=8, min_len=0.6)
    assert len(b) >= 1 and b[0][0] == 0.0


def test_cut_count_in_range_passthrough(monkeypatch):
    _patch(monkeypatch, [10, 20, 30, 40, 50], 60.0)  # 5 cuts -> 6 shots
    b = shots.shot_boundaries("x.mp4", 60.0, min_shots=5, max_shots=8)
    assert len(b) == 6