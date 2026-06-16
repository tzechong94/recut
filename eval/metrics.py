"""Eval metrics — pure functions over recipes/timelines.

Three things the hackathon scores:
  1. Recipe quality   — does the extracted recipe match the reference's real structure?
  2. Token budget     — real-footage share + tokens vs a naive full-generation baseline.
  3. Time-to-first-playable-cut — how fast does a cut that plays end to end appear?
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass

from recut.core.schemas import Recipe, Timeline
from recut.core.timeline_ops import NAIVE_TOKENS_PER_S, base_cut_from_recipe


@dataclass
class RecipeQuality:
    shot_count_expected: int
    shot_count_detected: int
    shot_count_match: bool
    beat_count_expected: int
    beat_count_detected: int
    beat_count_match: bool
    slot_type_accuracy: float  # fraction of beats whose type matches by position
    label_accuracy: float
    score: float  # 0..1 overall


def recipe_quality(expected: dict, got: Recipe) -> RecipeQuality:
    exp_beats = expected.get("beats", [])
    n = min(len(exp_beats), len(got.beats))
    type_hits = sum(1 for i in range(n) if exp_beats[i]["slot_type"] == got.beats[i].slot_type.value)
    label_hits = sum(1 for i in range(n) if exp_beats[i].get("label") == got.beats[i].label)
    type_acc = type_hits / len(exp_beats) if exp_beats else 0.0
    label_acc = label_hits / len(exp_beats) if exp_beats else 0.0
    shot_match = expected.get("shot_count") == got.shot_count
    beat_match = len(exp_beats) == len(got.beats)
    # score: weighted blend (structure detection is what matters most)
    score = round(0.4 * type_acc + 0.2 * label_acc + 0.2 * shot_match + 0.2 * beat_match, 4)
    return RecipeQuality(
        shot_count_expected=expected.get("shot_count", 0),
        shot_count_detected=got.shot_count,
        shot_count_match=shot_match,
        beat_count_expected=len(exp_beats),
        beat_count_detected=len(got.beats),
        beat_count_match=beat_match,
        slot_type_accuracy=round(type_acc, 4),
        label_accuracy=round(label_acc, 4),
        score=score,
    )


@dataclass
class TokenBudget:
    total_s: float
    real_footage_s: float
    generated_s: float
    standin_s: float
    real_footage_share: float
    tokens_spent: int
    naive_baseline_tokens: int
    tokens_saved: int
    savings_pct: float


def token_budget(tl: Timeline) -> TokenBudget:
    led = tl.token_ledger
    savings = round(led.tokens_saved / led.naive_baseline_tokens * 100, 2) if led.naive_baseline_tokens else 0.0
    return TokenBudget(
        total_s=led.total_s,
        real_footage_s=led.real_footage_s,
        generated_s=led.generated_s,
        standin_s=led.standin_s,
        real_footage_share=led.real_footage_share,
        tokens_spent=led.tokens_spent,
        naive_baseline_tokens=led.naive_baseline_tokens,
        tokens_saved=led.tokens_saved,
        savings_pct=savings,
    )


def time_to_first_cut_ms(recipe: Recipe, runs: int = 5) -> float:
    """Wall-clock to build a playable base cut (all stand-ins) from a recipe. The base
    cut plays instantly in the preview — no render needed — so this is the real
    time-to-first-playable-cut."""
    best = float("inf")
    for _ in range(runs):
        t0 = time.perf_counter()
        base_cut_from_recipe(recipe)
        best = min(best, (time.perf_counter() - t0) * 1000)
    return round(best, 3)


def as_dict(obj) -> dict:
    return asdict(obj)
