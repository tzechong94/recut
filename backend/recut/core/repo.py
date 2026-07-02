"""Repository layer — the only place that reads/writes the DB documents.

Keeps the canonical timeline as a versioned JSON document (the source of truth) and
gives the API/worker a small, typed surface. Single-tenant for the demo; every query
is trivially scopeable by a future tenant_id.
"""

from __future__ import annotations

from recut.core.db import Asset, Job, ProductionRow, Project, RecipeRow, TimelineRow, session_scope
from recut.core.schemas import Recipe, Timeline


# --------------------------------------------------------------------------- #
#  Projects                                                                    #
# --------------------------------------------------------------------------- #
def create_project(name: str = "Untitled project", tone: str = "#5B3DF5") -> dict:
    with session_scope() as s:
        p = Project(name=name, tone=tone)
        s.add(p)
        s.flush()
        return _project_dict(p)


def list_projects() -> list[dict]:
    with session_scope() as s:
        rows = s.query(Project).order_by(Project.updated_at.desc()).all()
        return [_project_dict(p) for p in rows]


def get_project(project_id: str) -> dict | None:
    with session_scope() as s:
        p = s.get(Project, project_id)
        return _project_dict(p) if p else None


def update_project(project_id: str, **fields) -> dict | None:
    with session_scope() as s:
        p = s.get(Project, project_id)
        if not p:
            return None
        for k, v in fields.items():
            if v is not None and hasattr(p, k):
                setattr(p, k, v)
        s.flush()
        return _project_dict(p)


def delete_project(project_id: str) -> bool:
    with session_scope() as s:
        p = s.get(Project, project_id)
        if not p:
            return False
        s.delete(p)
        return True


def _project_dict(p: Project) -> dict:
    return {
        "id": p.id, "name": p.name, "stage": p.stage, "tone": p.tone,
        "token_cap": p.token_cap, "created_at": p.created_at, "updated_at": p.updated_at,
    }


# --------------------------------------------------------------------------- #
#  Assets                                                                      #
# --------------------------------------------------------------------------- #
def create_asset(
    *, kind: str, storage_key: str, project_id: str | None = None, mime: str = "application/octet-stream",
    duration_s: float = 0.0, width: int = 0, height: int = 0, content_hash: str = "", meta: dict | None = None,
) -> dict:
    with session_scope() as s:
        a = Asset(
            kind=kind, storage_key=storage_key, project_id=project_id, mime=mime,
            duration_s=duration_s, width=width, height=height, content_hash=content_hash, meta=meta or {},
        )
        s.add(a)
        s.flush()
        return _asset_dict(a)


def get_asset(asset_id: str) -> dict | None:
    with session_scope() as s:
        a = s.get(Asset, asset_id)
        return _asset_dict(a) if a else None


def assets_by_ids(ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    with session_scope() as s:
        rows = s.query(Asset).filter(Asset.id.in_(ids)).all()
        return {a.id: _asset_dict(a) for a in rows}


def _asset_dict(a: Asset) -> dict:
    return {
        "id": a.id, "project_id": a.project_id, "kind": a.kind, "storage_key": a.storage_key,
        "mime": a.mime, "duration_s": a.duration_s, "width": a.width, "height": a.height,
        "content_hash": a.content_hash, "meta": a.meta, "created_at": a.created_at,
    }


# --------------------------------------------------------------------------- #
#  Recipes                                                                     #
# --------------------------------------------------------------------------- #
def save_recipe(recipe: Recipe, *, saved: bool = False) -> Recipe:
    with session_scope() as s:
        existing = s.get(RecipeRow, recipe.recipe_id)
        doc = recipe.model_dump(mode="json")
        if existing:
            existing.doc = doc
            existing.name = recipe.name
            existing.saved = int(saved)
        else:
            s.add(RecipeRow(
                id=recipe.recipe_id, project_id=recipe.project_id,
                source_asset_id=recipe.source_asset_id, name=recipe.name, saved=int(saved), doc=doc,
            ))
        return recipe


def get_recipe(recipe_id: str) -> Recipe | None:
    with session_scope() as s:
        r = s.get(RecipeRow, recipe_id)
        return Recipe.model_validate(r.doc) if r else None


def list_saved_recipes() -> list[Recipe]:
    """Recipe library: formats the creator saved to reuse on new stories."""
    with session_scope() as s:
        rows = s.query(RecipeRow).filter(RecipeRow.saved == 1).order_by(RecipeRow.created_at.desc()).all()
        return [Recipe.model_validate(r.doc) for r in rows]


def set_recipe_saved(recipe_id: str, saved: bool) -> bool:
    with session_scope() as s:
        r = s.get(RecipeRow, recipe_id)
        if not r:
            return False
        r.saved = int(saved)
        return True


# --------------------------------------------------------------------------- #
#  Timelines (canonical, versioned)                                            #
# --------------------------------------------------------------------------- #
def save_timeline(timeline: Timeline) -> Timeline:
    with session_scope() as s:
        existing = s.get(TimelineRow, timeline.timeline_id)
        doc = timeline.model_dump(mode="json")
        if existing:
            existing.doc = doc
            existing.version = timeline.version
        else:
            s.add(TimelineRow(
                id=timeline.timeline_id, project_id=timeline.project_id or "",
                version=timeline.version, doc=doc,
            ))
        return timeline


def get_timeline(timeline_id: str) -> Timeline | None:
    with session_scope() as s:
        r = s.get(TimelineRow, timeline_id)
        return Timeline.model_validate(r.doc) if r else None


# --------------------------------------------------------------------------- #
#  Productions (the AI Showrunner film document)                               #
# --------------------------------------------------------------------------- #
def save_production(production) -> object:
    """Persist a Production (recut.showrunner.schemas.Production) as a JSON document."""
    from recut.showrunner.schemas import Production

    assert isinstance(production, Production)
    with session_scope() as s:
        existing = s.get(ProductionRow, production.id)
        doc = production.model_dump(mode="json")
        if existing:
            existing.doc = doc
            existing.title = production.title
            existing.stage = production.stage.value
        else:
            s.add(ProductionRow(
                id=production.id, project_id=production.project_id, title=production.title,
                stage=production.stage.value, doc=doc,
            ))
        return production


def get_production(production_id: str):
    from recut.showrunner.schemas import Production

    with session_scope() as s:
        r = s.get(ProductionRow, production_id)
        return Production.model_validate(r.doc) if r else None


def list_productions() -> list[dict]:
    """Compact gallery summaries. Includes what a home-screen card needs: logline,
    episode number, test-mode flag, and a COVER (the first shot-board still, so the
    gallery shows the film's actual look, not an icon)."""
    with session_scope() as s:
        rows = s.query(ProductionRow).order_by(ProductionRow.updated_at.desc()).all()
        out = []
        for r in rows:
            doc = r.doc or {}
            shots = [sh for sc in doc.get("scenes", []) for sh in sc.get("shots", [])]
            cover = next((sh.get("keyframe_asset_id") for sh in shots if sh.get("keyframe_asset_id")), None)
            out.append({
                "id": r.id, "title": r.title, "stage": r.stage, "updated_at": r.updated_at,
                "logline": doc.get("logline", ""),
                "style": (doc.get("style") or {}).get("name", ""),
                "episode": doc.get("episode", 1),
                "test_mode": doc.get("test_mode", False),
                "cover_asset_id": cover,
                "export_asset_id": doc.get("export_asset_id"),
                "n_shots": len(shots),
            })
        return out


def delete_production(production_id: str) -> bool:
    with session_scope() as s:
        r = s.get(ProductionRow, production_id)
        if not r:
            return False
        s.delete(r)
        return True


def latest_timeline_for_project(project_id: str) -> Timeline | None:
    with session_scope() as s:
        r = (
            s.query(TimelineRow)
            .filter(TimelineRow.project_id == project_id)
            .order_by(TimelineRow.version.desc(), TimelineRow.created_at.desc())
            .first()
        )
        return Timeline.model_validate(r.doc) if r else None
