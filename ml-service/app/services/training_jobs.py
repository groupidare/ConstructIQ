import logging
import threading
import traceback
import uuid
from datetime import datetime, timezone

from app.services import training_service

# Training runs in the background: a full run (holdout fits, one pair of
# models per historical project for the leave-one-project-out evaluations,
# then the final models) can take longer than an HTTP request is allowed to
# stay open. POST /forecast/train starts it and returns at once; the caller
# polls GET /forecast/model-status for `training` until it reads succeeded or
# failed.
#
# One run at a time: a second start while one is running is refused (the
# route answers 409). The state lives in this process's memory — this
# service runs as a single instance — so a restart mid-run simply forgets
# the run; the previously active model is untouched either way, because
# model_registry only switches models at the very end of a successful run.
logger = logging.getLogger(__name__)


class TrainingAlreadyRunning(Exception):
    pass


_lock = threading.Lock()
_state: dict = {
    "job_id":      None,
    "status":      "idle",   # idle | running | succeeded | failed
    "started_at":  None,
    "finished_at": None,
    "error":       None,
    "result":      None,     # train_models() output on success
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def snapshot() -> dict:
    with _lock:
        return dict(_state)


def start() -> dict:
    with _lock:
        if _state["status"] == "running":
            raise TrainingAlreadyRunning("A training run is already in progress.")
        job_id = uuid.uuid4().hex
        _state.update(job_id=job_id, status="running", started_at=_now(),
                      finished_at=None, error=None, result=None)
    threading.Thread(target=_run, args=(job_id,), daemon=True, name=f"training-{job_id}").start()
    return snapshot()


def _finish(job_id: str, **fields) -> None:
    with _lock:
        if _state["job_id"] == job_id:
            _state.update(finished_at=_now(), **fields)


def _run(job_id: str) -> None:
    try:
        result = training_service.train_models()
        _finish(job_id, status="succeeded", result=result)
    except training_service.TrainingRejected as e:
        _finish(job_id, status="failed", error=str(e))
    except Exception as e:  # anything else: report it, keep the old model
        logger.error("Training run %s failed:\n%s", job_id, traceback.format_exc())
        _finish(job_id, status="failed", error=f"Training failed: {e}")
