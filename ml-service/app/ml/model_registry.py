import json
import os
import shutil
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.ml import r2_storage, random_forest, xgboost_model, material_ratios
from app.ml.feature_engineering import FEATURE_COLS

# Which trained model is "the" model, and only ever a complete one.
#
# Every training run writes a new VERSION: its own folder of artifacts
# (Random Forest, XGBoost, material-ratio table), locally under
# trained_models/<version>/ and in R2 under models/<version>/. Only once all
# of them are saved AND uploaded does the run switch manifest.json — a small
# file naming the active version plus its training metadata (when, how many
# rows/projects, metrics, confidence). The manifest goes up to R2 last and is
# replaced locally last, so a run that fails anywhere before that (bad data,
# an R2 upload error, a crash) leaves the previous working model active and
# untouched.
#
# Forecasting loads only the version the manifest names. No manifest (never
# trained), a manifest whose artifacts can't be fetched, or one written for a
# different feature set all mean "no trained model" — forecasting is then
# BLOCKED (see forecasting_service.ModelNotAvailable), never silently replaced
# by a fallback calculation presented as an AI forecast.
#
# After a Render restart wipes the local disk, the manifest and the version
# it names are pulled back down from R2 on the first request — no retraining.
MODELS_DIR = Path("trained_models")
MANIFEST_NAME = "manifest.json"
R2_PREFIX = "models"
ARTIFACTS = [random_forest.FILE_NAME, xgboost_model.FILE_NAME, material_ratios.FILE_NAME]


@dataclass
class ActiveModel:
    manifest: dict
    rf: Any
    xgb: Any
    ratio_table: dict

    @property
    def version(self) -> str:
        return self.manifest["version"]


_cache: ActiveModel | None = None
_cache_lock = threading.Lock()


def _manifest_path() -> Path:
    return MODELS_DIR / MANIFEST_NAME


def _r2_key(*parts: str) -> str:
    return "/".join([R2_PREFIX, *parts])


def new_version() -> str:
    """Sortable, unique-enough for one service: UTC timestamp to the microsecond."""
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def publish(version: str, rf, xgb, ratio_table: dict, metadata: dict) -> dict:
    """Saves and uploads every artifact of `version`, then makes it the active
    model by switching the manifest. Raises (leaving the previous active model
    in place) if anything fails before the switch."""
    version_dir = MODELS_DIR / version
    version_dir.mkdir(parents=True, exist_ok=True)
    pending_manifest = MODELS_DIR / f"{MANIFEST_NAME}.pending"
    try:
        random_forest.save(rf, version_dir / random_forest.FILE_NAME)
        xgboost_model.save(xgb, version_dir / xgboost_model.FILE_NAME)
        material_ratios.save(ratio_table, version_dir / material_ratios.FILE_NAME)
        for name in ARTIFACTS:
            r2_storage.upload_file_strict(version_dir / name, _r2_key(version, name))

        manifest = {
            **metadata,
            "version":      version,
            "feature_cols": FEATURE_COLS,
            "artifacts":    ARTIFACTS,
            "storage":      "r2" if r2_storage.is_configured() else "local",
        }
        pending_manifest.write_text(json.dumps(manifest, indent=2))
        r2_storage.upload_file_strict(pending_manifest, _r2_key(MANIFEST_NAME))
        os.replace(pending_manifest, _manifest_path())
    except Exception:
        pending_manifest.unlink(missing_ok=True)
        shutil.rmtree(version_dir, ignore_errors=True)
        raise

    global _cache
    with _cache_lock:
        _cache = ActiveModel(manifest, rf, xgb, ratio_table)
    _prune_local_versions(keep=version)
    return manifest


def _prune_local_versions(keep: str) -> None:
    # Older versions stay in R2 (a record of past runs); locally only the
    # active one is worth the disk space.
    for path in MODELS_DIR.iterdir():
        if path.is_dir() and path.name != keep:
            shutil.rmtree(path, ignore_errors=True)


def _read_manifest() -> tuple[dict | None, str | None]:
    path = _manifest_path()
    if not path.exists() and not r2_storage.download_file(_r2_key(MANIFEST_NAME), path):
        return None, "No model has been trained yet."
    try:
        manifest = json.loads(path.read_text())
        if not isinstance(manifest.get("version"), str):
            raise ValueError("no version")
        return manifest, None
    except (ValueError, KeyError):
        return None, "The saved model manifest is unreadable — retrain the model."


def load_active() -> tuple[ActiveModel | None, str | None]:
    """The active trained model, or (None, why not)."""
    global _cache
    manifest, problem = _read_manifest()
    if manifest is None:
        return None, problem
    if manifest.get("feature_cols") != FEATURE_COLS:
        return None, "The saved model was trained on a different feature set than this version of the service uses — retrain the model."

    version = manifest["version"]
    with _cache_lock:
        if _cache is not None and _cache.version == version:
            return _cache, None

    version_dir = MODELS_DIR / version
    for name in ARTIFACTS:
        path = version_dir / name
        if not path.exists() and not r2_storage.download_file(_r2_key(version, name), path):
            return None, f"The active model ({version}) is missing its {name} file and it couldn't be restored from storage — retrain the model."
    try:
        active = ActiveModel(
            manifest,
            random_forest.load(version_dir / random_forest.FILE_NAME),
            xgboost_model.load(version_dir / xgboost_model.FILE_NAME),
            material_ratios.load(version_dir / material_ratios.FILE_NAME),
        )
    except Exception as e:  # corrupt/incompatible file — report, don't crash the request
        return None, f"The active model ({version}) couldn't be loaded ({e}) — retrain the model."

    with _cache_lock:
        _cache = active
    return active, None


def status() -> dict:
    """For GET /forecast/model-status: trained or not, and the manifest's
    training metadata when it is."""
    active, problem = load_active()
    if active is None:
        return {"trained": False, "message": problem, "manifest": None}
    return {"trained": True, "message": None, "manifest": active.manifest}
