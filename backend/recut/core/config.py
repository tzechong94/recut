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
    wan_model: str = "wan2.2-t2v-plus"
    # Valid wan2.2-t2v-plus sizes: 1080*1920, 1920*1080, 1440*1440, 1632*1248,
    # 1248*1632, 480*832, 832*480, 624*624. Use 1080*1920 for 9:16 (480*832 = cheaper/faster).
    wan_size: str = "1080*1920"
    wan_i2v_model: str = "wan2.2-i2v-plus"  # image-to-video (character consistency)
    # DRAFT tier: cheap rehearsal video (probe-verified on the intl key). A draft
    # production films with this, then promotes only the keepers to the plus model.
    wan_i2v_draft_model: str = "wan2.2-i2v-flash"
    # HAPPYHORSE tier (probe-verified on the intl key): native joint audio+video —
    # dialogue shots SPEAK with lip-sync, clips up to 15s (no loop artifact).
    happyhorse_i2v_model: str = "happyhorse-1.0-i2v"
    happyhorse_resolution: str = "720P"  # 720P | 1080P
    # --- per-shot ROUTING (bake-off verified 2026-07-03) ---
    # speaking shots film here in BOTH modes (pilot is the cheap dialogue rehearsal).
    # wan2.6-i2v accepts audio_url: the clip embeds OUR TTS exactly (xcorr 0.998) —
    # hard voice consistency + lip-sync + style fidelity 0.95. "@1080P" suffix ups the
    # native resolution (masters); default native res is happyhorse_resolution.
    dialogue_i2v_model: str = "wan2.6-i2v"
    # master-cut promotion targets ("strongest"): silent / speaking. Master dialogue
    # stays on wan2.6 (same voice pipeline — a master cut can never change a voice).
    master_i2v_model: str = "wan2.2-i2v-plus"  # strongest PORTRAIT-native silent model
    master_dialogue_i2v_model: str = "wan2.6-i2v@1080P"

    # --- price table (USD, EDITABLE estimates — correct against your DashScope bill) ---
    price_video_second: float = 0.10  # wan2.2-i2v-plus per output second (est.)
    price_video_second_draft: float = 0.02  # wan2.2-i2v-flash per output second (est.)
    price_video_second_happyhorse: float = 0.15  # happyhorse-1.0-i2v per second (est.)
    price_image: float = 0.03  # t2i / qwen-image-edit per image (est.)
    price_text_1k: float = 0.004  # qwen-max per 1k tokens, blended in/out (est.)
    price_voice_1k: float = 0.015  # qwen3-tts per 1k characters (est.)
    qwen_image_model: str = "wanx2.1-t2i-turbo"
    # qwen-image-edit composes the per-shot keyframe: same character, new location + style.
    qwen_image_edit_model: str = "qwen-image-edit"
    # TTS: qwen3-tts-flash is HTTP-based and served on the intl endpoint (CosyVoice's
    # websocket API is China-region only and 'ModelNotFound's on dashscope-intl).
    cosyvoice_model: str = "qwen3-tts-flash"
    cosyvoice_voice: str = "Cherry"  # intl voices: Cherry, Serena, Ethan, Chelsie, ...

    # --- token / cost discipline ---
    project_token_cap: int = 200_000  # hard ceiling on generation tokens per project

    # --- pacing: a shot budget derived from runtime so a 20s film is ~6 shots of ~3-4s,
    # not 22 jump-cuts of 1s. seconds_per_shot sets the cadence; min/max clamp each shot.
    seconds_per_shot: float = 4.0  # fewer, longer shots so dialogue lands (not jump-cuts)
    min_shot_s: float = 3.0
    max_shot_s: float = 8.0  # generous ceiling so a longer VO line is never clipped

    # --- generation model ---
    # ai_first  -> AI generates EVERY visual slot by default; the creator swaps in their
    #              own uploads per slot (revid.ai style). The default.
    # gap_fill  -> the brief's model: creator footage is the spine, AI fills only the
    #              auto slots (text cards + b-roll).
    generation_mode: str = "ai_first"

    # --- reference ingestion ---
    # Upload is the clean path. Link-fetch is best-effort and grey on platform terms,
    # so it is OFF by default and isolated behind an adapter. Direct video URLs and your
    # own hosted files work cleanly; IG/TikTok need yt-dlp and are your responsibility.
    enable_link_fetch: bool = False

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
