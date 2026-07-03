"""Screen tests — the validation bench.

Movie-grade two-hander scenes (original writing, iconic SHAPES: the interrogation,
the diner standoff, the doorway goodbye) at 20-30s. These stress exactly what the
product sells: charged dialogue, shot/reverse-shot, distinct voices, lip-sync.
Used for pipeline validation instead of ad-hoc premises; also exposed to users as
"screen test" examples.
"""

from __future__ import annotations

SCREEN_TESTS: list[dict] = [
    {
        "key": "interrogation",
        "premise": (
            "A detective slides a photo across the table to a suspect who has an alibi "
            "for everything except the one hour that matters — and the suspect's lawyer "
            "just texted him to stop talking."
        ),
        "style": "cinematic", "tone": "thriller", "target_seconds": 25,
    },
    {
        "key": "diner_standoff",
        "premise": (
            "A veteran thief and the detective who's chased him for years share a coffee "
            "booth at 2am — both admit, politely, that if the moment ever comes, neither "
            "will hesitate."
        ),
        "style": "noir", "tone": "thriller", "target_seconds": 30,
    },
    {
        "key": "doorway_goodbye",
        "premise": (
            "She's holding the taxi door open in the rain; he finally says the thing he "
            "rehearsed for three years — one sentence too late."
        ),
        "style": "cinematic", "tone": "romance", "target_seconds": 20,
    },
    {
        "key": "the_offer",
        "premise": (
            "A young chef is offered her mentor's restaurant on one condition: fire the "
            "sous-chef who is also her brother — the mentor already knows what she'll choose."
        ),
        "style": "cinematic", "tone": "tragic", "target_seconds": 30,
    },
    {
        "key": "the_return_counter",
        "premise": (
            "A customer returns a robot vacuum that salutes him and calls him 'Commander' "
            "— the clerk, reading from the manual, insists loyalty is a premium feature "
            "and the real problem is that the customer isn't saluting back."
        ),
        "style": "claymation", "tone": "comedy", "target_seconds": 25,
    },
    {
        "key": "courtroom_turn",
        "premise": (
            "A star witness recants on the stand; the prosecutor realizes mid-question "
            "that her own key evidence was planted — by her boss, seated in the gallery."
        ),
        "style": "cinematic", "tone": "melodrama", "target_seconds": 30,
    },
]
