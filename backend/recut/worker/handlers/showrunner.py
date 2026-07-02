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
from recut.showrunner.pipeline.production import compose_shot_still, generate_shot, should_reroll, still_signature
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


def _keyframe(video_path: str, mime: str) -> str | None:
    if mime.startswith("image"):
        return video_path  # stub "video" is already a still
    from recut.pipeline.shots import extract_keyframe

    # Score identity on the FIRST frame — sharpest for a character, and not biased by
    # being the i2v seed frame (i2v's first frame ~ the reference; mid/late frames drift).
    return extract_keyframe(video_path, 0.3)


_MIN_SHOT_S, _MAX_SHOT_S = 2.5, 6.0  # legacy fallback; real clamps come from settings


def _fit_durations_to_voice(prod, ctx, src_dir) -> dict[str, str]:
    """Synthesize each shot's voiceover FIRST and set the shot duration to fit the spoken
    line (clamped), so dialogue is never truncated mid-word. Returns shot_id -> vo path."""
    from recut.pipeline.shots import probe_duration

    vo_paths: dict[str, str] = {}
    for shot in prod.shots:
        # Cache keyed on the caption's CONTENT so re-runs reuse (idempotent, no double
        # token count) but an EDITED line re-synthesizes (correct audio).
        chash = content_hash(shot.caption.encode())[:8] if shot.caption else "silent"
        existing = next((p for ext in ("wav", "mp3") if (p := Path(src_dir) / f"vo_{shot.id}_{chash}.{ext}").exists()), None)
        if existing:
            vo_paths[shot.id] = str(existing)
            continue
        lo, hi = ctx.settings.min_shot_s, ctx.settings.max_shot_s
        try:
            va = synth_shot_voice(ctx.models, prod, shot)
        except Exception as exc:  # noqa: BLE001 — voice is enhancement; a flaky TTS socket must never kill the film
            prod.warnings.append(f"voiceover failed for a shot ({type(exc).__name__}); rendered silent")
            va = None
        if not va:
            shot.duration_s = max(lo, min(hi, shot.duration_s))
            continue
        ext = "wav" if va.mime.endswith("wav") else "mp3"
        sp = Path(src_dir) / f"vo_{shot.id}_{chash}.{ext}"
        sp.write_bytes(va.data)
        vo_paths[shot.id] = str(sp)
        prod.token_ledger.voice_tokens += va.tokens
        dur = probe_duration(str(sp)) or va.duration_s or shot.duration_s
        shot.duration_s = round(max(lo, min(hi, dur + 0.4)), 2)  # small tail pad
    return vo_paths


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


def _generate_shot_best_of(prod, shot, ctx, src_dir, prev_frame_url=None) -> tuple[bytes, str, str, int, float | None, int, int]:
    """Generate a shot, scoring each attempt against its reference and re-rolling drift
    with a NEW seed + the critic's corrective note. Returns the BEST attempt
    (bytes, mime, tool, video_tokens, best_score, rerolls, keyframe_image_tokens)."""
    import hashlib

    best = None  # (score, bytes, mime, tool, tokens)
    corrective = ""
    rerolls = 0
    kf_tokens = 0  # keyframe image-gen tokens spent across attempts (honest accounting)
    for attempt in range(MAX_ATTEMPTS):
        seed = int(hashlib.sha256(f"{shot.id}:{attempt}".encode()).hexdigest()[:7], 16)
        try:
            render = generate_shot(ctx.models, prod, shot, seed=seed, corrective=corrective, prev_frame_url=prev_frame_url)
        except Exception:  # noqa: BLE001 — continuity i2v can fail (unhosted frame); fall back to t2v
            render = generate_shot(ctx.models, prod, shot, seed=seed, corrective=corrective)
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
                corrective = verdict.reason or corrective
        # keep the best-scoring attempt (None score sorts low so a scored attempt wins)
        rank = score if score is not None else -1.0
        if best is None or rank > best[0]:
            best = (rank, data, mime, render.tool, render.asset.tokens)
        if score is None or score >= CONSISTENCY_THRESHOLD:
            break  # good enough (or critic unavailable -> don't burn budget re-rolling)
        rerolls += 1
    score_val = best[0] if best[0] >= 0 else None
    return best[1], best[2], best[3], best[4], score_val, rerolls, kf_tokens


@register("produce_film")
def handle_produce_film(job: Job, ctx: WorkerContext) -> dict:
    prod = repo.get_production(job.payload["production_id"])
    if not prod:
        raise ValueError("production not found")
    ctx = _ctx_for(prod, ctx)
    shots = prod.shots
    total = len(shots) or 1
    cap = _project_cap(prod, ctx)
    src_dir = Path(ctx.settings.work_dir) / f"prod_{prod.id}" / "src"
    src_dir.mkdir(parents=True, exist_ok=True)

    # PASS 0 — lock locations: any location a shot uses but that has no plate gets one now,
    # so the keyframe step composes every shot into the SAME set (cross-shot consistency).
    _ensure_location_plates(prod, ctx)

    # PASS 1 — audio-fit: synth each line, set shot duration to fit it (no truncation)
    vo_paths = _fit_durations_to_voice(prod, ctx, src_dir)
    # PASS 1.5 — editor: pace the silent shots and LOG the cut decisions (the "edit" stage)
    from recut.showrunner.pipeline.editor import edit_pass

    edit_pass(prod)
    repo.save_production(prod)

    # PASS 2 — generate each shot (best-of-N + critic re-roll), chaining the previous
    # shot's last frame within a scene for lighting/world continuity.
    from recut.pipeline.shots import extract_last_frame

    shot_scene = {sh.id: sc.index for sc in prod.scenes for sh in sc.shots}
    prev_frame_url, prev_scene, done = None, None, 0
    for shot in shots:
        if shot_scene.get(shot.id) != prev_scene:
            prev_frame_url, prev_scene = None, shot_scene.get(shot.id)  # reset at scene cut
        done += 1
        if shot.source in (AssetSource.generated, AssetSource.uploaded) and shot.asset_id:
            continue  # resumable
        if prod.token_ledger.video_tokens >= cap:
            shot.status = ShotStatus.failed
            continue
        shot.status = ShotStatus.generating
        repo.save_production(prod)

        data, mime, tool, tokens, score, rerolls, kf_tokens = _generate_shot_best_of(prod, shot, ctx, src_dir, prev_frame_url)
        prod.token_ledger.image_tokens += kf_tokens  # keyframe composition is real spend
        ext = "png" if mime.startswith("image") else "mp4"
        key = f"productions/{prod.id}/shots/{shot.id}_{content_hash(data)}.{ext}"
        _store_bytes(ctx, key, data, mime)
        asset = repo.create_asset(kind="generated", storage_key=key, project_id=prod.project_id, mime=mime, duration_s=shot.duration_s, width=1080, height=1920)
        shot.asset_id = asset["id"]
        shot.source = AssetSource.generated
        shot.status = ShotStatus.ready
        shot.gen_tool = tool
        shot.tokens = tokens
        shot.critic_score = round(score, 3) if score is not None else None
        shot.reroll_count = rerolls
        prod.token_ledger.video_tokens += tokens
        prod.token_ledger.rerolls += rerolls
        # visible agent reasoning — why this shot was made the way it was
        decision = {"generate_shot_board_i2v": "animated the human-approved board still → image-to-video",
                    "generate_shot_keyframe_i2v": "composed keyframe (character placed in the location + style) → image-to-video",
                    "generate_shot_i2v": "image-to-video from locked reference",
                    "generate_shot_i2v_continuity": "image-to-video chained from previous frame",
                    "generate_shot_t2v": "text-to-video (establishing / no character)"}.get(tool, tool)
        if score is not None:
            reason = f"consistency {score:.2f}" + (f"; re-rolled ×{rerolls} to fix drift" if rerolls else "; passed first try")
        else:
            reason = "no identity reference to verify"
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

    # PASS 3 — assemble: per-shot VO concat (already synthesized in pass 1), then render
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
