"""Model-client interfaces + high-fidelity deterministic stubs.

Every model the product touches sits behind an interface here:

    VisionAnalyzer  — Qwen-VL: shots, scenes, on-screen text
    Transcriber     — Paraformer/Qwen-Audio: ASR
    TextLLM         — Qwen-Max: recipe synthesis, co-writing, captions, cover copy
    VideoGen        — Wan: generated b-roll
    ImageGen        — Qwen-Image: text-card backgrounds
    VoiceGen        — CosyVoice: voiceover

`model_backend=stub` (default) returns realistic, fixed data so the whole product
demos offline with zero keys. `model_backend=qwen` swaps in DashScope clients (see
recut/core/qwen_clients.py) — a config flip, not a rewrite.

Stubs are DETERMINISTIC: same input -> same output. That keeps tests stable and the
demo identical every run.
"""

from __future__ import annotations

import hashlib
import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from recut.core.config import Settings, get_settings


# --------------------------------------------------------------------------- #
#  Structured analysis results (model-agnostic)                                #
# --------------------------------------------------------------------------- #
@dataclass
class Shot:
    start_s: float
    end_s: float
    description: str
    on_screen_text: str = ""
    motion: str = "static"  # static | slow | fast-cut


@dataclass
class VisionResult:
    duration_s: float
    shots: list[Shot]
    aspect_ratio: str = "9:16"
    tokens: int = 0
    confidence: float = 0.0


@dataclass
class TranscriptResult:
    text: str
    segments: list[dict] = field(default_factory=list)  # [{start_s, end_s, text}]
    tokens: int = 0
    confidence: float = 0.0


@dataclass
class GenAsset:
    data: bytes
    mime: str
    duration_s: float = 0.0
    tokens: int = 0
    url: str = ""  # provider URL when available (lets a generated still feed i2v directly)


# --------------------------------------------------------------------------- #
#  Interfaces                                                                  #
# --------------------------------------------------------------------------- #
class VisionAnalyzer(ABC):
    @abstractmethod
    def analyze(self, video_path: str, *, hint: str = "") -> VisionResult: ...

    def score_consistency(self, reference: str, candidate: str) -> float:
        """0..1 — does `candidate` (a generated shot keyframe) match `reference` (the
        locked character/location still)? Default no-op (1.0); overridden where it counts."""
        return 1.0


class Transcriber(ABC):
    @abstractmethod
    def transcribe(self, media_path: str) -> TranscriptResult: ...


class TextLLM(ABC):
    @abstractmethod
    def complete(self, system: str, user: str, *, json_mode: bool = False) -> tuple[str, int]:
        """Return (text, tokens)."""


class VideoGen(ABC):
    @abstractmethod
    def generate(self, prompt: str, *, duration_s: float, seed: int = 0) -> GenAsset: ...

    @abstractmethod
    def generate_from_image(
        self, image_url: str, prompt: str, *, duration_s: float, seed: int = 0
    ) -> GenAsset:
        """Image-to-video: animate a reference still (character/location consistency)."""


class ImageGen(ABC):
    @abstractmethod
    def generate(self, prompt: str, *, width: int, height: int) -> GenAsset: ...


class VoiceGen(ABC):
    @abstractmethod
    def synthesize(self, text: str, *, voice: str = "default") -> GenAsset: ...


# --------------------------------------------------------------------------- #
#  Deterministic helpers                                                       #
# --------------------------------------------------------------------------- #
def _seed_from(*parts: str) -> int:
    h = hashlib.sha256("::".join(parts).encode()).hexdigest()
    return int(h[:8], 16)


def _color_clip_png(width: int, height: int, seed: int) -> bytes:
    """Tiny deterministic PNG (solid color from seed). Real generators return MP4/
    PNG bytes; the stub returns a valid 1x1-scaled PNG the render upscales/loops."""
    import struct
    import zlib

    r, g, b = (seed & 255), ((seed >> 8) & 255), ((seed >> 16) & 255)
    # 1x1 RGBA raw -> PNG (render handles scaling). Keep tiny + valid.
    raw = b"\x00" + bytes((r, g, b, 255))

    def chunk(typ: bytes, data: bytes) -> bytes:
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


# --------------------------------------------------------------------------- #
#  Stubs                                                                       #
# --------------------------------------------------------------------------- #
class StubVision(VisionAnalyzer):
    """Returns a realistic fast-cut shot list. The analysis pipeline turns this into
    beats; for the canned demo reference it yields the marble-haul structure."""

    def analyze(self, video_path: str, *, hint: str = "") -> VisionResult:
        shots = [
            Shot(0, 3, "Title card with bold text on a plain background", "Wait till you see what this cost", "static"),
            Shot(3, 7, "A person talking to camera, mid-shot", "", "static"),
            Shot(7, 10, "Handheld shot walking into a large space", "", "slow"),
            Shot(10, 13, "Wide establishing shot of the warehouse, sparks", "", "fast-cut"),
            Shot(13, 15, "A detail shot of a polished marble slab", "", "slow"),
            Shot(15, 20, "A person to camera delivering the payoff", "", "static"),
            Shot(20, 23, "Title card with a call to action on a plain background", "Follow for more", "static"),
        ]
        return VisionResult(duration_s=23.0, shots=shots, tokens=1400, confidence=0.86)

    def score_consistency(self, reference: str, candidate: str) -> float:
        # Deterministic but reference-tied so the consistency-critic path is exercised
        # offline: same reference -> stable high score.
        return 0.86


class StubTranscriber(Transcriber):
    def transcribe(self, media_path: str) -> TranscriptResult:
        text = "Wait till you see what this actually cost. Everyone overpays for this. I went straight to the source. Same thing, a fraction of the price. No middleman. Follow for the list."
        segs = [
            {"start_s": 0, "end_s": 3, "text": "Wait till you see what this actually cost."},
            {"start_s": 3, "end_s": 7, "text": "Everyone overpays for this. I went straight to the source."},
            {"start_s": 15, "end_s": 20, "text": "Same thing, a fraction of the price. No middleman."},
        ]
        return TranscriptResult(text=text, segments=segs, tokens=300, confidence=0.9)


class StubTextLLM(TextLLM):
    """Deterministic LLM. Routes on a marker the pipeline puts in the system prompt
    so co-writing, recipe synthesis, and caption drafting each get sensible canned
    JSON. Real Qwen-Max replaces this with one config flip."""

    def complete(self, system: str, user: str, *, json_mode: bool = False) -> tuple[str, int]:
        marker = system.lower()
        tokens = max(120, (len(system) + len(user)) // 4)
        if "showrunner:treatment" in marker:
            payload = _stub_treatment(user)
        elif "showrunner:critic" in marker:
            payload = _stub_writers_critic()
        elif "showrunner:storyboard" in marker:
            payload = _stub_storyboard(user)
        elif "script-on-beats" in marker:
            payload = _stub_script_on_beats(user)
        elif "caption" in marker or "cover" in marker:
            payload = _stub_caption_cover()
        elif "refine" in marker:
            payload = {"text": "Same slab. Sixty percent less. No middleman."}
        elif "co-writing chat" in marker or "chat" in marker:
            payload = {"text": "Love it — that gap between the expected price and what you paid is your whole hook. What's the single most striking visual from the story?"}
        else:
            payload = {"text": "Drafted."}
        return (json.dumps(payload) if json_mode else payload.get("text", json.dumps(payload)), tokens)


class StubVideoGen(VideoGen):
    def generate(self, prompt: str, *, duration_s: float, seed: int = 0) -> GenAsset:
        s = seed or _seed_from("broll", prompt)
        return GenAsset(data=_color_clip_png(1080, 1920, s), mime="image/png", duration_s=duration_s, tokens=int(duration_s * 1800))

    def generate_from_image(self, image_url: str, prompt: str, *, duration_s: float, seed: int = 0) -> GenAsset:
        # Deterministic: tint derives from the reference url so the "same character" looks
        # stable across shots in stub mode (consistency demo without a key).
        s = seed or _seed_from("i2v", image_url)
        return GenAsset(data=_color_clip_png(1080, 1920, s), mime="image/png", duration_s=duration_s, tokens=int(duration_s * 1800))


class StubImageGen(ImageGen):
    def generate(self, prompt: str, *, width: int, height: int) -> GenAsset:
        s = _seed_from("image", prompt)
        return GenAsset(data=_color_clip_png(width, height, s), mime="image/png", tokens=250)


class StubVoiceGen(VoiceGen):
    def synthesize(self, text: str, *, voice: str = "default") -> GenAsset:
        # Deterministic silent WAV sized to ~ the spoken length (0.06s/char, clamped).
        dur = min(20.0, max(1.0, len(text) * 0.06))
        return GenAsset(data=_silent_wav(dur), mime="audio/wav", duration_s=dur, tokens=len(text))


def _silent_wav(duration_s: float, sample_rate: int = 16000) -> bytes:
    import struct

    n = int(duration_s * sample_rate)
    data = b"\x00\x00" * n
    return (
        b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE"
        b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16)
        + b"data" + struct.pack("<I", len(data)) + data
    )


def _stub_script_on_beats(user: str) -> dict:
    lines = [
        "I saved 60% on marble. Here's how.",
        "Everyone overpays for stone. So I went straight to the source.",
        "Walking onto the Foshan factory floor",
        "Slabs on the saw line — sparks, the scale of the warehouse",
        "Close-up — hand across the polished slab",
        "Same slab. Sixty percent less. No middleman.",
        "Follow for the supplier list →",
    ]
    return {"beats": [{"index": i, "text": t} for i, t in enumerate(lines)]}


def _stub_treatment(user: str) -> dict:
    """A coherent canned micro-drama so the whole Showrunner flow demos offline."""
    return {
        "title": "Last Call",
        "logline": "A weary detective realizes the partner she trusts is the killer she's hunted all night.",
        "characters": [
            {"name": "Mara", "description": "late-30s detective, sharp eyes, rumpled grey coat, exhausted", "role": "protagonist", "voice": "longxiaochun_v2"},
            {"name": "Vince", "description": "40s detective, easy smile that never reaches his eyes, dark suit", "role": "antagonist", "voice": "longshu_v2"},
        ],
        "locations": [
            {"name": "Precinct office", "description": "cramped night-shift detective's office, venetian-blind shadows, one desk lamp"},
            {"name": "Rain-slick alley", "description": "narrow alley behind the precinct, neon reflections in puddles, midnight"},
        ],
        "scenes": [
            {"heading": "INT. PRECINCT OFFICE - NIGHT", "summary": "Mara connects the last clue and understands who did it."},
            {"heading": "INT. PRECINCT OFFICE - NIGHT", "summary": "Vince enters; the air shifts as Mara hides what she knows."},
            {"heading": "EXT. RAIN-SLICK ALLEY - NIGHT", "summary": "The confrontation: Mara accuses Vince, the truth lands."},
        ],
    }


def _stub_writers_critic() -> dict:
    return {
        "notes": "Strong hook, but raise the stakes in scene 2 — give Mara something to lose if Vince realizes she knows. Tighten the reveal so the betrayal is earned, not stated.",
        "score": 0.74,
    }


def _stub_storyboard(user: str) -> dict:
    return {
        "shots": [
            {"action": "Mara hunched over a desk, pinning a photo to the evidence board, lamp light on her face", "shot_type": "medium", "camera": "push_in", "duration_s": 4, "character_names": ["Mara"], "location_name": "Precinct office", "dialogue": [], "narration": "Every case leaves a thread. This one led home."},
            {"action": "Insert: the photo — two detectives shaking hands, one face circled in red", "shot_type": "insert", "camera": "static", "duration_s": 3, "character_names": [], "location_name": "Precinct office", "dialogue": [], "narration": "It was someone she trusted."},
            {"action": "Mara turns sharply as a shadow falls across the doorway", "shot_type": "close_up", "camera": "handheld", "duration_s": 3, "character_names": ["Mara"], "location_name": "Precinct office", "dialogue": [{"character": "Mara", "line": "You're working late."}], "narration": ""},
        ]
    }


def _stub_caption_cover() -> dict:
    return {
        "caption": "I stopped paying showroom prices for marble. Flew to Foshan and bought the same slabs straight from the factory — about 60% less. Here's exactly how 👇",
        "hashtags": ["#renovation", "#interiordesign", "#marble", "#sourcing", "#factorydirect", "#homereno", "#designtips"],
        "covers": [
            {"id": "claim", "label": "Bold claim", "big": "60% OFF", "small": "MARBLE, DIRECT FROM THE FACTORY"},
            {"id": "face", "label": "Face + caption", "big": "I went to\nthe source", "small": "FOSHAN SOURCING TRIP"},
            {"id": "split", "label": "Before / after", "big": "$$$ → $", "small": "WHAT MIDDLEMEN DON'T TELL YOU"},
        ],
    }


# --------------------------------------------------------------------------- #
#  Registry                                                                    #
# --------------------------------------------------------------------------- #
@dataclass
class ModelClients:
    vision: VisionAnalyzer
    transcriber: Transcriber
    text: TextLLM
    video: VideoGen
    image: ImageGen
    voice: VoiceGen


def get_models(settings: Settings | None = None) -> ModelClients:
    s = settings or get_settings()
    if s.model_backend == "qwen":
        from recut.core.qwen_clients import build_qwen_clients

        return build_qwen_clients(s)
    return ModelClients(
        vision=StubVision(),
        transcriber=StubTranscriber(),
        text=StubTextLLM(),
        video=StubVideoGen(),
        image=StubImageGen(),
        voice=StubVoiceGen(),
    )
