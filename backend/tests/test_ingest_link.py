"""Link-fetch adapter — clean direct-URL path, platform detection, and the off-by-default gate."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from recut.api.main import create_app
from recut.core import config, repo
from recut.pipeline import ingest_link
from recut.pipeline.ingest_link import (
    DirectUrlFetcher,
    LinkFetchError,
    detect_platform,
)


def test_detect_platform():
    assert detect_platform("https://www.instagram.com/reel/abc") == "Instagram"
    assert detect_platform("https://www.tiktok.com/@x/video/1") == "TikTok"
    assert detect_platform("https://youtu.be/x") == "YouTube"
    assert detect_platform("https://cdn.example.com/a.mp4") == "web"


class _Resp:
    def __init__(self, status, ct, content=b"data"):
        self.status_code = status
        self.headers = {"content-type": ct}
        self.content = content


def test_direct_url_fetch_accepts_video(monkeypatch):
    monkeypatch.setattr(ingest_link.httpx, "get", lambda *a, **k: _Resp(200, "video/mp4", b"\x00mp4"))
    media = DirectUrlFetcher().fetch("https://cdn.example.com/clip.mp4")
    assert media.mime == "video/mp4" and media.data == b"\x00mp4"


def test_direct_url_fetch_rejects_non_video(monkeypatch):
    monkeypatch.setattr(ingest_link.httpx, "get", lambda *a, **k: _Resp(200, "text/html"))
    with pytest.raises(LinkFetchError):
        DirectUrlFetcher().fetch("https://instagram.com/reel/abc")


def test_endpoint_disabled_by_default():
    client = TestClient(create_app())
    pid = client.post("/api/projects", json={"name": "p"}).json()["id"]
    r = client.post(f"/api/projects/{pid}/ingest-link", json={"url": "https://x/clip.mp4"})
    assert r.status_code == 403
    assert "disabled" in r.json()["detail"].lower()


def test_endpoint_ingests_when_enabled(monkeypatch):
    monkeypatch.setenv("RECUT_ENABLE_LINK_FETCH", "true")
    config.get_settings.cache_clear()

    # avoid real network: stub the fetcher to return a tiny clip
    from recut.pipeline.ingest_link import FetchedMedia

    monkeypatch.setattr(
        "recut.api.routers.ingest.get_link_fetcher",
        lambda s=None: type("F", (), {"fetch": lambda self, url: FetchedMedia(b"\x00mp4", "video/mp4", url, platform="web")})(),
    )
    client = TestClient(create_app())
    pid = client.post("/api/projects", json={"name": "p"}).json()["id"]
    r = client.post(f"/api/projects/{pid}/ingest-link", json={"url": "https://cdn.example.com/clip.mp4"})
    assert r.status_code == 201, r.text
    asset = r.json()
    assert asset["kind"] == "reference" and asset["meta"]["source_url"].endswith("clip.mp4")
    config.get_settings.cache_clear()
