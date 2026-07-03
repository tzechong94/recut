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
    differentiator and a consistency aid (stylized looks hide model drift).

    A style is either a PRESET (name from STYLE_PRESETS) or CUSTOM — distilled from the
    user's own description and/or reference images (LTX-style 'style element'). When
    `reference_urls` holds a hosted image, it also ANCHORS every keyframe composition,
    so the film inherits the actual look, not a text paraphrase of it. `tone` decouples
    the writing register from the visuals (a claymation thriller stays a thriller)."""

    name: str = "cinematic"  # preset name, or "custom"
    descriptors: str = "cinematic, filmic lighting, shallow depth of field"
    palette: str = ""  # optional color guidance
    tone: str = ""  # writing register override: thriller | heartfelt | comedy | ... ("" = match style)
    reference_urls: list[str] = Field(default_factory=list)  # custom-style anchor images
    locked: bool = False

    def prompt_suffix(self) -> str:
        bits = [self.descriptors]
        if self.palette:
            bits.append(self.palette)
        return ", ".join(b for b in bits if b)


STYLE_PRESETS: dict[str, StyleLock] = {
    "cinematic": StyleLock(name="cinematic", descriptors="cinematic live-action, filmic lighting, shallow depth of field, anamorphic", palette=""),
    "noir": StyleLock(name="noir", descriptors="film noir, high-contrast black and white, hard shadows, 1940s detective film, dramatic chiaroscuro", palette="monochrome"),
    "anime": StyleLock(name="anime", descriptors="anime cel-shaded, vibrant, expressive, studio-quality 2D animation", palette="saturated"),
    "claymation": StyleLock(name="claymation", descriptors="claymation stop-motion, handmade clay figures, tactile, soft studio light", palette="warm earthy"),
    "storybook": StyleLock(name="storybook", descriptors="painterly children's storybook illustration, soft watercolor, whimsical", palette="pastel"),
    "pixar": StyleLock(name="pixar", descriptors="3D animated feature film, expressive characters, polished lighting", palette="vivid"),
    "ghibli": StyleLock(name="ghibli", descriptors="hand-painted 2D anime film, lush painterly watercolor backgrounds, soft natural light, wind-swept grass and clouds, gentle nostalgic warmth", palette="verdant greens, sky blue, warm cream"),
    "ink_wash": StyleLock(name="ink_wash", descriptors="traditional Chinese ink wash painting (shuimo), flowing brushstrokes, negative space, misty gradients", palette="black ink on rice paper, sparse red accents"),
    "comic": StyleLock(name="comic", descriptors="graphic novel panel art, bold ink outlines, halftone shading, dramatic panel lighting", palette="high-contrast primaries"),
    "pixel": StyleLock(name="pixel", descriptors="detailed pixel art, 32-bit era, dithered gradients, crisp sprite work", palette="limited retro palette"),
    "cyberpunk": StyleLock(name="cyberpunk", descriptors="neon-drenched cyberpunk, rain-slick streets, holographic signage, cinematic haze", palette="teal, magenta and sodium orange"),
    "retro_film": StyleLock(name="retro_film", descriptors="1970s film stock, warm halation, visible grain, sun-faded Kodachrome road movie", palette="amber, avocado, dust"),
    "paper_craft": StyleLock(name="paper_craft", descriptors="layered paper-cut diorama, visible card edges, soft shadow depth, handmade texture", palette="muted construction-paper tones"),
}

# Writing-register TONES, decoupled from the visual style ("" = match the style's default).
TONE_REGISTERS: dict[str, str] = {
    "brainrot": (
        "Absurdist meme-brainrot: anthropomorphic objects/foods/animals in dead-serious "
        "high-stakes drama (gym rivalries, betrayal at the smoothie bar, forbidden love "
        "across the produce aisle). Deadpan sincerity about ridiculous stakes — the comedy "
        "IS the commitment. Punchy meme cadence, unhinged reveals, zero winking at camera. "
        "Characters MUST be non-human things with one absurd defining trait each."
    ),
    "melodrama": (
        "ReelShort-style melodrama: secret identities, revenge, a contract with a cruel "
        "clause, the despised one is secretly powerful. Big emotions played straight, "
        "gasp-worthy reveals, every scene ends on a slap or a bombshell."
    ),
    "thriller": "Tense and propulsive: short lines, rising dread, information used as a weapon.",
    "mystery": "A puzzle with teeth: every scene plants or pays a clue; the answer recontextualizes everything.",
    "comedy": "Dry, quick, character-driven humor; jokes come from want vs flaw, never puns.",
    "romance": "Charged subtext, near-misses, what's unsaid matters more than what's said.",
    "horror": "Creeping wrongness: the mundane turns hostile, dread over gore, the last shot lingers.",
    "heartfelt": "Warm and sincere: small human details, earned feeling, no cynicism.",
    "tragic": "Weighty and inevitable: choices cost, silences speak, no rescue arrives.",
    "hopeful": "Against-the-odds warmth: hard circumstances, stubborn light, an ending that lifts.",
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
    # VL-described visual anchors of the LOCKED reference ("red scarf, grey coat") —
    # injected into every keyframe compose so the model knows what must not drift
    identity_notes: str = ""
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


def caption_fingerprint(caption: str) -> str:
    """Stable fingerprint of the spoken text a take was filmed with — an edited line
    makes existing takes visibly STALE (never silently refilmed)."""
    import hashlib

    return hashlib.sha256(caption.strip().encode()).hexdigest()[:12]


class Take(BaseModel):
    """One generation of a shot — PERMANENT. The chosen take is the sole video source
    for its slot; nothing ever replaces it implicitly (the fidelity contract).
    model/seed are None for takes backfilled from pre-takes productions."""

    id: str = Field(default_factory=lambda: _uid("take"))
    asset_id: str
    model: str | None = None
    seed: int | None = None
    duration_s: float = 5.0
    audio_kind: str = "silent"  # native (speech in-clip) | tts (VO at render) | silent
    # staleness anchors: what this take was filmed FROM
    keyframe_asset_id: str | None = None  # identity — fires on still REGENERATION
    keyframe_sig: str = ""  # filmable-field drift
    caption_hash: str = ""  # edited line
    critic_score: float | None = None
    note: str = ""  # the retake instruction that produced this take ("" = plain)
    created_at: float = Field(default_factory=_now)


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

    # THE FIDELITY CONTRACT: every generation appends a Take; the chosen take is the
    # sole video source for this shot's slot and is never replaced implicitly.
    takes: list[Take] = Field(default_factory=list)
    chosen_take_id: str | None = None

    # shot-board still — the exact first frame the film animates (approved by the human
    # on the board, cheap image tokens; produce i2v's THIS frame, never a surprise)
    keyframe_asset_id: str | None = None
    keyframe_url: str | None = None
    # signature of the filmable fields at still time; a mismatch = the still is STALE
    keyframe_sig: str = ""
    # still-gate scores: identity/setting drift is caught HERE at image price,
    # before any video token is spent (min of the two gates the still)
    keyframe_score: float | None = None
    setting_score: float | None = None

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
        """What burns on screen AND what the voice speaks: the dialogue lines only.
        NO speaker names (TTS must never verbalize 'Eliza:' — the voice and lip-sync
        attribute the speaker) and NO narration (dialogue-only format: a shot without
        a line is a silent beat)."""
        return " ".join(d.line.strip() for d in self.dialogue if d.line.strip())


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
    rerolls: int = 0  # VIDEO re-rolls (drift that survived to the expensive tier)
    still_rerolls: int = 0  # drift caught at IMAGE price by the still gate (~50× cheaper)

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
    # TEST MODE: the entire flow runs on deterministic stubs — walk every stage,
    # spend zero provider tokens. Set at creation, carried into next episodes.
    test_mode: bool = False
    # MODE (per-shot routing underneath): "draft" routes silent shots to the cheap
    # flash model, "ship" to the plus model; SPEAKING shots film on the dialogue
    # model in BOTH modes (the pilot pass is the cheap dialogue rehearsal). Legacy
    # values "final"/"happyhorse" upgrade to "ship" on read.
    video_quality: str = "draft"
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

    @model_validator(mode="after")
    def _upgrade_legacy(self) -> "Production":
        """Upgrade-on-read migration (JSON doc store, no Alembic): legacy quality tiers
        map onto draft|ship, and a pre-takes shot's single asset becomes ONE chosen
        take — WITHOUT the chosen flag, the new produce predicate would re-film every
        legacy shot on day one. Idempotent: only fires when takes is empty."""
        legacy_quality = self.video_quality
        if legacy_quality in ("final", "happyhorse"):
            self.video_quality = "ship"
        for sc in self.scenes:
            for sh in sc.shots:
                if sh.asset_id and not sh.takes:
                    if legacy_quality == "happyhorse" and sh.dialogue:
                        audio = "native"
                    elif sh.caption:
                        audio = "tts"
                    else:
                        audio = "silent"
                    take = Take(
                        asset_id=sh.asset_id, model=None, seed=None,
                        duration_s=sh.duration_s, audio_kind=audio,
                        keyframe_asset_id=sh.keyframe_asset_id, keyframe_sig=sh.keyframe_sig,
                        caption_hash=caption_fingerprint(sh.caption),
                        critic_score=sh.critic_score,
                    )
                    sh.takes = [take]
                    sh.chosen_take_id = take.id
        return self
