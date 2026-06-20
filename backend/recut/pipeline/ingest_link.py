"""Link-fetch reference ingestion — the isolated, best-effort adapter.

Upload is the clean path. This adapter exists for convenience and is OFF by default
(RECUT_ENABLE_LINK_FETCH). Two backends, tried in order:

  DirectUrlFetcher — a directly-hosted video URL (your own OSS/CDN link). Always clean.
  YtDlpFetcher     — optional, uses yt-dlp if installed. Works for many sites; Instagram
                     and TikTok are grey on ToS and brittle (login walls, rate limits).
                     Best-effort, the operator's responsibility.

Nothing here scrapes a platform on its own; yt-dlp is a separate tool the operator
chooses to install. Recut's thesis stands: borrow the format, never reuse the footage.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path

import httpx

from recut.core.config import Settings, get_settings


class LinkFetchError(RuntimeError):
    """A reference link could not be fetched. Carries a user-facing reason."""


@dataclass
class FetchedMedia:
    data: bytes
    mime: str
    source_url: str
    title: str = ""
    platform: str = "web"


def detect_platform(url: str) -> str:
    u = url.lower()
    if "tiktok" in u:
        return "TikTok"
    if "instagram" in u:
        return "Instagram"
    if "youtube" in u or "youtu.be" in u:
        return "YouTube"
    return "web"


class LinkFetcher(ABC):
    @abstractmethod
    def fetch(self, url: str) -> FetchedMedia: ...


class DirectUrlFetcher(LinkFetcher):
    """Fetch a plain, directly-hosted video file. The clean path for link ingestion."""

    def fetch(self, url: str) -> FetchedMedia:
        try:
            r = httpx.get(url, follow_redirects=True, timeout=60)
        except Exception as exc:  # noqa: BLE001
            raise LinkFetchError(f"could not reach URL: {exc}")
        ct = r.headers.get("content-type", "").split(";")[0].strip()
        if r.status_code != 200 or not ct.startswith("video/"):
            raise LinkFetchError(
                f"not a direct video URL (status {r.status_code}, type {ct or 'unknown'})"
            )
        return FetchedMedia(data=r.content, mime=ct, source_url=url, platform=detect_platform(url))


class YtDlpFetcher(LinkFetcher):
    """Optional best-effort fetch via yt-dlp. Grey on IG/TikTok ToS; may break anytime."""

    def fetch(self, url: str) -> FetchedMedia:
        if not shutil.which("yt-dlp"):
            raise LinkFetchError("yt-dlp not installed (pip install yt-dlp), or use upload.")
        tmp = tempfile.mkdtemp(prefix="recut-link-")
        out_tpl = str(Path(tmp) / "ref.%(ext)s")
        try:
            proc = subprocess.run(
                ["yt-dlp", "-f", "mp4/bestvideo+bestaudio/best", "--no-playlist", "-o", out_tpl, url],
                capture_output=True, text=True, timeout=180,
            )
        except subprocess.TimeoutExpired:
            raise LinkFetchError("yt-dlp timed out — the platform likely blocked it. Use upload.")
        if proc.returncode != 0:
            raise LinkFetchError(f"yt-dlp could not fetch this link (often a login wall): {proc.stderr[-200:].strip()}")
        files = sorted(Path(tmp).glob("ref.*"))
        if not files:
            raise LinkFetchError("yt-dlp produced no file.")
        f = files[0]
        return FetchedMedia(
            data=f.read_bytes(),
            mime="video/mp4",
            source_url=url,
            title=f.stem,
            platform=detect_platform(url),
        )


class CompositeFetcher(LinkFetcher):
    """Try each backend in order; raise with the last reason if all fail."""

    def __init__(self, fetchers: list[LinkFetcher]):
        self.fetchers = fetchers

    def fetch(self, url: str) -> FetchedMedia:
        last = "no fetcher available"
        for fetcher in self.fetchers:
            try:
                return fetcher.fetch(url)
            except LinkFetchError as exc:
                last = str(exc)
        raise LinkFetchError(last)


def get_link_fetcher(settings: Settings | None = None) -> LinkFetcher:
    s = settings or get_settings()
    return CompositeFetcher([DirectUrlFetcher(), YtDlpFetcher()])
