"""
Pydantic models for API requests.
"""
from typing import Optional
from pydantic import BaseModel, Field


class PreprocessReq(BaseModel):
    page: str
    figma_url: str = Field(alias='figmaUrl')
    out_dir: Optional[str] = Field(default=None, alias='outDir')
    verbose: bool = False
    project_name: Optional[str] = Field(default=None, alias='projectName')


class TestsReq(BaseModel):
    run_dir: Optional[str] = Field(default=None, alias='runDir')
    project_id: Optional[str] = Field(default=None, alias='projectId')
    source_id: int = Field(alias='sourceId')
    target_id: int = Field(alias='targetId')
    goal: str
    max_minutes: Optional[int] = Field(default=2, alias='maxMinutes')


class AuthReq(BaseModel):
    email: str
    password: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None

