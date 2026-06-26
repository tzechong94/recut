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
from recut.showrunner.pipeline.production import generate_shot, should_reroll
from recut.showrunner.schemas import AssetSource, ShotStatus, Stage
from recut.worker.registry import WorkerContext, register

CONSISTENCY_THRESHOLD = 0.6


def _store_bytes(ctx, key: str, data: bytes, mime: str) -> str:
    ctx.storage.put(key, data, content_type=mime)
    return key


@register("cast_reference")
def handle_cast_reference(job: Job, ctx: WorkerContext) -> dict:
    prod = repo.get_production(job.payload["production_id"])
    if not prod:
        raise ValueError("production not found")
    target, tid = job.payload["target"], job.payload["target_id"]

    if target == "character":
        subject = prod.character(tid)
        if not subject:
            raise ValueError("character not found")
        gen = generate_character_reference(ctx.models, subject, prod.style)
    else:
        subject = prod.location(tid)
        if not subject:
            raise ValueError("location not found")
        gen = generate_location_reference(ctx.models, subject, prod.style)

    key = f"productions/{prod.id}/refs/{target}_{tid}_{content_hash(gen.data)}.png"
    _store_bytes(ctx, key, gen.data, "image/png")
    asset = repo.create_asset(kind="reference", storage_key=key, project_id=prod.project_id, mime="image/png", width=720, height=1280)
    subject.reference_asset_id = asset["id"]
    # i2v needs a URL reachable by the model; the generated still already has a provider URL.
    subject.reference_url = gen.url or ctx.storage.url(key)
    subject.source = AssetSource.generated
    subject.locked = True
    prod.token_ledger.image_tokens += gen.tokens
    repo.save_production(prod)
    return {"target": target, "target_id": tid, "asset_id": asset["id"], "reference_url": subject.reference_url}


def _keyframe(video_path: str, mime: str) -> str | None:
    if mime.startswith("image"):
        return video_path  # stub "video" is already a still
    from recut.pipeline.shots import extract_keyframe

    return extract_keyframe(video_path, 0.5)


def _project_cap(prod, ctx) -> int:
    if prod.project_id:
        p = repo.get_project(prod.project_id)
        if p:
            return p["token_cap"]
    return ctx.settings.project_token_cap


@register("produce_film")
def handle_produce_film(job: Job, ctx: WorkerContext) -> dict:
    prod = repo.get_production(job.payload["production_id"])
    if not prod:
        raise ValueError("production not found")
    shots = prod.shots
    total = len(shots) or 1
    cap = _project_cap(prod, ctx)
    src_dir = Path(ctx.settings.work_dir) / f"prod_{prod.id}" / "src"
    src_dir.mkdir(parents=True, exist_ok=True)

    for i, shot in enumerate(shots):
        if shot.source in (AssetSource.generated, AssetSource.uploaded) and shot.asset_id:
            continue  # resumable: already done
        if prod.token_ledger.video_tokens >= cap:
            shot.status = ShotStatus.failed  # cap reached -> stays a stand-in in the render
            continue

        shot.status = ShotStatus.generating
        repo.save_production(prod)

        render = generate_shot(ctx.models, prod, shot)
        asset_bytes, mime = render.asset.data, render.asset.mime
        # consistency critic (+ bounded re-roll)
        if render.reference_url:
            tmp = src_dir / f"{shot.id}.{'png' if mime.startswith('image') else 'mp4'}"
            tmp.write_bytes(asset_bytes)
            kf = _keyframe(str(tmp), mime)
            if kf:
                score = ctx.models.vision.score_consistency(render.reference_url, kf)
                shot.critic_score = round(score, 3)
                if should_reroll(score, threshold=CONSISTENCY_THRESHOLD, rerolls_done=shot.reroll_count):
                    shot.reroll_count += 1
                    prod.token_ledger.rerolls += 1
                    render = generate_shot(ctx.models, prod, shot)
                    asset_bytes, mime = render.asset.data, render.asset.mime

        ext = "png" if mime.startswith("image") else "mp4"
        key = f"productions/{prod.id}/shots/{shot.id}_{content_hash(asset_bytes)}.{ext}"
        _store_bytes(ctx, key, asset_bytes, mime)
        asset = repo.create_asset(kind="generated", storage_key=key, project_id=prod.project_id, mime=mime, duration_s=shot.duration_s, width=1080, height=1920)
        shot.asset_id = asset["id"]
        shot.source = AssetSource.generated
        shot.status = ShotStatus.ready
        shot.gen_tool = render.tool
        shot.tokens = render.asset.tokens
        prod.token_ledger.video_tokens += render.asset.tokens
        repo.save_production(prod)
        queue.update_progress(job.id, (i + 1) / total * 0.8)

    # voiceover: synth per shot, concat into one aligned track
    vo_segments: list[tuple[str, float]] = []
    for shot in shots:
        va = synth_shot_voice(ctx.models, prod, shot)
        seg_path = ""
        if va:
            sp = src_dir / f"vo_{shot.id}.{'wav' if va.mime.endswith('wav') else 'mp3'}"
            sp.write_bytes(va.data)
            seg_path = str(sp)
            prod.token_ledger.voice_tokens += va.tokens
        vo_segments.append((seg_path, shot.duration_s))

    timeline = compile_to_timeline(prod)
    assets = {a_id: AssetMeta(storage_key=r["storage_key"], mime=r["mime"], duration_s=r["duration_s"], width=r["width"], height=r["height"])
              for a_id, r in repo.assets_by_ids([s.asset_id for s in shots if s.asset_id]).items()}

    vo_path = concat_voiceover(vo_segments, str(src_dir / "voiceover.wav"), ctx.settings) if any(p for p, _ in vo_segments) else None
    if vo_path:
        vo_key = f"productions/{prod.id}/voiceover.wav"
        ctx.storage.put_file(vo_key, vo_path, content_type="audio/wav")
        vo_asset = repo.create_asset(kind="audio", storage_key=vo_key, project_id=prod.project_id, mime="audio/wav", duration_s=timeline.duration_s)
        timeline.audio.voiceover.asset_id = vo_asset["id"]
        timeline.audio.voiceover.enabled = True
        assets[vo_asset["id"]] = AssetMeta(storage_key=vo_key, mime="audio/wav", duration_s=timeline.duration_s)

    out_path = render_timeline(timeline, assets=assets, storage=ctx.storage, settings=ctx.settings, on_progress=lambda p: queue.update_progress(job.id, 0.8 + p * 0.2))
    export_key = f"productions/{prod.id}/film_v{prod.version}.mp4"
    ctx.storage.put_file(export_key, out_path, content_type="video/mp4")
    export_asset = repo.create_asset(kind="export", storage_key=export_key, project_id=prod.project_id, mime="video/mp4", duration_s=timeline.duration_s, width=1080, height=1920)
    prod.stage = Stage.export
    repo.save_production(prod)
    return {"export_asset_id": export_asset["id"], "url": ctx.storage.url(export_key), "duration_s": timeline.duration_s, "tokens": prod.token_ledger.total}
