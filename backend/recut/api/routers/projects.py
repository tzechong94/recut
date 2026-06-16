from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from recut.core import repo

router = APIRouter(prefix="/api/projects", tags=["projects"])


class CreateProject(BaseModel):
    name: str = "Untitled project"
    tone: str = "#5B3DF5"


class UpdateProject(BaseModel):
    name: str | None = None
    stage: int | None = None
    tone: str | None = None


@router.get("")
def list_projects() -> list[dict]:
    return repo.list_projects()


@router.post("", status_code=201)
def create_project(body: CreateProject) -> dict:
    return repo.create_project(name=body.name, tone=body.tone)


@router.get("/{project_id}")
def get_project(project_id: str) -> dict:
    p = repo.get_project(project_id)
    if not p:
        raise HTTPException(404, "project not found")
    return p


@router.patch("/{project_id}")
def update_project(project_id: str, body: UpdateProject) -> dict:
    p = repo.update_project(project_id, name=body.name, stage=body.stage, tone=body.tone)
    if not p:
        raise HTTPException(404, "project not found")
    return p


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str) -> None:
    if not repo.delete_project(project_id):
        raise HTTPException(404, "project not found")
