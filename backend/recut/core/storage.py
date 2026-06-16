"""Storage behind an interface so OSS is a config change, not a rewrite.

Two implementations:
  S3Storage    — boto3 against MinIO (local) or OSS (Alibaba). Identical API.
  LocalStorage — filesystem, for tests and offline runs with no MinIO up.

All media (references, uploads, generated clips, stand-ins, exports) goes through
here. Keys are content-addressed where helpful for render resumability.
"""

from __future__ import annotations

import hashlib
import os
import shutil
from abc import ABC, abstractmethod
from pathlib import Path

from recut.core.config import Settings, get_settings


def content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


class Storage(ABC):
    @abstractmethod
    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str: ...

    @abstractmethod
    def put_file(self, key: str, path: str, content_type: str = "application/octet-stream") -> str: ...

    @abstractmethod
    def get(self, key: str) -> bytes: ...

    @abstractmethod
    def get_to_file(self, key: str, dest: str) -> str: ...

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def url(self, key: str) -> str: ...


class LocalStorage(Storage):
    """Filesystem-backed. Default for tests; no external service required."""

    def __init__(self, root: str, public_base: str | None = None):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.public_base = public_base or self.root.as_uri()

    def _p(self, key: str) -> Path:
        p = self.root / key
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        self._p(key).write_bytes(data)
        return key

    def put_file(self, key: str, path: str, content_type: str = "application/octet-stream") -> str:
        shutil.copyfile(path, self._p(key))
        return key

    def get(self, key: str) -> bytes:
        return self._p(key).read_bytes()

    def get_to_file(self, key: str, dest: str) -> str:
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(self._p(key), dest)
        return dest

    def exists(self, key: str) -> bool:
        return (self.root / key).exists()

    def url(self, key: str) -> str:
        return f"{self.public_base.rstrip('/')}/{key}"


class S3Storage(Storage):
    """boto3 against MinIO/OSS. Lazy-imports boto3 so tests don't need it."""

    def __init__(self, settings: Settings):
        import boto3  # local import keeps the dep optional for unit tests
        from botocore.config import Config as BotoConfig

        self.bucket = settings.s3_bucket
        self.public_base = settings.s3_public_base
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
        )
        self._ensure_bucket()

    def _ensure_bucket(self) -> None:
        try:
            self._client.head_bucket(Bucket=self.bucket)
        except Exception:
            try:
                self._client.create_bucket(Bucket=self.bucket)
            except Exception:
                pass

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        self._client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)
        return key

    def put_file(self, key: str, path: str, content_type: str = "application/octet-stream") -> str:
        with open(path, "rb") as f:
            self._client.put_object(Bucket=self.bucket, Key=key, Body=f, ContentType=content_type)
        return key

    def get(self, key: str) -> bytes:
        return self._client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def get_to_file(self, key: str, dest: str) -> str:
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        self._client.download_file(self.bucket, key, dest)
        return dest

    def exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False

    def url(self, key: str) -> str:
        return f"{self.public_base.rstrip('/')}/{key}"


def get_storage(settings: Settings | None = None) -> Storage:
    s = settings or get_settings()
    # Use local filesystem when explicitly asked (tests) or when no S3 endpoint set.
    backend = os.environ.get("RECUT_STORAGE_BACKEND", "").lower()
    if backend == "local" or not s.s3_endpoint:
        root = s.work_dir.rstrip("/") + "/storage"
        return LocalStorage(root)
    return S3Storage(s)
