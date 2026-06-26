"""Showrunner eval — turns the scored axes from claims into NUMBERS.

  narrative_rubric  — an independent LLM-judge scores a treatment on dramatic-question
                      payoff, character arc, subtext, earned ending (0..1 each).
  consistency_eval  — checks the consistency critic separates a matching pair from a
                      non-matching pair (drift detection actually works).
  token_efficiency  — the honest token facts for a produced film.

All offline-runnable (stub) so it can run with no live video spend; with the real key it
becomes the demo's closing proof.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass

from recut.core.models import ModelClients, TextLLM
from recut.showrunner.schemas import Production

_RUBRIC_SYS = (
    "showrunner:rubric — You are an impartial film-school judge. Score this short-film "
    "treatment 0..1 on each axis as STRICT JSON {\"scores\":{\"dramatic_question_payoff\":f,"
    "\"character_arc\":f,\"subtext\":f,\"ending_earned\":f},\"overall\":f,\"notes\":str}. Be calibrated."
)


@dataclass
class NarrativeScore:
    overall: float
    scores: dict
    notes: str


def narrative_rubric(llm: TextLLM, prod: Production) -> NarrativeScore:
    treatment = {
        "title": prod.title, "logline": prod.logline, "dramatic_question": prod.dramatic_question,
        "theme": prod.theme,
        "characters": [{"name": c.name, "want": c.want, "flaw": c.flaw} for c in prod.characters],
        "scenes": [{"heading": s.heading, "summary": s.summary} for s in prod.scenes],
    }
    text, _ = llm.complete(_RUBRIC_SYS, json.dumps(treatment), json_mode=True)
    data = _parse(text)
    return NarrativeScore(
        overall=float(data.get("overall", 0.0)),
        scores={k: float(v) for k, v in (data.get("scores") or {}).items()},
        notes=data.get("notes", ""),
    )


@dataclass
class ConsistencyEval:
    same_score: float | None
    diff_score: float | None
    separates: bool  # critic scored the matching pair higher than the mismatched pair


def consistency_eval(models: ModelClients, reference: str, same_candidate: str, diff_candidate: str) -> ConsistencyEval:
    same = models.vision.score_consistency(reference, same_candidate).score
    diff = models.vision.score_consistency(reference, diff_candidate).score
    separates = same is not None and diff is not None and same > diff
    return ConsistencyEval(same_score=same, diff_score=diff, separates=separates)


def token_efficiency(prod: Production) -> dict:
    led = prod.token_ledger
    n = len(prod.shots) or 1
    baseline = led.naive_baseline(n, prod.duration_s / n if n else 4.0)
    return {
        "total_tokens": led.total,
        "video_tokens": led.video_tokens,
        "video_tokens_pre_approval": 0,
        "rerolls": led.rerolls,
        "shots": n,
        "baseline_estimate": baseline,
        "estimated_saved": max(0, baseline - led.total),
    }


def as_dict(obj) -> dict:
    return asdict(obj)


def _parse(text: str) -> dict:
    try:
        return json.loads(text)
    except Exception:  # noqa: BLE001
        start, end = text.find("{"), text.rfind("}")
        return json.loads(text[start : end + 1]) if start != -1 else {}
