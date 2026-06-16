"""FastAPI app — the control plane the React editor talks to.

Spine routers are always mounted. Lane routers (analyse, agent, generation) are
mounted if present, so lanes add a router module + one include line without touching
this factory's core.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from recut.core.db import init_db
from recut.api.routers import assets, jobs, projects, recipes, timelines


def create_app() -> FastAPI:
    app = FastAPI(title="Recut API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # single-tenant local/demo; tighten for multi-tenant
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    def _startup() -> None:
        init_db()

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True, "service": "recut-api"}

    for mod in (projects, assets, recipes, timelines, jobs):
        app.include_router(mod.router)

    # Optional lane routers — mounted when the lane is built.
    for name in ("analyse", "agent", "generation"):
        try:
            mod = __import__(f"recut.api.routers.{name}", fromlist=["router"])
            app.include_router(mod.router)
        except Exception:
            pass

    return app


app = create_app()


def run() -> None:
    import uvicorn

    uvicorn.run("recut.api.main:app", host="0.0.0.0", port=8000, reload=False)


if __name__ == "__main__":
    run()
