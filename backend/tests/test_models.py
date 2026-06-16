import json

import pytest

from recut.core.models import get_models
from recut.core.qwen_clients import _extract_json, build_qwen_clients
from recut.core.config import Settings


def test_stub_models_are_deterministic():
    m = get_models()
    a = m.vision.analyze("x.mp4")
    b = m.vision.analyze("x.mp4")
    assert [s.description for s in a.shots] == [s.description for s in b.shots]
    assert a.duration_s == 23.0


def test_stub_text_llm_routes_on_marker():
    m = get_models()
    out, tokens = m.text.complete("you are a co-write agent doing script-on-beats", "story", json_mode=True)
    data = json.loads(out)
    assert len(data["beats"]) == 7
    assert tokens > 0
    cap, _ = m.text.complete("draft the caption and cover", "", json_mode=True)
    assert "caption" in json.loads(cap)


def test_extract_json_tolerates_fences():
    assert _extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert _extract_json('here you go {"x": "y"} thanks') == {"x": "y"}


def test_qwen_requires_key():
    with pytest.raises(RuntimeError):
        build_qwen_clients(Settings(model_backend="qwen", dashscope_api_key=""))
