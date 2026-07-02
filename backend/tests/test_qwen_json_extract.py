"""Regression: live qwen-max stacks JSON objects (NDJSON) instead of returning the
requested {"lines":[...]} wrapper, which made a naive json.loads choke on 'Extra data'
and silently dropped every scene's dialogue. _extract_json must tolerate that.

(The stub never produces this shape, so the rest of the suite was blind to it.)"""
from recut.core.qwen_clients import _extract_json, _json_objects


def test_single_object_unchanged():
    assert _extract_json('{"premise": "a keeper"}') == {"premise": "a keeper"}


def test_fenced_object():
    assert _extract_json('```json\n{"overall": 0.82}\n```') == {"overall": 0.82}


def test_ndjson_lines_folded_into_wrapper():
    # what live qwen-max actually returned for the dialogue writer
    raw = (
        '{"character": "Eli", "line": "You knew this was coming."}\n'
        '{"character": "Vince", "line": "I know."}'
    )
    out = _extract_json(raw)
    assert [l["character"] for l in out["lines"]] == ["Eli", "Vince"]


def test_already_wrapped_lines_preserved():
    raw = '{"lines": [{"character": "Eli", "line": "hi"}]}'
    assert _extract_json(raw)["lines"][0]["line"] == "hi"


def test_prose_around_object_ignored():
    raw = 'Sure! Here are the scores:\n{"overall": 0.7, "notes": "tighten it"}\nHope that helps.'
    assert _extract_json(raw)["overall"] == 0.7


def test_extra_data_does_not_raise():
    # the exact failure mode: two non-line objects stacked -> take the first, never crash
    assert _json_objects('{"a": 1}\n{"b": 2}') == [{"a": 1}, {"b": 2}]
    assert _extract_json('{"a": 1}\n{"b": 2}') == {"a": 1}


def test_no_json_raises():
    import pytest

    with pytest.raises(ValueError):
        _extract_json("no json here at all")
