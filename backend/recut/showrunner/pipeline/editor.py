"""Editor pass — the literal "edit" stage of script→storyboard→video→EDIT.

The agent shouldn't cut like a for-loop. This makes (and LOGS) real editorial pacing
decisions: dialogue shots breathe at their spoken length; establishing shots get a held
beat; inserts/cutaways are punchy. Each decision is appended to the director's log so the
editorial autonomy is visible — not just generation.
"""

from __future__ import annotations

from recut.showrunner.schemas import Production, ShotType

# Target beats (seconds) for shots WITHOUT dialogue, by type. Dialogue shots keep their
# voice-fit duration (set by the audio-fit pass) so lines never get clipped.
_BEATS = {ShotType.wide: 3.2, ShotType.insert: 1.8, ShotType.close: 2.2, ShotType.medium: 2.4, ShotType.two_shot: 2.6}


def edit_pass(prod: Production) -> Production:
    """Adjust non-dialogue shot durations for rhythm and record the cuts in director_log."""
    for shot in prod.shots:
        if shot.caption:  # has dialogue/narration -> keep the voice-fit length
            continue
        target = _BEATS.get(shot.shot_type, 2.4)
        if abs(shot.duration_s - target) < 0.05:
            continue
        verb = "tightened" if target < shot.duration_s else "held"
        prod.director_log.append({
            "shot": f"Shot {shot.index + 1}",
            "decision": f"Editor: {verb} {shot.shot_type.value} to {target:.1f}s",
            "reason": "pace — silent coverage shouldn't outstay a spoken beat" if target < shot.duration_s else "let the establishing beat land",
        })
        shot.duration_s = target
    return prod
