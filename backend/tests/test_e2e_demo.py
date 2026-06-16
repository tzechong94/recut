"""End-to-end demo flow — the 3-minute script, through the real API + worker.

projects -> upload reference -> analyse -> co-write -> draft script -> base cut (plays
now) -> swap real footage on 'you' slots -> generate kept b-roll -> caption/cover ->
export MP4. Asserts the headline at the end: real-footage share + tokens saved.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile

import pytest
from fastapi.testclient import TestClient

from recut.api.main import create_app
from recut.worker.main import process_once
from recut.worker.registry import build_context


def _tiny_mp4() -> bytes:
    """A real 1s 9:16 clip so the render exercises the actual transcode path."""
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as t:
        out = t.name
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=teal:s=1080x1920:d=1:r=30",
         "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", out],
        capture_output=True, check=True,
    )
    return open(out, "rb").read()


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_full_demo_flow():
    c = TestClient(create_app())

    # 1. project + reference upload
    pid = c.post("/api/projects", json={"name": "Marble sourcing reel"}).json()["id"]
    files = {"file": ("ref.mp4", b"\x00\x00reference-bytes", "video/mp4")}
    aid = c.post(f"/api/projects/{pid}/assets", params={"kind": "reference"}, files=files).json()["id"]

    # 2. analyse -> recipe
    recipe = c.post(f"/api/projects/{pid}/analyse", json={"asset_id": aid}).json()
    assert recipe["shot_count"] == 7
    rid = recipe["recipe_id"]

    # 3. co-write + draft the script onto the beats
    assert c.post(f"/api/projects/{pid}/cowrite", json={"message": "I flew to the source", "recipe_id": rid}).status_code == 200
    drafted = c.post(f"/api/projects/{pid}/draft-script", json={"recipe_id": rid, "story": "marble direct"}).json()
    assert any(b["on_screen_text"] or b["transcript_excerpt"] for b in drafted["beats"])

    # 4. base cut — plays end to end immediately with stand-ins
    tl = c.post(f"/api/projects/{pid}/base-cut", json={"recipe_id": rid}).json()
    tid = tl["timeline_id"]
    assert all(s["source"] == "standin" for s in tl["slots"])

    # 5. swap real footage on the creator's slots (talk + roll)
    clip = _tiny_mp4()
    for s in tl["slots"]:
        if s["type"] in ("talk", "roll"):
            up = c.post(f"/api/projects/{pid}/assets", params={"kind": "upload"},
                        files={"file": (f"{s['id']}.mp4", clip, "video/mp4")}).json()
            tl = c.post(f"/api/timelines/{tid}/slots/{s['id']}/upload", json={"asset_id": up["id"]}).json()
    assert tl["token_ledger"]["real_footage_s"] > 0

    # 6. generate the kept auto slots (b-roll) — gap-fill only
    gen = c.post(f"/api/timelines/{tid}/generate", json={}).json()
    for _ in range(gen["queued"]):
        process_once(build_context())

    # 7. caption + cover
    cc = c.post(f"/api/timelines/{tid}/caption-cover").json()
    assert cc["caption"] and cc["covers"]

    # 8. export -> worker renders the MP4
    job_id = c.post(f"/api/timelines/{tid}/export").json()["job_id"]
    process_once(build_context())
    job = c.get(f"/api/jobs/{job_id}").json()
    assert job["status"] == "done", job
    export = c.get(f"/api/assets/{job['result']['asset_id']}").json()
    assert export["mime"] == "video/mp4"

    # 9. the headline: creator's footage is the spine, generation only filled gaps
    final = c.get(f"/api/timelines/{tid}").json()
    led = final["token_ledger"]
    assert led["real_footage_s"] > led["generated_s"]
    assert led["naive_baseline_tokens"] > led["tokens_spent"]  # cheaper than full-gen
