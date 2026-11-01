import os
from pathlib import Path

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError
from dotenv import load_dotenv

# Same R2 credentials/bucket the backend uses (see
# backend/ConstructIQ.API/Services/R2FileStorageService.cs) — this service
# only ever touches its own "models/" prefix in that shared bucket.
# load_dotenv() mirrors forecasting_service.get_engine()'s own defensive
# call, so this module works standalone too, not just imported via main.py.
load_dotenv()

_BUCKET = os.getenv("R2_BUCKET_NAME")


def _client():
    return boto3.client(
        "s3",
        endpoint_url=os.getenv("R2_ENDPOINT_URL"),
        aws_access_key_id=os.getenv("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("R2_SECRET_ACCESS_KEY"),
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def is_configured() -> bool:
    """False for local dev with no R2 bucket set — trained models then only
    live on this machine's own disk (see model_registry)."""
    return bool(_BUCKET)


def upload_file_strict(local_path: Path, key: str) -> None:
    """A failure RAISES — never swallowed. model_registry uploads a training
    run's artifacts with this, so a model that didn't actually reach R2 is
    never made the active one (it would vanish on the next restart). No-op
    when R2 isn't configured at all (local dev)."""
    if not _BUCKET:
        return
    try:
        _client().upload_file(str(local_path), _BUCKET, key)
    except (ClientError, BotoCoreError) as e:
        raise RuntimeError(f"Uploading {key} to R2 failed: {e}") from e


def download_file(key: str, local_path: Path) -> bool:
    """Returns True if the file was actually found and pulled down from R2 —
    model_registry uses this to restore the active model after a fresh
    deploy/restart wiped this container's local disk. False means "not
    available" (never uploaded, or R2 unreachable/unconfigured)."""
    if not _BUCKET:
        return False
    try:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        _client().download_file(_BUCKET, key, str(local_path))
        return True
    except (ClientError, BotoCoreError):
        # BotoCoreError too (bad endpoint, no network, missing credentials)
        # — "couldn't fetch" must read as "not available", never crash the
        # forecast/status request that asked.
        return False
