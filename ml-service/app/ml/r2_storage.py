import os
from pathlib import Path

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
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


def upload_file(local_path: Path, key: str) -> None:
    """Best-effort — training already succeeded and saved locally by the
    time this is called; a persistence failure here shouldn't fail the
    /forecast/train request itself, just leave the model un-backed-up until
    the next successful train."""
    if not _BUCKET:
        return
    try:
        _client().upload_file(str(local_path), _BUCKET, key)
    except ClientError:
        pass


def download_file(key: str, local_path: Path) -> bool:
    """Returns True if a model was actually found and pulled down from R2 —
    the caller falls back to a naive prediction only when this is False
    (i.e. truly never trained), not merely because this container's own
    local disk was just wiped by a fresh deploy/restart."""
    if not _BUCKET:
        return False
    try:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        _client().download_file(_BUCKET, key, str(local_path))
        return True
    except ClientError:
        return False
