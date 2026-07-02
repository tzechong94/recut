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


@dataclass
class ConsistencyVerdict:
    """The consistency critic's read of a generated shot vs its locked reference.
    score=None means the critic was unavailable (skip — never silently pass drift)."""

    score: float | None
    reason: str = ""


# --------------------------------------------------------------------------- #
#  Interfaces                                                                  #
# --------------------------------------------------------------------------- #
class VisionAnalyzer(ABC):
    @abstractmethod
    def analyze(self, video_path: str, *, hint: str = "") -> VisionResult: ...

    def score_consistency(self, reference: str, candidate: str) -> "ConsistencyVerdict":
        """Does `candidate` (a generated shot keyframe) match `reference` (the locked
        character/location still)? Default = unavailable (skip); overridden where it counts."""
        return ConsistencyVerdict(score=None, reason="critic not available")


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

    def edit(self, image_url: "str | list[str]", instruction: str) -> GenAsset:
        """Identity-preserving edit/compose: keep the SUBJECT(s) of the input image(s) (same
        face, wardrobe, art style — and, with two images, the same LOCATION) but recompose
        per `instruction`. Used to build a per-shot keyframe that puts the locked character
        INTO the locked location before image-to-video. Pass one URL (character) or a list
        [character, location plate] to lock both. Backends without an edit model fall back to
        a fresh generate(); the live Qwen backend overrides this with qwen-image-edit."""
        return self.generate(instruction, width=720, height=1280)


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

    def score_consistency(self, reference: str, candidate: str) -> ConsistencyVerdict:
        # Deterministic offline critic. The first candidate for a reference scores a bit
        # low (so the re-roll path is exercised in the demo/tests); re-rolls (different
        # candidate keyframe) score high — proving re-roll actually improves the shot.
        base = 0.55 if "_a0" in candidate or candidate.endswith("0.png") else 0.85
        return ConsistencyVerdict(score=base, reason="stub: minor wardrobe drift" if base < 0.6 else "stub: consistent")


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
        if "showrunner:treatment reviser" in marker:
            # The reviser must ECHO the draft it was handed (improved in spirit), not
            # invent a new story — otherwise the premise-seeded draft gets replaced.
            payload = _stub_embedded_json(user) or _stub_treatment(user)
        elif "showrunner:treatment" in marker:
            payload = _stub_treatment(user)
        elif "showrunner:critic" in marker:
            payload = _stub_writers_critic(user)
        elif "showrunner:revise" in marker:
            # Offline: echo the existing treatment with a small marked tweak so the
            # revise flow is exercised; live Qwen honors the actual note.
            t = _stub_treatment(user)
            t["title"] = t["title"] + " (revised)"
            payload = t
        elif "showrunner:premise" in marker:
            if "refine" in user.lower():
                payload = {"premise": "A burnt-out detective must decide whether to expose the partner who once saved her life."}
            else:
                payload = {"premise": "A lonely radio operator starts hearing tomorrow's news a day early — and one broadcast names her."}
        elif "showrunner:dialogue-critic" in marker:
            payload = {"scores": {"dialogue_quality": 0.82, "subtext": 0.78, "distinct_voices": 0.8}, "overall": 0.8, "notes": "Lines carry subtext; voices distinct."}
        elif "showrunner:dialogue" in marker:
            payload = _stub_dialogue(user)
        elif "showrunner:rubric" in marker:
            payload = _stub_rubric()
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


_STUB_STOP = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "must",
    "who", "that", "their", "her", "his", "its", "before", "across", "into", "from",
    "at", "by", "is", "are", "was", "were", "has", "have", "she", "he", "they",
    # premise-common verbs — a title like "Discovers & Ashes" is nobody's film
    "discovers", "discover", "realizes", "realises", "becomes", "finds", "hears",
    "learns", "decides", "starts", "begins", "receives", "delivers", "every",
}


def _stub_embedded_json(user: str) -> dict | None:
    """The JSON document embedded in a prompt (reviser flows pass the draft back in)."""
    start, end = user.find("{"), user.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        doc = json.loads(user[start : end + 1])
        return doc if isinstance(doc, dict) and doc.get("scenes") else None
    except Exception:  # noqa: BLE001
        return None


def _stub_rng(*parts: str):
    """Deterministic RNG seeded on the prompt — same input, same output (tests stay
    stable); different premise/scene, different story (test mode isn't repetitive)."""
    import hashlib
    import random

    h = hashlib.sha256("|".join(parts).encode()).digest()
    return random.Random(int.from_bytes(h[:8], "big"))


def _stub_topic(text: str) -> str:
    words = [w.strip(".,!?'\"—–-:;").lower() for w in text.split()]
    cands = [w for w in words if len(w) > 4 and w.isalpha() and w not in _STUB_STOP]
    return max(cands, key=len) if cands else "reckoning"


def _stub_names(user: str, label: str) -> list[str]:
    """Character names from a 'CAST:'/'CHARACTERS:' prompt line — 'Name (details…)'."""
    import re

    m = re.search(rf"{label}:\s*(.+)", user)
    if not m:
        return []
    return re.findall(r"([A-Z][\w'-]*(?: [A-Z][\w'-]*)?)\s*\(", m.group(1))


def _stub_treatment(user: str) -> dict:
    """A premise-seeded micro-drama so test mode reads like a real (varied) script,
    not the same canned story every time. Deterministic per premise."""
    import re

    m = re.search(r"PREMISE:\s*(.+)", user)
    premise = (m.group(1).strip().splitlines()[0] if m else user.strip().splitlines()[0] if user.strip() else "a secret comes due")
    rng = _stub_rng("treatment", premise)
    topic = _stub_topic(premise)

    # A series continuation names its RETURNING CAST/LOCATIONS — honor them exactly,
    # the way the live model is instructed to (episode 2 keeps the same faces + sets).
    returning = re.search(r"RETURNING CAST[^:]*:\s*(.+?)(?:\s*RETURNING LOCATIONS|$)", premise)
    returning_pairs = (re.findall(r"([A-Z][\w'-]*(?: [A-Z][\w'-]*)?)\s*\(([^)]*)\)", returning.group(1))
                       if returning else [])
    ret_locs = re.search(r"RETURNING LOCATIONS[^:]*:\s*(.+)$", premise)
    ret_loc_names = ([x.strip().rstrip(".") for x in ret_locs.group(1).split(",") if x.strip()]
                     if ret_locs else [])
    cliff = re.search(r"cliffhanger:\s*(.+?)(?:\s*Pick up|$)", premise)
    hook_frag = (cliff.group(1) if cliff else premise)[:90].rstrip(".")

    prot = rng.choice(["Mara", "Eli", "Noor", "Ivy", "Jonas", "Ada", "Theo", "Lena"])
    ant = rng.choice(["Vince", "Silas", "Petra", "Hale", "Rook", "Junia", "Marlow", "Odile"])
    prot_desc = rng.choice([
        "late-30s, sharp eyes, a coat that's seen weather, runs on black coffee",
        "mid-20s, quick hands, patched jacket, hides worry behind jokes",
        "50s, silver-streaked hair, deliberate movements, misses nothing",
        "30s, wiry, ink-stained fingers, always half-turned toward the exit",
    ])
    ant_desc = rng.choice([
        "an easy smile that never reaches the eyes, immaculate dark clothes",
        "soft-spoken, unhurried, the calm of someone who's already won",
        "charming in daylight, unreadable after dark, a ring they keep turning",
        "brisk and generous with favors that always come due",
    ])
    want = rng.choice([
        f"to finish what the {topic} started",
        f"to keep the {topic} from surfacing",
        "to get out clean, just this once",
        "to protect the one person who never asked why",
    ])
    flaw = rng.choice([
        "loyalty that blinds them", "pride that won't fold", "a debt they never mention",
        "the habit of carrying everything alone",
    ])
    if returning_pairs:
        prot, prot_desc = returning_pairs[0]
        if len(returning_pairs) > 1:
            ant, ant_desc = returning_pairs[1]
    loc1, loc2 = rng.sample([
        {"name": "Night market", "description": "narrow stalls, paper lanterns, steam and neon, crowds thinning"},
        {"name": "Rooftop greenhouse", "description": "cracked glass panes, overgrown planters, city lights below"},
        {"name": "Ferry terminal", "description": "flickering departure board, wet concrete, the last boat idling"},
        {"name": "Back-alley workshop", "description": "workbench clutter, one hanging bulb, shutters half down"},
        {"name": "All-night diner", "description": "vinyl booths, buzzing sign, coffee rings on formica"},
        {"name": "Rain-slick alley", "description": "neon reflections in puddles, fire escapes, midnight"},
    ], 2)
    if ret_loc_names:
        loc1 = {"name": ret_loc_names[0], "description": loc1["description"]}
        if len(ret_loc_names) > 1:
            loc2 = {"name": ret_loc_names[1], "description": loc2["description"]}
    title = rng.choice([
        f"The {topic.title()}", f"{topic.title()} at Midnight", f"After the {topic.title()}",
        f"The Last {topic.title()}", f"{topic.title()} & Ashes",
    ])
    logline = premise[0].upper() + premise[1:].rstrip(".") + "."
    return {
        "title": title,
        "logline": logline,
        "dramatic_question": rng.choice([
            f"Will {prot} pay what the {topic} costs?",
            f"Can {prot} stop {ant} without becoming them?",
            f"Does {prot} choose the truth or the person?",
        ]),
        "theme": rng.choice([
            f"The {topic} you bury digs itself out.",
            "Trust is the most expensive thing a person can spend.",
            "You can outrun anything except what you owe.",
        ]),
        "characters": [
            {"name": prot, "description": prot_desc, "role": "protagonist", "want": want, "flaw": flaw},
            {"name": ant, "description": ant_desc, "role": "antagonist",
             "want": rng.choice(["to bury the evidence and walk away", f"to own the {topic} outright", "to be owed by everyone"]),
             "flaw": rng.choice(["believes they're owed it", "can't leave a loose end", "mistakes fear for respect"])},
        ],
        "locations": [loc1, loc2],
        "scenes": [
            {"heading": f"INT. {loc1['name'].upper()} - NIGHT",
             "summary": f"Hook: {hook_frag} — {prot} is already in too deep when {ant} appears."},
            {"heading": f"EXT. {loc2['name'].upper()} - NIGHT",
             "summary": f"{ant} gets too close; {prot} hides what the {topic} really cost, and the lie shows."},
            {"heading": f"INT. {loc1['name'].upper()} - LATER",
             "summary": f"Cliffhanger: {prot} confronts {ant} — and learns the {topic} was never the point."},
        ],
    }


def _stub_dialogue(user: str) -> dict:
    """Scene-seeded dialogue: different lines per scene, attributed to the ACTUAL cast
    named in the prompt (so speaker mapping works downstream)."""
    import re

    names = _stub_names(user, "CHARACTERS") or ["", ""]
    a = names[0]
    b = names[1] if len(names) > 1 else names[0]
    sm = re.search(r"SCENE:.*?—\s*(.+)", user)
    summary = sm.group(1) if sm else user
    topic = _stub_topic(summary)
    rng = _stub_rng("dialogue", user)
    exchange = rng.choice([
        [(a, f"You knew about the {topic}."), (b, "I knew enough to keep you out of it."), (a, "That wasn't your call.")],
        [(b, "Walk away. While it's still a choice."), (a, "It stopped being a choice last night."), (b, "Then it stops being my problem.")],
        [(a, "Say it to my face."), (b, f"The {topic} was gone before you ever got there."), (a, "Then whose hands took it?")],
        [(b, "You look like you haven't slept."), (a, f"The {topic} doesn't sleep. Why should I?"), (b, "Because tomorrow it gets worse.")],
        [(a, "One truth. That's all I'm asking."), (b, "You couldn't carry one of mine."), (a, "Try me.")],
        [(b, "We had a deal."), (a, "You had a deal. I had a debt."), (b, f"Same thing, where the {topic} is concerned.")],
    ])
    return {"lines": [{"character": c, "line": ln} for c, ln in exchange]}


def _stub_writers_critic(user: str = "") -> dict:
    # Score climbs across rounds so the demo shows the writers' room actually improving.
    import re

    m = re.search(r"ROUND (\d+)", user)
    rnd = int(m.group(1)) if m else 1
    score = min(0.9, 0.6 + 0.12 * rnd)
    notes = {
        1: "Strong hook, but the protagonist has no clear arc and the midpoint turn is missing. Give them something concrete to lose if the antagonist realizes what they know.",
        2: "Better. Now sharpen the climax — the betrayal should be shown through action, not stated. Tighten the antagonist's want.",
    }.get(rnd, "Solid structure and arc; the dramatic question lands. Ship it.")
    return {"notes": notes, "score": round(score, 2)}


def _stub_storyboard(user: str) -> dict:
    """Scene-seeded shots built from the ACTUAL cast/location/summary in the prompt —
    every scene boards differently, and character names map to real cast ids."""
    import re

    names = _stub_names(user, "CAST")
    lead = names[0] if names else ""
    lm = re.search(r"LOCATIONS:\s*(.+)", user)
    loc = (lm.group(1).split(",")[0].strip() if lm else "") or "the location"
    sm = re.search(r"SCENE:\s*(.+?)\s*—\s*(.+)", user)
    summary = (sm.group(2).strip() if sm else "the scene turns")
    frag = summary.rstrip(".")[:70]
    rng = _stub_rng("storyboard", user)
    hook = "HOOK" in user
    cliff = "CLIFFHANGER" in user

    opener = {
        "action": (f"Cold open, mid-action: {frag}" if hook else f"Establishing {loc}: {frag}"),
        "shot_type": "wide", "camera": rng.choice(["pan", "static", "aerial"]), "duration_s": 4,
        "character_names": [], "location_name": loc, "dialogue": [],
        "narration": rng.choice([
            "Some debts only come due after dark.", "Nobody plans the night that changes them.",
            "It started the way these things always start — too late.", "",
        ]),
    }
    beat = {
        "action": f"{lead or 'The lead'} {rng.choice(['moves through', 'works fast in', 'scans', 'slips into'])} {loc} — {rng.choice(['hands steady, eyes not', 'listening for footsteps', 'watching the exits', 'buying time'])}",
        "shot_type": "medium", "camera": rng.choice(["push_in", "handheld", "static"]), "duration_s": 4,
        "character_names": [lead] if lead else [], "location_name": loc,
        "dialogue": ([{"character": lead, "line": rng.choice([
            "Not tonight. Not like this.", "Stay where I can see you.",
            "I can fix this. I just need an hour.", "You brought this here?",
        ])}] if lead else []),
        "narration": "",
    }
    closer = {
        "action": (f"Close on {lead or 'the lead'} as the truth lands — hold the look, cut to black" if cliff
                   else f"{rng.choice(['Insert', 'Detail'])}: {rng.choice(['a hand closing over', 'the light catching', 'rain hitting'])} what matters most in {loc}"),
        "shot_type": "close_up", "camera": rng.choice(["push_in", "static"]), "duration_s": 3,
        "character_names": [lead] if (cliff and lead) else [], "location_name": loc,
        "dialogue": [], "narration": "" if cliff else rng.choice(["Whatever it cost, it wasn't done charging.", ""]),
    }
    nm = re.search(r"about (\d+) shot", user)
    n = int(nm.group(1)) if nm else 3
    shots = [opener, beat, closer][: max(1, min(3, n))]
    if n <= 1:
        shots = [beat]  # a single-shot scene keeps the character beat, not the establishing
    return {"shots": shots}


def _stub_rubric() -> dict:
    return {
        "scores": {"dramatic_question_payoff": 0.85, "character_arc": 0.8, "subtext": 0.75, "ending_earned": 0.82},
        "overall": 0.81,
        "notes": "Clear dramatic question with a real reversal; arcs land; ending earned.",
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


def stub_models() -> ModelClients:
    """The deterministic offline set. Also used for TEST-MODE productions: the whole
    flow runs against stubs (0 provider tokens) even when the server backend is live."""
    return ModelClients(
        vision=StubVision(),
        transcriber=StubTranscriber(),
        text=StubTextLLM(),
        video=StubVideoGen(),
        image=StubImageGen(),
        voice=StubVoiceGen(),
    )


def get_models(settings: Settings | None = None) -> ModelClients:
    s = settings or get_settings()
    if s.model_backend == "qwen":
        from recut.core.qwen_clients import build_qwen_clients

        return build_qwen_clients(s)
    return stub_models()
