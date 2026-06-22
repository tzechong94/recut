"""Canonical data schemas for Recut.

These two documents are the contract the entire system hangs off:

  RECIPE   — the transferable template extracted from a reference reel.
             "Borrow the format": ordered beats, each with a type, duration, and
             the noticed pattern. Never the reference's content.

  TIMELINE — the single source of truth for a project's cut. Both the live preview
             (pure React player) and the export (ffmpeg worker) read THIS, so they
             never drift. Stored as one JSONB document, versioned.

Slot lifecycle (v1 types: text, talk, roll, broll)::

    ┌─────────┐  creator keeps auto slot   ┌──────────────────┐  job done
    │ standin │ ─────────────────────────▶ │ pending_generation│ ───────────▶ ready
    └─────────┘                            └──────────────────┘
        │  creator uploads / films                 │ job fails
        ▼                                          ▼
      ready (source=user_upload)                  failed ──▶ falls back to standin
"""

from __future__ import annotations

import time
import uuid
from enum import Enum

from pydantic import BaseModel, Field, field_validator, model_validator


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _now() -> float:
    return time.time()


# --------------------------------------------------------------------------- #
#  Enums                                                                       #
# --------------------------------------------------------------------------- #
class SlotType(str, Enum):
    """v1 active set is text/talk/roll/broll. `illus` and `face` are reserved for
    forward-compat but gated off in v1 (illustration dropped; generated-face is
    consent-gated, post-v1)."""

    text = "text"  # text card        — auto-built
    talk = "talk"  # talking head     — you (film/upload)
    roll = "roll"  # camera roll      — you (upload)
    broll = "broll"  # generated b-roll — auto
    illus = "illus"  # RESERVED, gated off in v1
    face = "face"  # RESERVED, consent-gated, post-v1


V1_SLOT_TYPES: frozenset[SlotType] = frozenset(
    {SlotType.text, SlotType.talk, SlotType.roll, SlotType.broll}
)

# Which slot types are the creator's own footage ("you") vs auto-generated.
ACTOR_YOU: frozenset[SlotType] = frozenset({SlotType.talk, SlotType.roll, SlotType.face})
ACTOR_AUTO: frozenset[SlotType] = frozenset({SlotType.text, SlotType.broll, SlotType.illus})


class TextRole(str, Enum):
    on_screen_text = "on_screen_text"
    voiceover = "voiceover"
    none = "none"


class SlotSource(str, Enum):
    standin = "standin"  # placeholder so the cut plays immediately
    user_upload = "user_upload"  # the creator's real footage (the spine)
    generated = "generated"  # AI gap-fill (only for kept slots)


class SlotStatus(str, Enum):
    ready = "ready"
    pending_generation = "pending_generation"
    generating = "generating"
    failed = "failed"


class Font(str, Enum):
    display = "display"
    clean = "clean"
    mono = "mono"


class Size(str, Enum):
    s = "s"
    m = "m"
    l = "l"


class Align(str, Enum):
    left = "left"
    center = "center"
    right = "right"


# --------------------------------------------------------------------------- #
#  Recipe                                                                      #
# --------------------------------------------------------------------------- #
class SlotStyle(BaseModel):
    font: Font = Font.clean
    size: Size = Size.m
    align: Align = Align.left


class Beat(BaseModel):
    index: int
    label: str  # Hook, Setup, Cut 1, Payoff, CTA, ...
    slot_type: SlotType
    start_s: float = 0.0
    duration_s: float = Field(gt=0)
    pattern: str = ""  # the noticed structural pattern, prose
    description: str = ""  # what's visually happening (drives the regeneration prompt)
    text_role: TextRole = TextRole.none
    transcript_excerpt: str = ""
    on_screen_text: str = ""
    style_hint: SlotStyle = Field(default_factory=SlotStyle)

    @field_validator("slot_type")
    @classmethod
    def _v1_only(cls, v: SlotType) -> SlotType:
        if v not in V1_SLOT_TYPES:
            # Recipes should only emit v1 types. Coerce reserved -> nearest v1.
            return SlotType.broll if v in ACTOR_AUTO else SlotType.talk
        return v


class AnalysisMeta(BaseModel):
    models_used: list[str] = Field(default_factory=list)
    tokens: int = 0
    confidence_per_dimension: dict[str, float] = Field(default_factory=dict)
    fallback_used: bool = False
    notes: str = ""


class Recipe(BaseModel):
    recipe_id: str = Field(default_factory=lambda: _uid("rcp"))
    project_id: str | None = None
    source_asset_id: str | None = None
    name: str = "Untitled recipe"
    duration_s: float = 0.0
    shot_count: int = 0
    aspect_ratio: str = "9:16"
    beats: list[Beat] = Field(default_factory=list)
    observations: list[str] = Field(default_factory=list)
    hook_transcript: str = ""
    analysis_meta: AnalysisMeta = Field(default_factory=AnalysisMeta)
    created_at: float = Field(default_factory=_now)

    @model_validator(mode="after")
    def _recompute(self) -> "Recipe":
        # Derive duration/shot_count + sequential start offsets from the beats so
        # they can never disagree with the source of truth.
        t = 0.0
        for i, b in enumerate(self.beats):
            b.index = i
            b.start_s = round(t, 3)
            t += b.duration_s
        self.duration_s = round(t, 3)
        if not self.shot_count:
            self.shot_count = len(self.beats)
        return self


# --------------------------------------------------------------------------- #
#  Timeline (the single source of truth)                                       #
# --------------------------------------------------------------------------- #
class StandIn(BaseModel):
    kind: str = "color"  # color | ghost
    color: str = "#7B5CFF"
    label: str = "stand-in"


class Generation(BaseModel):
    tool: str  # generate_broll | generate_text_card | generate_voiceover
    prompt: str = ""
    job_id: str | None = None
    tokens: int = 0


class Slot(BaseModel):
    id: str = Field(default_factory=lambda: _uid("slot"))
    beat_label: str = "Beat"
    type: SlotType
    order: int = 0
    duration_s: float = Field(gt=0)
    source: SlotSource = SlotSource.standin
    asset_id: str | None = None
    standin: StandIn = Field(default_factory=StandIn)
    text: str = ""
    text_role: TextRole = TextRole.none
    style: SlotStyle = Field(default_factory=SlotStyle)
    status: SlotStatus = SlotStatus.ready
    generation: Generation | None = None
    kept: bool = True  # for auto slots: does the creator keep it (=> generate)?

    @property
    def is_you(self) -> bool:
        return self.type in ACTOR_YOU

    @property
    def is_real_footage(self) -> bool:
        return self.source == SlotSource.user_upload

    @model_validator(mode="after")
    def _coerce(self) -> "Slot":
        # A slot with a resolved user asset is the creator's footage and ready.
        if self.asset_id and self.source == SlotSource.standin:
            self.source = SlotSource.user_upload
        return self


class AudioTrack(BaseModel):
    asset_id: str | None = None
    enabled: bool = False
    gain_db: float = 0.0
    tokens: int = 0  # generation tokens spent on this track (e.g. CosyVoice voiceover)


class TimelineAudio(BaseModel):
    voiceover: AudioTrack = Field(default_factory=lambda: AudioTrack(enabled=False))
    bed: AudioTrack = Field(default_factory=lambda: AudioTrack(enabled=False, gain_db=-12.0))


class TokenLedger(BaseModel):
    """Powers the headline metric + on-screen provenance panel. Numbers are real
    (read from the job ledger), never estimates."""

    real_footage_s: float = 0.0
    generated_s: float = 0.0
    standin_s: float = 0.0
    tokens_spent: int = 0
    naive_baseline_tokens: int = 0

    @property
    def total_s(self) -> float:
        return round(self.real_footage_s + self.generated_s + self.standin_s, 3)

    @property
    def real_footage_share(self) -> float:
        t = self.total_s
        return round(self.real_footage_s / t, 4) if t else 0.0

    @property
    def tokens_saved(self) -> int:
        return max(0, self.naive_baseline_tokens - self.tokens_spent)


class MusicSync(BaseModel):
    enabled: bool = False
    bpm: float | None = None
    downbeat_offset_s: float = 0.0


class Timeline(BaseModel):
    timeline_id: str = Field(default_factory=lambda: _uid("tl"))
    project_id: str | None = None
    version: int = 1
    aspect_ratio: str = "9:16"
    fps: int = 30
    audio: TimelineAudio = Field(default_factory=TimelineAudio)
    slots: list[Slot] = Field(default_factory=list)
    token_ledger: TokenLedger = Field(default_factory=TokenLedger)
    music_sync: MusicSync | None = None
    created_at: float = Field(default_factory=_now)

    @property
    def duration_s(self) -> float:
        return round(sum(s.duration_s for s in self.slots), 3)

    @model_validator(mode="after")
    def _reorder(self) -> "Timeline":
        for i, s in enumerate(self.slots):
            s.order = i
        return self
