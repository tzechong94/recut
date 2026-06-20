"""Download real, license-clean vertical clips from Pexels for testing the pipeline.

Pexels videos are free to use (https://www.pexels.com/license/). This pulls a few
SHORT, PORTRAIT clips into assets/samples/ so Qwen-VL / shot-detection / render get
real footage instead of flat color bars.

Setup (free):
  1. Get a key at https://www.pexels.com/api/  (30s signup)
  2. export PEXELS_API_KEY=...    (Singapore/anywhere — Pexels has no region gating)
  3. python scripts/fetch_sample_reels.py

Options:
  --query "factory tour" --query "street food"   # repeatable; defaults cover common reel themes
  --count 1            # clips per query
  --max-duration 30    # seconds; skip anything longer

NOTE: this does NOT touch TikTok/Instagram. Use your OWN posts or stock only — Recut's
whole point is borrowing the format, never someone else's footage.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

import httpx

OUT = Path(__file__).resolve().parent.parent / "assets" / "samples"
DEFAULT_QUERIES = [
    "person talking to camera vertical",
    "factory warehouse tour",
    "home renovation",
    "street food market",
]


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")[:30]


def _pick_portrait_file(video: dict) -> dict | None:
    files = [f for f in video.get("video_files", []) if f.get("height", 0) > f.get("width", 0)]
    if not files:
        return None
    # prefer ~1080-tall, reasonable size; fall back to the largest portrait file
    files.sort(key=lambda f: abs(f.get("height", 0) - 1280))
    return files[0]


def fetch(queries: list[str], count: int, max_duration: int) -> list[Path]:
    key = os.environ.get("PEXELS_API_KEY")
    if not key:
        print("PEXELS_API_KEY not set. Get a free key at https://www.pexels.com/api/ then:\n"
              "  export PEXELS_API_KEY=...\n", file=sys.stderr)
        sys.exit(2)
    OUT.mkdir(parents=True, exist_ok=True)
    saved: list[Path] = []
    with httpx.Client(headers={"Authorization": key}, timeout=60) as c:
        for q in queries:
            r = c.get(
                "https://api.pexels.com/videos/search",
                params={"query": q, "orientation": "portrait", "per_page": 5},
            )
            if r.status_code != 200:
                print(f"  ! search failed for {q!r}: {r.status_code} {r.text[:120]}", file=sys.stderr)
                continue
            got = 0
            for video in r.json().get("videos", []):
                if got >= count:
                    break
                if video.get("duration", 999) > max_duration:
                    continue
                vf = _pick_portrait_file(video)
                if not vf:
                    continue
                dest = OUT / f"real_{_slug(q)}_{video['id']}.mp4"
                with c.stream("GET", vf["link"]) as resp, open(dest, "wb") as fh:
                    for chunk in resp.iter_bytes():
                        fh.write(chunk)
                saved.append(dest)
                got += 1
                print(f"  ✓ {dest.name}  ({video.get('duration')}s, {vf.get('width')}x{vf.get('height')})  by {video.get('user',{}).get('name','?')} via Pexels")
    return saved


def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch license-clean vertical test clips from Pexels.")
    ap.add_argument("--query", action="append", dest="queries", help="search term (repeatable)")
    ap.add_argument("--count", type=int, default=1, help="clips per query")
    ap.add_argument("--max-duration", type=int, default=30, help="max clip length (s)")
    args = ap.parse_args()
    queries = args.queries or DEFAULT_QUERIES
    print(f"Fetching {args.count} clip(s) each for: {queries}")
    saved = fetch(queries, args.count, args.max_duration)
    print(f"\nSaved {len(saved)} clip(s) to {OUT}. Upload one as your reference in the editor.")


if __name__ == "__main__":
    main()
