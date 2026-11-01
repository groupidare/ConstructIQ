import os

from fastapi import Header, HTTPException

# Deployed as a public Web Service (Render's free tier has no Private Service
# option), so these routes are reachable by anyone who finds the URL — they
# do real DB queries scoped only by a client-supplied project_id, with no
# other access check. Required in production via ML_API_KEY; left unset (and
# so unenforced) for local dev, where there's no public exposure to protect
# against in the first place.
_EXPECTED_KEY = os.getenv("ML_API_KEY")


def verify_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if not _EXPECTED_KEY:
        return
    if x_api_key != _EXPECTED_KEY:
        raise HTTPException(status_code=403, detail="Invalid or missing API key.")
