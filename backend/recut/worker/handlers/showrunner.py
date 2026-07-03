"""Showrunner job handlers — the autonomous production stage.

  cast_reference  — generate a character/location reference still, lock it
  produce_film    — for each shot: generate (i2v from locked ref | t2v) → consistency
                    critic (Qwen-VL) → re-roll on drift → store; then per-shot voiceover
                    → concat → render the final MP4. Reuses the existing render engine.

Resumable: shots already resolved are skipped on re-run. Token-capped via the project.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from recut.core import queue, repo
from recut.core.db import Job
from recut.core.storage import content_hash
from recut.pipeline.render import AssetMeta, render_timeline
from recut.showrunner.compile import compile_to_timeline
from recut.showrunner.pipeline.assemble import concat_voiceover, synth_shot_voice
from recut.showrunner.pipeline.casting import generate_character_reference, generate_location_reference
from recut.showrunner.pipeline.production import (
    compose_shot_still,
    generate_shot,
    is_native_audio_model,
    route_shot_model,
    should_reroll,
    speaking,
    still_signature,
)
from recut.showrunner.schemas import AssetSource, ShotStatus, Stage
from recut.worker.registry import WorkerContext, register

CONSISTENCY_THRESHOLD = 0.6


def _ctx_for(prod, ctx: WorkerContext) -> WorkerContext:
    """TEST-MODE productions run every model call on the deterministic stubs — the
    whole flow is walkable for zero provider tokens, even on a live-backend worker."""
    if not prod.test_mode:
        return ctx
    from dataclasses import replace

    from recut.core.models import stub_models

    return replace(ctx, models=stub_models())


def _store_bytes(ctx, key: str, data: bytes, mime: str) -> str:
    ctx.storage.put(key, data, content_type=mime)
    return key


def _lock_reference(prod, ctx: WorkerContext, target: str, subject, gen) -> dict:
    """Store a generated reference, lock it on the subject, ledger the spend, and (for
    characters) name the identity anchors that must not drift."""
    key = f"productions/{prod.id}/refs/{target}_{subject.id}_{content_hash(gen.data)}.png"
    _store_bytes(ctx, key, gen.data, "image/png")
    asset = repo.create_asset(kind="reference", storage_key=key, project_id=prod.project_id, mime="image/png", width=720, height=1280)
    subject.reference_asset_id = asset["id"]
    # i2v needs a URL reachable by the model; the generated still already has a provider URL.
    subject.reference_url = gen.url or ctx.storage.url(key)
    subject.source = AssetSource.generated
    subject.locked = True
    if target == "character":
        # identity anchors: what must NOT drift, named once at cast time and injected
        # into every keyframe compose + critic corrective downstream
        try:
            subject.identity_notes = ctx.models.vision.describe_subject(subject.reference_url)
        except Exception:  # noqa: BLE001 — anchors are an enhancement, never fatal
            subject.identity_notes = ""
    prod.token_ledger.image_tokens += gen.tokens
    return asset


def _cast_anchor(prod, *, exclude_id: str | None = None) -> str | None:
    """The image every new reference should match: the custom style's hosted ref wins,
    else the first locked cast member — so one look rules the whole bible."""
    from recut.showrunner.pipeline.production import style_anchor_url

    anchor = style_anchor_url(prod)
    if anchor:
        return anchor
    for c in prod.characters:
        if c.id != exclude_id and c.reference_url:
            return c.reference_url
    return None


@register("cast_reference")
def handle_cast_reference(job: Job, ctx: WorkerContext) -> dict:
    prod = repo.get_production(job.payload["production_id"])
    if not prod:
        raise ValueError("production not found")
    ctx = _ctx_for(prod, ctx)
    target, tid = job.payload["target"], job.payload["target_id"]
    instruction = job.payload.get("instruction", "") or ""  # user's regenerate note

    # anchor to the existing look, so an individual regenerate can't drift the style
    anchor = _cast_anchor(prod, exclude_id=tid)
    if target == "character":
        subject = prod.character(tid)
        if not subject:
            raise ValueError("character not found")
        gen = generate_character_reference(ctx.models, subject, prod.style, instruction, anchor_url=anchor)
    else:
        subject = prod.location(tid)
        if not subject:
            raise ValueError("location not found")
        gen = generate_location_reference(ctx.models, subject, prod.style, instruction, anchor_url=anchor)

    asset = _lock_reference(prod, ctx, target, subject, gen)
    repo.save_production(prod)
    return {"target": target, "target_id": tid, "asset_id": asset["id"], "reference_url": subject.reference_url}


@register("cast_all")
def handle_cast_all(job: Job, ctx: WorkerContext) -> dict:
    """Cast the WHOLE show bible in one consistent look: the first reference (or the
    custom style's image) anchors every subsequent one via image-edit — same rendering,
    different subject — so no character rolls their own art style. Uploaded references
    are respected and never regenerated."""
    prod = repo.get_production(job.payload["production_id"])
    if not prod:
        raise ValueError("production not found")
    ctx = _ctx_for(prod, ctx)

    from recut.showrunner.pipeline.production import style_anchor_url

    anchor = style_anchor_url(prod)  # a hosted custom-style ref anchors everyone
    for c in prod.characters:  # an uploaded face is canon — it can anchor too
        if c.source == AssetSource.uploaded and c.reference_url:
            anchor = anchor or c.reference_url
    made, failed = 0, 0
    targets = [("character", c) for c in prod.characters] + [("location", l) for l in prod.locations]
    total = len(targets) or 1
    for i, (target, subject) in enumerate(targets):
        if subject.source == AssetSource.uploaded and subject.reference_url:
            continue  # never overwrite the human's own image
        try:
            if target == "character":
                gen = generate_character_reference(ctx.models, subject, prod.style, anchor_url=anchor)
            else:
                gen = generate_location_reference(ctx.models, subject, prod.style, anchor_url=anchor)
        except Exception:  # noqa: BLE001 — one failure must not sink the bible
            failed += 1
            prod.warnings.append(f"reference failed for {target} '{subject.name}'")
            repo.save_production(prod)
            continue
        _lock_reference(prod, ctx, target, subject, gen)
        anchor = anchor or subject.reference_url  # the first ref becomes the show's look
        made += 1
        repo.save_production(prod)
        queue.update_progress(job.id, (i + 1) / total)
    return {"generated": made, "failed": failed, "total": len(targets)}


@register("animatic")
def handle_animatic(job: Job, ctx: WorkerContext) -> dict:
    """THE ANIMATIC: watch the whole film for $0 video — board stills held for each
    beat, real character voices speaking the real lines, title cards, music bed,
    rendered as an actual MP4 through the existing engine. Durations are fitted to
    the synthesized audio JOB-LOCALLY (the Production is never mutated pre-approval);
    voice spend and per-line warnings land on the real ledger (honest accounting)."""
    from recut.pipeline.render import AssetMeta, render_timeline
    from recut.pipeline.shots import probe_duration
    from recut.showrunner.compile import compile_to_timeline
    from recut.showrunner.pipeline.assemble import concat_voiceover, find_or_make_bed

    prod = repo.get_production(job.payload["production_id"])
    if not prod:
        raise ValueError("production not found")
    ctx = _ctx_for(prod, ctx)
    src_dir = Path(ctx.settings.work_dir) / f"prod_{prod.id}" / "animatic"
    src_dir.mkdir(parents=True, exist_ok=True)

    # per-shot VO (cache reuse) + JOB-LOCAL duration fit — no mid-word clipping
    fits: dict[str, float] = {}
    vo_paths: dict[str, str] = {}
    shots = prod.shots
    lo, hi = ctx.settings.min_shot_s, ctx.settings.max_shot_s
    for i, shot in enumerate(shots):
        dur = max(lo, min(hi, shot.duration_s))
        if shot.caption:
            chash = content_hash(shot.caption.encode())[:8]
            sp = next((q for ext in ("wav", "mp3") if (q := src_dir / f"vo_{shot.id}_{chash}.{ext}").exists()), None)
            if not sp:
                try:
                    va = synth_shot_voice(ctx.models, prod, shot)
                except Exception as exc:  # noqa: BLE001 — a silent beat, never a dead animatic
                    prod.warnings.append(f"animatic voice failed for a line ({type(exc).__name__})")
                    va = None
                if va:
                    sp = src_dir / f"vo_{shot.id}_{chash}.{'wav' if va.mime.endswith('wav') else 'mp3'}"
                    sp.write_bytes(va.data)
                    prod.token_ledger.voice_tokens += va.tokens
            if sp:
                vo_paths[shot.id] = str(sp)
                vdur = probe_duration(str(sp)) or dur
                # NEVER cut a line mid-word: audio sets the floor, not max_shot_s
                dur = round(max(lo, min(15.0, vdur + 0.4)), 2)
        fits[shot.id] = dur
        queue.update_progress(job.id, (i + 1) / (len(shots) or 1) * 0.5)
    repo.save_production(prod)  # honest ledger + warnings

    timeline = compile_to_timeline(prod, stills=True, duration_overrides=fits)
    assets = {}
    for shot in shots:
        if shot.keyframe_asset_id:
            a = repo.get_asset(shot.keyframe_asset_id)
            if a:
                assets[shot.keyframe_asset_id] = AssetMeta(storage_key=a["storage_key"], mime=a["mime"],
                                                           duration_s=a["duration_s"], width=a["width"], height=a["height"])
    vo_segments = [(vo_paths.get(shot.id, ""), fits[shot.id]) for shot in shots]
    try:
        vo_path = concat_voiceover(vo_segments, str(src_dir / "animatic_vo.wav"), ctx.settings) if any(p for p, _ in vo_segments) else None
    except Exception:  # noqa: BLE001 — audio is enhancement
        vo_path = None
    if vo_path:
        vo_key = f"productions/{prod.id}/animatic_vo.wav"
        ctx.storage.put_file(vo_key, vo_path, content_type="audio/wav")
        vo_asset = repo.create_asset(kind="audio", storage_key=vo_key, project_id=prod.project_id, mime="audio/wav")
        timeline.audio.voiceover.asset_id = vo_asset["id"]
        timeline.audio.voiceover.enabled = True
        assets[vo_asset["id"]] = AssetMeta(storage_key=vo_key, mime="audio/wav")
    bed = find_or_make_bed(prod.style.name, str(src_dir / "bed.wav"), ctx.settings)
    if bed:
        bed_key = f"productions/{prod.id}/animatic_bed.wav"
        ctx.storage.put_file(bed_key, bed, content_type="audio/wav")
        bed_asset = repo.create_asset(kind="audio", storage_key=bed_key, project_id=prod.project_id, mime="audio/wav")
        timeline.audio.bed.asset_id = bed_asset["id"]
        timeline.audio.bed.enabled = True
        timeline.audio.bed.gain_db = -16.0
        assets[bed_asset["id"]] = AssetMeta(storage_key=bed_key, mime="audio/wav")

    out_path = render_timeline(timeline, assets=assets, storage=ctx.storage, settings=ctx.settings,
                               on_progress=lambda pr: queue.update_progress(job.id, 0.5 + pr * 0.5))
    key = f"productions/{prod.id}/animatic_v{prod.version}.mp4"
    ctx.storage.put_file(key, out_path, content_type="video/mp4")
    asset = repo.create_asset(kind="animatic", storage_key=key, project_id=prod.project_id,
                              mime="video/mp4", duration_s=timeline.duration_s, width=1080, height=1920)
    return {"animatic_asset_id": asset["id"], "duration_s": timeline.duration_s,
            "note": "the whole film, $0 video — stills + real voices"}


@register("table_read")
def handle_table_read(job: Job, ctx: WorkerContext) -> dict:
    """The TABLE READ: speak the written, critiqued script aloud — each line in its
    character's voice — so the writing is judged by ear before a single video token.
    Cheap voice tokens, human-triggered, per-line assets for karaoke-style playback."""
    prod = repo.get_production(job.payload["production_id"])
    if not prod:
        raise ValueError("production not found")
    ctx = _ctx_for(prod, ctx)

    lines = [(sc, line) for sc in prod.scenes for line in (sc.script or []) if line.line.strip()]
    if not lines:  # storyboard may hold the placed lines instead
        lines = [(sc, d) for sc in prod.scenes for sh in sc.shots for d in sh.dialogue if d.line.strip()]
    out, total = [], len(lines) or 1
    for i, (sc, line) in enumerate(lines):
        c = prod.character(line.character_id) if line.character_id else None
        try:
            va = ctx.models.voice.synthesize(line.line, voice=(c.voice if c else "default"))
        except Exception:  # noqa: BLE001 — skip a flaky line, keep reading
            continue
        if not va:
            continue
        ext = "wav" if va.mime.endswith("wav") else "mp3"
        key = f"productions/{prod.id}/tableread/{i}_{content_hash(va.data)}.{ext}"
        _store_bytes(ctx, key, va.data, va.mime)
        asset = repo.create_asset(kind="audio", storage_key=key, project_id=prod.project_id,
                                  mime=va.mime, duration_s=va.duration_s)
        prod.token_ledger.voice_tokens += va.tokens
        out.append({"scene": sc.heading, "character": line.character_name, "line": line.line,
                    "asset_id": asset["id"]})
        queue.update_progress(job.id, (i + 1) / total)
    repo.save_production(prod)
    return {"lines": out}


@register("board_stills")
def handle_board_stills(job: Job, ctx: WorkerContext) -> dict:
    """Generate the shot board's stills — one composed frame per shot (character placed
    into the locked location, doing the action, in the style). Cheap image tokens the
    human iterates on BEFORE any video spend; produce then animates the approved frames.
    Payload: production_id, optional shot_id (regenerate just one) + instruction (note)."""
    prod = repo.get_production(job.payload["production_id"])
    if not prod:
        raise ValueError("production not found")
    ctx = _ctx_for(prod, ctx)
    shot_id = job.payload.get("shot_id")
    instruction = job.payload.get("instruction", "") or ""

    # plates first, so every still composes into the SAME set (cross-shot consistency)
    _ensure_location_plates(prod, ctx)

    if shot_id:
        target = prod.find_shot(shot_id)
        if not target:
            raise ValueError("shot not found")
        targets = [target]
    else:
        targets = [s for s in prod.shots if not s.keyframe_url]
    made, total = 0, len(targets) or 1
    for i, shot in enumerate(targets):
        gen, id_score, set_score = _gated_still(prod, shot, ctx, instruction)
        if gen is None:
            prod.warnings.append("board still failed for a shot")
            repo.save_production(prod)
            continue
        key = f"productions/{prod.id}/stills/{shot.id}_{content_hash(gen.data)}.png"
        _store_bytes(ctx, key, gen.data, "image/png")
        asset = repo.create_asset(kind="still", storage_key=key, project_id=prod.project_id, mime="image/png", width=720, height=1280)
        shot.keyframe_asset_id = asset["id"]
        shot.keyframe_url = gen.url or ctx.storage.url(key)
        shot.keyframe_sig = still_signature(shot)  # staleness anchor for the board UI
        shot.keyframe_score = id_score
        shot.setting_score = set_score
        made += 1
        repo.save_production(prod)
        queue.update_progress(job.id, (i + 1) / total)
    return {"stills": made, "total": len(targets)}


_STILL_GATE_ATTEMPTS = 2  # 1 compose + 1 bounded re-compose (image price, ~50× under video)


def _gated_still(prod, shot, ctx: WorkerContext, instruction: str):
    """Compose a still and GATE it: Qwen-VL scores identity (vs the character ref) and
    setting (vs the location plate); a failing still is re-composed once with the
    critic's note. Drift dies here at image price — never fake-pass: an unavailable
    critic leaves scores None and the still ships ungated."""
    import tempfile
    from pathlib import Path

    from recut.showrunner.pipeline.production import _identity_character

    char = _identity_character(prod, shot)
    loc = prod.location(shot.location_id) if shot.location_id else None
    plate_url = loc.reference_url if (loc and loc.reference_url) else None
    tmpdir = Path(tempfile.mkdtemp(prefix="recut-gate-"))

    best = None  # (rank, gen, id_score, set_score)
    corrective = ""
    for attempt in range(_STILL_GATE_ATTEMPTS):
        note = " ".join(x for x in (instruction, corrective) if x).strip()
        try:
            gen = compose_shot_still(ctx.models, prod, shot, instruction=note)
        except Exception:  # noqa: BLE001 — one failed compose must not sink the board
            break
        prod.token_ledger.image_tokens += gen.tokens
        cand = gen.url
        if not cand:
            p = tmpdir / f"still_{shot.id}_{attempt}.png"
            p.write_bytes(gen.data)
            cand = str(p)
        id_score = set_score = None
        reasons = []
        try:
            if char and char.reference_url:
                v = ctx.models.vision.score_consistency(char.reference_url, cand)
                id_score = v.score
                if v.reason:
                    reasons.append(v.reason)
            if plate_url:
                v = ctx.models.vision.score_consistency(plate_url, cand)
                set_score = v.score
                if v.reason:
                    reasons.append(v.reason)
        except Exception:  # noqa: BLE001 — critic down → ungated, never fake-pass
            pass
        scores = [s for s in (id_score, set_score) if s is not None]
        worst = min(scores) if scores else None
        rank = worst if worst is not None else -1.0
        if best is None or rank > best[0]:
            best = (rank, gen, id_score, set_score)
        if worst is None or worst >= CONSISTENCY_THRESHOLD:
            break  # passed (or critic unavailable) — don't burn budget
        corrective = "; ".join(reasons) or "match the reference identity and set exactly"
        prod.token_ledger.still_rerolls += 1
    if best is None:
        return None, None, None
    return best[1], best[2], best[3]


def _mux_voice_into_clip(data: bytes, vo_path: str, src_dir, shot_id: str, duration_s: float) -> bytes:
    """Give the raw shot clip its spoken line, so reviewing a shot (pilot pass, film
    view) plays WITH voice. The video LOOPS to the shot's (voice-fitted) duration —
    Wan clips are ~5s fixed, so a longer line must never be cut mid-word (same looping
    the final render does). Safe: the render strips clip audio (-an) and mixes the VO
    track itself, so dialogue is never doubled. Best-effort — a mux failure returns
    the silent clip unchanged."""
    import subprocess
    from pathlib import Path

    vin = Path(src_dir) / f"{shot_id}_mux_in.mp4"
    out = Path(src_dir) / f"{shot_id}_mux_out.mp4"
    try:
        vin.write_bytes(data)
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-stream_loop", "-1", "-i", str(vin),
             "-i", vo_path, "-map", "0:v", "-map", "1:a", "-t", f"{max(1.0, duration_s):.2f}",
             "-af", "apad", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
             "-c:a", "aac", str(out)],
            check=True, capture_output=True,
        )
        return out.read_bytes()
    except Exception:  # noqa: BLE001 — voice-on-clip is an enhancement, never fatal
        return data


def _vertical_blur_fill(data: bytes, src_dir, shot_id: str) -> bytes:
    """Native-audio models are landscape-locked (probed); a landscape clip in a 9:16
    film would letterbox. Composite it the way vertical platforms do: blurred
    self-background fill + centered foreground. Audio is preserved. Portrait/square
    input returns unchanged; failure returns the original bytes."""
    import subprocess
    from pathlib import Path

    vin = Path(src_dir) / f"{shot_id}_vfill_in.mp4"
    out = Path(src_dir) / f"{shot_id}_vfill_out.mp4"
    try:
        vin.write_bytes(data)
        pr = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v",
                             "-show_entries", "stream=width,height", "-of", "csv=p=0", str(vin)],
                            capture_output=True, text=True, check=True)
        w, h = (int(x) for x in pr.stdout.strip().split(",")[:2])
        if h >= w:
            return data  # already portrait/square
        vf = ("[0:v]scale=1080:1920:force_original_aspect_ratio=increase,"
              "crop=1080:1920,boxblur=24:4[bg];"
              "[0:v]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(vin),
                        "-filter_complex", vf, "-map", "0:a?", "-c:a", "copy",
                        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", str(out)],
                       check=True, capture_output=True)
        return out.read_bytes()
    except Exception:  # noqa: BLE001 — compositing is an enhancement; render letterboxes as fallback
        return data


def _extract_clip_audio(data: bytes, src_dir, shot_id: str) -> str | None:
    """Pull the native audio out of a clip (HappyHorse speaks in-video) so the render's
    voiceover track carries the performance. Best-effort."""
    import subprocess
    from pathlib import Path

    vin = Path(src_dir) / f"{shot_id}_aud_in.mp4"
    out = Path(src_dir) / f"{shot_id}_native.wav"
    try:
        vin.write_bytes(data)
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(vin), "-vn",
             "-acodec", "pcm_s16le", "-ar", "44100", str(out)],
            check=True, capture_output=True,
        )
        return str(out)
    except Exception:  # noqa: BLE001
        return None


def _keyframe(video_path: str, mime: str) -> str | None:
    if mime.startswith("image"):
        return video_path  # stub "video" is already a still
    from recut.pipeline.shots import extract_keyframe

    # Score identity on the FIRST frame — sharpest for a character, and not biased by
    # being the i2v seed frame (i2v's first frame ~ the reference; mid/late frames drift).
    return extract_keyframe(video_path, 0.3)


_MIN_SHOT_S, _MAX_SHOT_S = 2.5, 6.0  # legacy fallback; real clamps come from settings


def _fit_durations_to_voice(prod, ctx, src_dir, force: frozenset = frozenset()) -> tuple[dict[str, str], dict[str, str]]:
    """Synthesize each shot's voiceover FIRST and set the shot duration to fit the spoken
    line (clamped), so dialogue is never truncated mid-word. Returns shot_id -> vo path."""
    from recut.pipeline.shots import probe_duration

    from recut.showrunner.pipeline.production import accepts_input_audio, is_native_audio_model, route_shot_model, speaking

    vo_paths: dict[str, str] = {}
    vo_urls: dict[str, str] = {}  # HOSTED tts urls — native i2v embeds this exact track
    for shot in prod.shots:
        chosen = next((t for t in shot.takes if t.id == shot.chosen_take_id), None)
        if shot.id in force:
            chosen = None  # a forced retake re-fits like an unfilmed shot (fresh audio)
        if chosen:
            # THE CONTRACT: a chosen take drives its slot — never re-fit, never clobber
            shot.duration_s = chosen.duration_s
            if chosen.audio_kind == "native":
                continue  # speech lives in/with the take; PASS 3 derives it
            if chosen.audio_kind == "silent" or not shot.caption:
                continue
            # tts take: ensure the VO exists (cache hit, else tiny re-synth below)
        route = route_shot_model(shot, prod, ctx.settings)
        native_speaker = chosen is None and speaking(shot) and is_native_audio_model(route)
        lo, hi = ctx.settings.min_shot_s, ctx.settings.max_shot_s
        chash = content_hash(shot.caption.encode())[:8] if shot.caption else "silent"
        if native_speaker and not accepts_input_audio(route):
            # HappyHorse speaks with its OWN generated voice — pre-synthing TTS here
            # would double the audio. Text-estimate the duration; the worker extracts
            # the clip's performance into the VO track after generation.
            shot.duration_s = float(max(3, min(15, round(len(shot.caption) * 0.07 + 1.2))))
            continue
        if native_speaker:
            # input-audio dialogue: synth FRESH (the hosted url is short-lived and the
            # clip must embed this exact waveform); the local copy doubles as the VO
            try:
                va = synth_shot_voice(ctx.models, prod, shot)
            except Exception as exc:  # noqa: BLE001 — fall back to prompt-spoken dialogue
                prod.warnings.append(f"tts failed for a speaking shot ({type(exc).__name__}); the model voices it")
                va = None
            if va:
                ext = "wav" if va.mime.endswith("wav") else "mp3"
                sp = Path(src_dir) / f"vo_{shot.id}_{chash}.{ext}"
                sp.write_bytes(va.data)
                vo_paths[shot.id] = str(sp)
                if va.url:
                    vo_urls[shot.id] = va.url
                prod.token_ledger.voice_tokens += va.tokens
                dur = probe_duration(str(sp)) or va.duration_s or shot.duration_s
                # the clip embeds this exact wav — duration must cover the full line
                shot.duration_s = float(max(3, min(15, int(dur + 1.0))))
                if dur + 1.0 > 15:
                    prod.warnings.append("a line runs past the 15s clip ceiling — shorten it or split the shot")
            else:
                shot.duration_s = float(max(3, min(15, round(len(shot.caption) * 0.07 + 1.2))))
            continue
        # Cache keyed on the caption's CONTENT so re-runs reuse (idempotent, no double
        # token count) but an EDITED line re-synthesizes (correct audio).
        existing = next((p for ext in ("wav", "mp3") if (p := Path(src_dir) / f"vo_{shot.id}_{chash}.{ext}").exists()), None)
        if existing:
            vo_paths[shot.id] = str(existing)
            if chosen is None:
                dur = probe_duration(str(existing)) or shot.duration_s
                # NEVER cut a line mid-word: audio sets the floor, not max_shot_s
                shot.duration_s = round(max(lo, min(15.0, dur + 0.4)), 2)
            continue
        if not shot.caption:
            if chosen is None:
                shot.duration_s = max(lo, min(hi, shot.duration_s))
            continue
        try:
            va = synth_shot_voice(ctx.models, prod, shot)
        except Exception as exc:  # noqa: BLE001 — voice is enhancement; a flaky TTS socket must never kill the film
            prod.warnings.append(f"voiceover failed for a shot ({type(exc).__name__}); rendered silent")
            va = None
        if not va:
            if chosen is None:
                shot.duration_s = max(lo, min(hi, shot.duration_s))
            continue
        ext = "wav" if va.mime.endswith("wav") else "mp3"
        sp = Path(src_dir) / f"vo_{shot.id}_{chash}.{ext}"
        sp.write_bytes(va.data)
        vo_paths[shot.id] = str(sp)
        prod.token_ledger.voice_tokens += va.tokens
        if chosen is None:
            dur = probe_duration(str(sp)) or va.duration_s or shot.duration_s
            # NEVER cut a line mid-word: audio sets the floor, not max_shot_s
            shot.duration_s = round(max(lo, min(15.0, dur + 0.4)), 2)
    return vo_paths, vo_urls


def _ensure_location_plates(prod, ctx) -> None:
    """Generate + lock a plate for every location a shot actually uses but that has none, so
    the multi-image keyframe can compose the character into the SAME set across shots. A
    plate failure is non-fatal — that shot just falls back to character-only composition."""
    used = {sh.location_id for sh in prod.shots if sh.location_id}
    for loc in prod.locations:
        if loc.id not in used or loc.reference_url:
            continue
        try:
            gen = generate_location_reference(ctx.models, loc, prod.style)
        except Exception as exc:  # noqa: BLE001 — best-effort; consistency degrades, film still renders
            prod.warnings.append(f"could not lock location '{loc.name}' ({type(exc).__name__}); shots use character-only composition")
            continue
        key = f"productions/{prod.id}/refs/location_{loc.id}_{content_hash(gen.data)}.png"
        _store_bytes(ctx, key, gen.data, "image/png")
        asset = repo.create_asset(kind="reference", storage_key=key, project_id=prod.project_id, mime="image/png", width=1280, height=720)
        loc.reference_asset_id = asset["id"]
        loc.reference_url = gen.url or ctx.storage.url(key)
        loc.source = AssetSource.generated
        loc.locked = True
        prod.token_ledger.image_tokens += gen.tokens
    repo.save_production(prod)


def _project_cap(prod, ctx) -> int:
    if prod.project_id:
        p = repo.get_project(prod.project_id)
        if p:
            return p["token_cap"]
    return ctx.settings.project_token_cap


MAX_ATTEMPTS = 3  # 1 initial + up to 2 re-rolls (bounded so the critic can't blow the budget)


def _generate_shot_best_of(prod, shot, ctx, src_dir, prev_frame_url=None, user_note: str = "",
                           speak: bool = False, audio_url: str | None = None) -> tuple[bytes, str, str, int, float | None, int, int, int]:
    """Generate a shot, scoring each attempt against its reference and re-rolling drift
    with a NEW seed + the critic's corrective note. `user_note` is the director's retake
    comment — it rides EVERY attempt's prompt. `speak` = a native-audio model films this
    shot performing its line. Returns the BEST attempt
    (bytes, mime, tool, video_tokens, best_score, rerolls, keyframe_image_tokens, seed)."""
    import hashlib

    best = None  # (score, bytes, mime, tool, tokens, seed)
    corrective = user_note.strip()
    rerolls = 0
    kf_tokens = 0  # keyframe image-gen tokens spent across attempts (honest accounting)
    for attempt in range(MAX_ATTEMPTS):
        seed = int(hashlib.sha256(f"{shot.id}:{attempt}:{user_note}".encode()).hexdigest()[:7], 16)
        try:
            render = generate_shot(ctx.models, prod, shot, seed=seed, corrective=corrective,
                                   prev_frame_url=prev_frame_url, speak=speak, audio_url=audio_url)
        except Exception:  # noqa: BLE001 — continuity i2v can fail (unhosted frame); fall back to t2v
            render = generate_shot(ctx.models, prod, shot, seed=seed, corrective=corrective,
                                   speak=speak, audio_url=audio_url)
        if render.keyframe:
            kf_tokens += render.keyframe.tokens
        data, mime = render.asset.data, render.asset.mime
        score = None
        if render.reference_url:
            tmp = src_dir / f"{shot.id}_a{attempt}.{'png' if mime.startswith('image') else 'mp4'}"
            tmp.write_bytes(data)
            kf = _keyframe(str(tmp), mime)
            if kf:
                verdict = ctx.models.vision.score_consistency(render.reference_url, kf)
                score = verdict.score
                if verdict.reason:  # the director's note stays; the critic's reason joins it
                    corrective = "; ".join(x for x in (user_note.strip(), verdict.reason) if x)
        # keep the best-scoring attempt (None score sorts low so a scored attempt wins)
        rank = score if score is not None else -1.0
        if best is None or rank > best[0]:
            best = (rank, data, mime, render.tool, render.asset.tokens, seed)
        if score is None or score >= CONSISTENCY_THRESHOLD:
            break  # good enough (or critic unavailable -> don't burn budget re-rolling)
        rerolls += 1
    score_val = best[0] if best[0] >= 0 else None
    return best[1], best[2], best[3], best[4], score_val, rerolls, kf_tokens, best[5]


def _ctx_for_route(ctx: WorkerContext, model_name: str, cache: dict) -> WorkerContext:
    """Per-shot routed context: the same tier-swap mechanism, cached per model name.
    (Stub backend ignores the name, so test mode is harmlessly degenerate.)"""
    if model_name == ctx.settings.wan_i2v_model:
        return ctx
    if model_name not in cache:
        from dataclasses import replace

        from recut.core.models import get_models

        s2 = ctx.settings.model_copy(update={"wan_i2v_model": model_name})
        cache[model_name] = replace(ctx, settings=s2, models=get_models(s2))
    return cache[model_name]


@register("produce_film")
def handle_produce_film(job: Job, ctx: WorkerContext) -> dict:
    prod = repo.get_production(job.payload["production_id"])
    if not prod:
        raise ValueError("production not found")
    ctx = _ctx_for(prod, ctx)
    # Payload: SCOPE limits which shots this job may touch; FORCE re-films shots that
    # already have a chosen take (retake/master-cut); RENDER controls the final pass.
    # Legacy compat: a payload carrying only shot_ids means pilot (scope, no render)
    # when non-empty, plain full produce when empty.
    p = job.payload
    legacy = not any(k in p for k in ("scope_ids", "force_ids", "master", "render"))
    scope = set(p.get("scope_ids") or (p.get("shot_ids") if legacy else []) or [])
    force = set(p.get("force_ids") or [])
    master = bool(p.get("master"))
    render = p.get("render")
    if render is None:
        render = not scope
    notes = p.get("notes") or {}  # director's retake comments, per shot id
    route_cache: dict = {}
    shots = prod.shots
    total = len(shots) or 1
    cap = _project_cap(prod, ctx)
    src_dir = Path(ctx.settings.work_dir) / f"prod_{prod.id}" / "src"
    src_dir.mkdir(parents=True, exist_ok=True)

    # PASS 0 — lock locations: any location a shot uses but that has no plate gets one now,
    # so the keyframe step composes every shot into the SAME set (cross-shot consistency).
    _ensure_location_plates(prod, ctx)

    # PASS 1 — audio-fit: synth each line, set shot duration to fit it (no truncation)
    vo_paths, vo_urls = _fit_durations_to_voice(prod, ctx, src_dir, force=frozenset(force))
    # PASS 1.5 — editor: pace the silent shots and LOG the cut decisions (the "edit" stage)
    from recut.showrunner.pipeline.editor import edit_pass

    edit_pass(prod)
    repo.save_production(prod)

    # PASS 2 — generate each shot (best-of-N + critic re-roll), chaining the previous
    # shot's last frame within a scene for lighting/world continuity.
    from recut.pipeline.shots import extract_last_frame

    shot_scene = {sh.id: sc.index for sc in prod.scenes for sh in sc.shots}
    prev_frame_url, prev_scene, done = None, None, 0
    cancelled = False
    for shot in shots:
        if queue.is_cancelling(job.id):
            # cooperative stop: keep every finished shot, spend nothing more
            cancelled = True
            prod.warnings.append("production stopped by you — finished shots kept")
            break
        if shot_scene.get(shot.id) != prev_scene:
            prev_frame_url, prev_scene = None, shot_scene.get(shot.id)  # reset at scene cut
        done += 1
        # THE CONTRACT PREDICATE: film iff in scope AND (no chosen take, or forced)
        if scope and shot.id not in scope:
            continue
        if shot.chosen_take_id and shot.id not in force:
            continue  # a chosen take is permanent; only explicit force re-films
        if prod.token_ledger.video_tokens >= cap:
            shot.status = ShotStatus.failed
            continue
        shot.status = ShotStatus.generating
        repo.save_production(prod)

        route = route_shot_model(shot, prod, ctx.settings, master=master)
        speak = speaking(shot) and is_native_audio_model(route)
        shot_ctx = _ctx_for_route(ctx, route, route_cache)
        data, mime, tool, tokens, score, rerolls, kf_tokens, used_seed = _generate_shot_best_of(
            prod, shot, shot_ctx, src_dir, prev_frame_url,
            user_note=notes.get(shot.id, ""), speak=speak,
            audio_url=vo_urls.get(shot.id))
        prod.token_ledger.image_tokens += kf_tokens  # keyframe composition is real spend
        # audio semantics of the take: stub/image clips still carry their line as a
        # VO-at-render (tts) — only real video from a speaking model is 'native'
        audio_kind = "tts" if shot.caption else "silent"
        if not mime.startswith("image"):
            if speak and shot.caption:
                audio_kind = "native"
                data = _vertical_blur_fill(data, src_dir, shot.id)  # natives are landscape-locked
                if vo_paths.get(shot.id):
                    # input-audio path: the clip embeds OUR TTS — the cached wav IS the
                    # VO track already, perfectly aligned. Nothing to extract.
                    pass
                else:
                    # model-generated speech: pull it into the VO track so the final
                    # render (which strips clip audio) keeps the performance
                    vo = _extract_clip_audio(data, src_dir, shot.id)
                    if vo:
                        vo_paths[shot.id] = vo
            elif vo_paths.get(shot.id):
                audio_kind = "tts"
                # the clip carries its own spoken line for review; render re-mixes cleanly
                data = _mux_voice_into_clip(data, vo_paths[shot.id], src_dir, shot.id, shot.duration_s)
            elif shot.caption:
                audio_kind = "tts"
        ext = "png" if mime.startswith("image") else "mp4"
        key = f"productions/{prod.id}/shots/{shot.id}_{content_hash(data)}.{ext}"
        _store_bytes(ctx, key, data, mime)
        asset = repo.create_asset(kind="generated", storage_key=key, project_id=prod.project_id, mime=mime, duration_s=shot.duration_s, width=1080, height=1920)

        # APPEND the take (permanent); choose it only when the contract allows
        from recut.showrunner.schemas import Take, caption_fingerprint

        take = Take(
            asset_id=asset["id"], model=route, seed=used_seed, duration_s=shot.duration_s,
            audio_kind=audio_kind, keyframe_asset_id=shot.keyframe_asset_id,
            keyframe_sig=shot.keyframe_sig, caption_hash=caption_fingerprint(shot.caption),
            critic_score=round(score, 3) if score is not None else None,
            note=notes.get(shot.id, ""),
        )
        shot.takes.append(take)
        choose = (shot.chosen_take_id is None) or (shot.id in force and not master)
        if choose:
            shot.chosen_take_id = take.id
            shot.asset_id = take.asset_id  # dual-written for compat
            shot.source = AssetSource.generated
            shot.status = ShotStatus.ready
            shot.gen_tool = tool
            shot.tokens = tokens
            shot.critic_score = take.critic_score
            shot.reroll_count = rerolls
        else:
            shot.status = ShotStatus.ready  # master take appended UNCHOSEN — picker decides
        prod.token_ledger.video_tokens += tokens
        prod.token_ledger.rerolls += rerolls
        # visible agent reasoning — why this shot was made the way it was
        decision = {"generate_shot_board_i2v": "animated the human-approved board still → image-to-video",
                    "generate_shot_keyframe_i2v": "composed keyframe (character placed in the location + style) → image-to-video",
                    "generate_shot_i2v": "image-to-video from locked reference",
                    "generate_shot_i2v_continuity": "image-to-video chained from previous frame",
                    "generate_shot_t2v": "text-to-video (establishing / no character)"}.get(tool, tool)
        decision = f"{decision} · {route}" + (" · SPEAKS" if speak else "")
        if score is not None:
            reason = f"consistency {score:.2f}" + (f"; re-rolled ×{rerolls} to fix drift" if rerolls else "; passed first try")
        else:
            reason = "no identity reference to verify"
        if not choose:
            reason += " · master take appended unchosen (picker decides)"
        # Replace (not duplicate) this shot's prior generation entry on a re-run/regenerate
        # (dedupe by the unique shot id; shot.index is per-scene so labels can collide).
        # Editor entries have no "id" and are left intact.
        prod.director_log = [e for e in prod.director_log if e.get("id") != shot.id]
        prod.director_log.append({"shot": f"Shot {done}", "id": shot.id, "decision": decision, "reason": reason})
        repo.save_production(prod)
        queue.update_progress(job.id, done / total * 0.8)

        # chain continuity: this shot's last frame seeds the next shot in the scene
        if mime.startswith("image"):
            prev_frame_url = ctx.storage.url(key)
        else:
            tmp = src_dir / f"{shot.id}_full.mp4"
            tmp.write_bytes(data)
            lf = extract_last_frame(str(tmp), str(src_dir))
            if lf:
                lf_key = f"productions/{prod.id}/frames/{shot.id}_last.jpg"
                ctx.storage.put_file(lf_key, lf, content_type="image/jpeg")
                prev_frame_url = ctx.storage.url(lf_key)

    ready_now = sum(1 for s in shots if s.chosen_take_id or s.asset_id)
    if cancelled:
        prod.stage = Stage.production
        repo.save_production(prod)
        return {"cancelled": True, "shots_ready": ready_now, "shots_total": len(shots),
                "note": "stopped by the user; finished shots kept — press Action to resume"}
    if not render:
        # a no-render pass (pilot / master-cut) reviews takes BEFORE committing a film
        prod.stage = Stage.production
        repo.save_production(prod)
        return {"pilot": True, "master": master, "shots_ready": ready_now, "shots_total": len(shots),
                "note": "takes ready — review them, then press Action to render"}

    # PASS 3 — assemble: per-shot VO concat (already synthesized in pass 1), then render.
    # Chosen NATIVE takes on a re-render may have no VO in the work dir — re-extract the
    # performance from the take's STORED asset (permanent), never lose the speech.
    for shot in shots:
        if shot.id in vo_paths:
            continue
        chosen = next((t for t in shot.takes if t.id == shot.chosen_take_id), None)
        if not chosen or chosen.audio_kind != "native":
            continue
        a = repo.get_asset(chosen.asset_id)
        if not a or not a["mime"].startswith("video"):
            continue
        try:
            clip = ctx.storage.get(a["storage_key"])
        except Exception:  # noqa: BLE001 — asset unreadable → shot renders silent + warned
            prod.warnings.append("could not reload a chosen take's audio; that shot renders silent")
            continue
        vo = _extract_clip_audio(clip, src_dir, shot.id)
        if vo:
            vo_paths[shot.id] = vo
    vo_segments = [(vo_paths.get(shot.id, ""), shot.duration_s) for shot in shots]
    timeline = compile_to_timeline(prod)
    assets = {a_id: AssetMeta(storage_key=r["storage_key"], mime=r["mime"], duration_s=r["duration_s"], width=r["width"], height=r["height"])
              for a_id, r in repo.assets_by_ids([s.asset_id for s in shots if s.asset_id]).items()}

    from recut.showrunner.pipeline.assemble import find_or_make_bed

    # voiceover (per-shot, aligned)
    try:
        vo_path = concat_voiceover(vo_segments, str(src_dir / "voiceover.wav"), ctx.settings) if any(p for p, _ in vo_segments) else None
    except Exception:  # noqa: BLE001 — audio is enhancement; never block the film on it
        vo_path = None
    if vo_path:
        vo_key = f"productions/{prod.id}/voiceover.wav"
        ctx.storage.put_file(vo_key, vo_path, content_type="audio/wav")
        vo_asset = repo.create_asset(kind="audio", storage_key=vo_key, project_id=prod.project_id, mime="audio/wav", duration_s=timeline.duration_s)
        timeline.audio.voiceover.asset_id = vo_asset["id"]
        timeline.audio.voiceover.enabled = True
        assets[vo_asset["id"]] = AssetMeta(storage_key=vo_key, mime="audio/wav", duration_s=timeline.duration_s)

    # music bed (style-matched, ducked under VO by the render)
    bed = find_or_make_bed(prod.style.name, str(src_dir / "bed.wav"), ctx.settings)
    if bed:
        bed_key = f"productions/{prod.id}/bed.wav"
        ctx.storage.put_file(bed_key, bed, content_type="audio/wav")
        bed_asset = repo.create_asset(kind="audio", storage_key=bed_key, project_id=prod.project_id, mime="audio/wav")
        timeline.audio.bed.asset_id = bed_asset["id"]
        timeline.audio.bed.enabled = True
        timeline.audio.bed.gain_db = -16.0
        assets[bed_asset["id"]] = AssetMeta(storage_key=bed_key, mime="audio/wav")

    # Render. If it fails, the production still has every READY shot playable via the
    # timeline preview — degrade gracefully, report the partial state, never lose work.
    ready_shots = sum(1 for s in shots if s.asset_id)
    try:
        out_path = render_timeline(timeline, assets=assets, storage=ctx.storage, settings=ctx.settings, on_progress=lambda p: queue.update_progress(job.id, 0.8 + p * 0.2))
    except Exception as exc:  # noqa: BLE001
        prod.stage = Stage.production
        repo.save_production(prod)
        return {"partial": True, "stage": "render_failed", "error": f"{type(exc).__name__}: {exc}",
                "shots_ready": ready_shots, "shots_total": len(shots),
                "note": "shots generated; final render failed — preview plays the ready shots"}

    export_key = f"productions/{prod.id}/film_v{prod.version}.mp4"
    ctx.storage.put_file(export_key, out_path, content_type="video/mp4")
    export_asset = repo.create_asset(kind="export", storage_key=export_key, project_id=prod.project_id, mime="video/mp4", duration_s=timeline.duration_s, width=1080, height=1920)
    prod.stage = Stage.export
    prod.export_asset_id = export_asset["id"]
    repo.save_production(prod)
    return {"export_asset_id": export_asset["id"], "url": ctx.storage.url(export_key), "duration_s": timeline.duration_s,
            "tokens": prod.token_ledger.total, "shots_ready": ready_shots, "shots_total": len(shots)}
