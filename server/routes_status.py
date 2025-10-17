from typing import Any, Dict
from fastapi import APIRouter, Header

from .main import all_status  # temporary import; will refactor once split


router = APIRouter()


@router.get('/api/status')
async def status_proxy(authorization: str | None = Header(None), projectId: str | None = None, runId: str | None = None) -> Dict[str, Any]:
    # proxy to existing function to minimize changes initially
    return await all_status(authorization, projectId, runId)


