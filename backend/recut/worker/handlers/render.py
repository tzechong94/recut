"""render_export job handler — turns a saved timeline into an exported MP4 in storage.

Resumable (the render engine caches per-slot clips by hash), token-aware, and it
updates the project's exported asset on completion. This is the spine handler; Lanes
C/D add generate_* handlers alongside it.
"""

from __future__ import annotations

from pathlib import Path

from recut.core import queue, repo
from recut.core.db import Job
from recut.pipeline.render import AssetMeta, render_timeline
from recut.worker.registry import WorkerContext, register

FONTS_DIR = str(Path(__file__).resolve().parents[4] / "assets" / "fonts")


def _asset_map(timeline) -> dict[str, AssetMeta]:
    ids = [s.asset_id for s in timeline.slots if s.asset_id]
    for track in (timeline.audio.voiceover, timeline.audio.bed):
        if track and track.asset_id:
            ids.append(track.asset_id)
    rows = repo.assets_by_ids(ids)
    return {
        aid: AssetMeta(
            storage_key=r["storage_key"], mime=r["mime"], duration_s=r["duration_s"],
            width=r["width"], height=r["height"],
        )
        for aid, r in rows.items()
    }


@register("render_export")
def handle_render_export(job: Job, ctx: WorkerContext) -> dict:
    timeline_id = job.payload["timeline_id"]
    timeline = repo.get_timeline(timeline_id)
    if not timeline:
        raise ValueError(f"timeline {timeline_id} not found")

    fonts = FONTS_DIR if Path(FONTS_DIR).exists() else None
    out_path = render_timeline(
        timeline,
        assets=_asset_map(timeline),
        storage=ctx.storage,
        settings=ctx.settings,
        on_progress=lambda p: queue.update_progress(job.id, p),
        fonts_dir=fonts,
    )

    key = f"exports/{timeline.project_id or 'p'}/{timeline.timeline_id}_v{timeline.version}.mp4"
    ctx.storage.put_file(key, out_path, content_type="video/mp4")
    asset = repo.create_asset(
        kind="export", storage_key=key, project_id=timeline.project_id, mime="video/mp4",
        duration_s=timeline.duration_s, width=1080, height=1920,
    )
    return {"asset_id": asset["id"], "storage_key": key, "url": ctx.storage.url(key), "duration_s": timeline.duration_s}
