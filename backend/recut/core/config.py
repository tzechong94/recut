"""Config — env-driven, no hardcoded endpoints. Local-first: the same code runs
locally (Postgres/MinIO/stub models) and on Alibaba (RDS/OSS/Model Studio) by
swapping env vars. Nothing in the codebase knows which it is."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="RECUT_", env_file=".env", extra="ignore")

    # --- storage (S3-compatible: MinIO locally, OSS on Alibaba) ---
    s3_endpoint: str = "http://localhost:9000"
    s3_region: str = "us-east-1"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "recut"
    s3_public_base: str = "http://localhost:9000/recut"  # for browser-reachable URLs

    # --- database ---
    database_url: str = "postgresql+psycopg://recut:recut@localhost:5432/recut"

    # --- model layer ---
    # "stub"  -> high-fidelity deterministic local stubs (no key needed)
    # "qwen"  -> real DashScope / Model Studio (set dashscope_api_key)
    model_backend: str = "stub"
    dashscope_api_key: str = ""
    # DashScope endpoint. Leave blank for the SDK default (China). International accounts
    # (e.g. Singapore) use https://dashscope-intl.aliyuncs.com/api/v1
    dashscope_base_url: str = ""
    qwen_vl_model: str = "qwen-vl-max"
    qwen_text_model: str = "qwen-max"
    asr_model: str = "paraformer-v2"
    wan_model: str = "wanx2.1-t2v-turbo"
    qwen_image_model: str = "wanx2.1-t2i-turbo"
    cosyvoice_model: str = "cosyvoice-v1"

    # --- token / cost discipline ---
    project_token_cap: int = 200_000  # hard ceiling on generation tokens per project

    # --- media / render ---
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"
    work_dir: str = "/tmp/recut"
    assets_dir: str = ""  # repo /assets, resolved at runtime if empty

    # --- worker ---
    worker_poll_interval_s: float = 0.5
    job_max_attempts: int = 3


@lru_cache
def get_settings() -> Settings:
    return Settings()
