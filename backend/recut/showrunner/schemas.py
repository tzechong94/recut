"""Drama domain — the AI Showrunner's canonical data model.

A Production is the film. It holds a locked visual Style, a cast of Characters and a set
of Locations (each with a consistency reference image), and a Script of Scenes, each
broken into Shots. Shots are the unit of generation; they compile down to the existing
render Timeline (recut.core.schemas.Timeline) so the validated ffmpeg render engine is
reused unchanged.

Stage machine (one elegant flow, human-approved at each gate)::

    premise ─▶ script ─▶ cast_style ─▶ storyboard ─▶ [APPROVE] ─▶ production ─▶ export
       │         │           │             │                          │           │
    Qwen-Max  writers'   gen/upload     shot list                 Wan i2v/t2v   ffmpeg
              room       refs+style                               +critic+voice

Everything before "production" is cheap (text/image) and human-approved, so no expensive
video tokens are spent on an unapproved plan (the token-budget discipline).
"""

from __future__ import annotations

import time
import uuid
from enum import Enum

from pydantic import BaseModel, Field, model_validator


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _now() -> float:
    return time.time()


class Stage(str, Enum):
    premise = "premise"
    script = "script"
    cast_style = "cast_style"
    storyboard = "storyboard"
    production = "production"
    export = "export"


class AssetSource(str, Enum):
    none = "none"
    generated = "generated"  # AI-generated (text-to-image)
    uploaded = "uploaded"  # the human supplied / cast their own
    standin = "standin"  # placeholder so the cut plays before generation


class ShotStatus(str, Enum):
    planned = "planned"  # in the storyboard, not generated
    standin = "standin"  # placeholder clip
    generating = "generating"
    ready = "ready"  # generated/uploaded video resolved
    failed = "failed"


class ShotType(str, Enum):
    wide = "wide"  # establishing
    medium = "medium"
    close = "close_up"
    insert = "insert"  # detail / b-roll
    two_shot = "two_shot"


class CameraMove(str, Enum):
    static = "static"
    pan = "pan"
    push_in = "push_in"
    pull_out = "pull_out"
    handheld = "handheld"
    aerial = "aerial"


# --------------------------------------------------------------------------- #
#  Style                                                                       #
# --------------------------------------------------------------------------- #
class StyleLock(BaseModel):
    """The locked visual style applied to EVERY reference + shot. Stylization is both a
    differentiator and a consistency aid (stylized looks hide model drift)."""

    name: str = "cinematic"  # noir | anime | claymation | storybook | cinematic | ...
    descriptors: str = "cinematic, filmic lighting, shallow depth of field"
    palette: str = ""  # optional color guidance
    locked: bool = False

    def prompt_suffix(self) -> str:
        bits = [self.descriptors]
        if self.palette:
            bits.append(self.palette)
        return ", ".join(b for b in bits if b)


STYLE_PRESETS: dict[str, StyleLock] = {
    "noir": StyleLock(name="noir", descriptors="film noir, high-contrast black and white, hard shadows, 1940s detective film, dramatic chiaroscuro", palette="monochrome"),
    "anime": StyleLock(name="anime", descriptors="anime cel-shaded, vibrant, expressive, studio-quality 2D animation", palette="saturated"),
    "claymation": StyleLock(name="claymation", descriptors="claymation stop-motion, handmade clay figures, tactile, soft studio light", palette="warm earthy"),
    "storybook": StyleLock(name="storybook", descriptors="painterly children's storybook illustration, soft watercolor, whimsical", palette="pastel"),
    "cinematic": StyleLock(name="cinematic", descriptors="cinematic live-action, filmic lighting, shallow depth of field, anamorphic", palette=""),
    "pixar": StyleLock(name="pixar", descriptors="3D animated feature film, expressive characters, polished lighting", palette="vivid"),
}


# --------------------------------------------------------------------------- #
#  Cast + locations (the consistency "show bible")                             #
# --------------------------------------------------------------------------- #
class Character(BaseModel):
    id: str = Field(default_factory=lambda: _uid("char"))
    name: str
    description: str = ""  # appearance + wardrobe; drives the reference image prompt
    role: str = ""  # protagonist / antagonist / supporting
    want: str = ""  # dramatic want (what they pursue) — gives the character an arc
    flaw: str = ""  # the flaw/obstacle that creates conflict
    reference_asset_id: str | None = None  # stored reference still (consistency anchor)
    reference_url: str | None = None  # direct URL usable by Wan i2v (e.g. DashScope/OSS)
    source: AssetSource = AssetSource.none
    locked: bool = False
    voice: str = "longxiaochun_v2"  # CosyVoice voice id for this character's dialogue


class Location(BaseModel):
    id: str = Field(default_factory=lambda: _uid("loc"))
    name: str
    description: str = ""
    reference_asset_id: str | None = None
    reference_url: str | None = None
    source: AssetSource = AssetSource.none
    locked: bool = False


# --------------------------------------------------------------------------- #
#  Script: scenes + shots                                                      #
# --------------------------------------------------------------------------- #
class DialogueLine(BaseModel):
    character_id: str | None = None
    character_name: str = ""  # denormalized for display + caption
    line: str = ""


class Shot(BaseModel):
    id: str = Field(default_factory=lambda: _uid("shot"))
    index: int = 0
    shot_type: ShotType = ShotType.medium
    camera: CameraMove = CameraMove.static
    action: str = ""  # the VISUAL description — drives the i2v/t2v prompt
    dialogue: list[DialogueLine] = Field(default_factory=list)
    narration: str = ""  # voiceover narration over this shot
    character_ids: list[str] = Field(default_factory=list)
    location_id: str | None = None
    duration_s: float = Field(default=4.0, gt=0)

    # shot-board still — the exact first frame the film animates (approved by the human
    # on the board, cheap image tokens; produce i2v's THIS frame, never a surprise)
    keyframe_asset_id: str | None = None
    keyframe_url: str | None = None
    # signature of the filmable fields at still time; a mismatch = the still is STALE
    keyframe_sig: str = ""

    # production state
    source: AssetSource = AssetSource.standin
    asset_id: str | None = None  # generated/uploaded video clip
    status: ShotStatus = ShotStatus.planned
    gen_prompt: str = ""  # the exact prompt sent to the video model
    gen_tool: str = ""  # generate_shot_i2v | generate_shot_t2v | upload
    tokens: int = 0
    critic_score: float | None = None  # consistency-critic score 0..1
    reroll_count: int = 0

    @property
    def caption(self) -> str:
        """What burns on screen: speaker-attributed dialogue ('NAME: line' per line), else
        narration. Attribution is the drama — the viewer must know who's speaking."""
        if self.dialogue:
            lines = []
            for d in self.dialogue:
                if not d.line:
                    continue
                lines.append(f"{d.character_name}: {d.line}" if d.character_name else d.line)
            if lines:
                return "\n".join(lines)
        return self.narration.strip()


class Scene(BaseModel):
    id: str = Field(default_factory=lambda: _uid("scene"))
    index: int = 0
    heading: str = ""  # e.g. "INT. DETECTIVE'S OFFICE - NIGHT"
    summary: str = ""  # one-line beat: what happens, why it matters
    script: list[DialogueLine] = Field(default_factory=list)  # the WRITTEN, critiqued dialogue
    shots: list[Shot] = Field(default_factory=list)

    @model_validator(mode="after")
    def _reindex(self) -> "Scene":
        for i, s in enumerate(self.shots):
            s.index = i
        return self


# --------------------------------------------------------------------------- #
#  Token ledger (quality-per-token scoreboard)                                 #
# --------------------------------------------------------------------------- #
class TokenLedger(BaseModel):
    text_tokens: int = 0  # writers' room, storyboard, etc (cheap)
    image_tokens: int = 0  # reference stills
    video_tokens: int = 0  # Wan shots (expensive)
    voice_tokens: int = 0
    rerolls: int = 0  # consistency-critic re-generations

    @property
    def total(self) -> int:
        return self.text_tokens + self.image_tokens + self.video_tokens + self.voice_tokens

    def naive_baseline(self, n_shots: int, avg_shot_s: float) -> int:
        """ESTIMATE of a no-discipline workflow: generate every shot, then regenerate the
        whole film ~twice during iteration because there's no plan-lock and no targeted
        critic (you re-roll blindly). Reported as a labeled estimate, not a hard claim —
        the defensible facts are 0-video-tokens-pre-approval and targeted re-rolls."""
        return int(n_shots * avg_shot_s * 1800 * 2) + 3000


# --------------------------------------------------------------------------- #
#  Production (the film)                                                        #
# --------------------------------------------------------------------------- #
class Production(BaseModel):
    id: str = Field(default_factory=lambda: _uid("prod"))
    project_id: str | None = None
    premise: str = ""
    logline: str = ""
    title: str = "Untitled"
    dramatic_question: str = ""  # the question the film answers (drives structure)
    theme: str = ""
    target_seconds: int = 60
    stage: Stage = Stage.premise
    style: StyleLock = Field(default_factory=lambda: STYLE_PRESETS["cinematic"].model_copy())
    characters: list[Character] = Field(default_factory=list)
    locations: list[Location] = Field(default_factory=list)
    scenes: list[Scene] = Field(default_factory=list)
    token_ledger: TokenLedger = Field(default_factory=TokenLedger)
    writers_room: list[dict] = Field(default_factory=list)  # transcript [{role, text}]
    director_log: list[dict] = Field(default_factory=list)  # [{shot, decision, reason}] — visible agent reasoning
    warnings: list[str] = Field(default_factory=list)  # surfaced non-fatal issues (dropped scene, etc.)
    export_asset_id: str | None = None  # the finished film (set on produce; for revisits)
    # serialized micro-drama: episode N continues the previous production's cliffhanger,
    # reusing its LOCKED cast + location references (identity is free across episodes)
    episode: int = 1
    previous_production_id: str | None = None
    version: int = 1
    created_at: float = Field(default_factory=_now)

    # ---- convenience ----
    @property
    def shots(self) -> list[Shot]:
        return [sh for sc in self.scenes for sh in sc.shots]

    @property
    def duration_s(self) -> float:
        return round(sum(sh.duration_s for sh in self.shots), 3)

    def character(self, cid: str) -> Character | None:
        return next((c for c in self.characters if c.id == cid), None)

    def location(self, lid: str) -> Location | None:
        return next((loc for loc in self.locations if loc.id == lid), None)

    def find_shot(self, shot_id: str) -> Shot | None:
        return next((sh for sh in self.shots if sh.id == shot_id), None)

    @model_validator(mode="after")
    def _reindex(self) -> "Production":
        for i, sc in enumerate(self.scenes):
            sc.index = i
        return self
