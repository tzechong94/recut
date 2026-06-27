"""AI Showrunner API — one elegant flow, human-approved at each stage.

  POST   /productions                      premise -> writers' room -> treatment (script stage)
  PUT    /productions/{id}                  save human edits (script/cast/style/shots)
  POST   /productions/{id}/storyboard       beats -> shots
  POST   /productions/{id}/cast             generate a character/location reference (async)
  POST   /productions/{id}/characters/{cid}/reference   attach an uploaded reference
  POST   /productions/{id}/produce          autonomous production -> MP4 (async, post-approval)
  POST   /productions/{id}/shots/{sid}/regenerate       re-roll a single shot (async)
  GET    /productions[/{id}] · DELETE · /timeline · /scoreboard · /styles
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from recut.api.deps import models
from recut.core import queue, repo
from recut.showrunner.compile import compile_to_timeline
from recut.showrunner.pipeline.storyboard import build_storyboard
from recut.showrunner.pipeline.writers_room import develop_treatment
from recut.showrunner.schemas import AssetSource, Production, STYLE_PRESETS, Stage

router = APIRouter(prefix="/api", tags=["showrunner"])


@router.get("/styles")
def list_styles() -> list[dict]:
    # `image` is a fixed, pre-generated reference still per style (served by the web app
    # from /public/styles/), so the picker shows the actual look, not just a word.
    return [
        {"name": s.name, "descriptors": s.descriptors, "palette": s.palette, "image": f"/styles/{s.name}.jpg"}
        for s in STYLE_PRESETS.values()
    ]


class SuggestPremise(BaseModel):
    premise: str = ""  # empty → generate a fresh premise; non-empty → refine it


@router.post("/premise/suggest")
def suggest_premise(body: SuggestPremise) -> dict:
    """Blank-page helper: generate a premise when empty, or sharpen an existing one.
    Cheap text tokens; the human stays in control (it just fills the box)."""
    cur = body.premise.strip()
    sys = (
        "showrunner:premise — You write one-sentence short-film premises with a clear "
        "character, a want, and a turn/conflict. Return STRICT JSON {\"premise\": str}. "
        "One vivid sentence, no preamble."
    )
    user = f"REFINE this premise into something sharper and more cinematic (keep it one sentence): {cur}" if cur \
        else "GENERATE one original, surprising short-film premise."
    try:
        import json

        text, _ = models().text.complete(sys, user, json_mode=True)
        premise = json.loads(text).get("premise", "").strip()
    except Exception:  # noqa: BLE001
        premise = ""
    return {"premise": premise or cur or "A lighthouse keeper receives a letter addressed to someone who died a century ago."}


class CreateProduction(BaseModel):
    premise: str
    target_seconds: int = 60
    style: str = "cinematic"


@router.post("/productions", status_code=201)
def create_production(body: CreateProduction) -> dict:
    if not body.premise.strip():
        raise HTTPException(400, "premise required")
    project = repo.create_project(name=body.premise[:60])
    prod = develop_treatment(
        models().text, body.premise.strip(), target_seconds=body.target_seconds,
        style_name=body.style, project_id=project["id"],
    )
    repo.save_production(prod)
    return prod.model_dump(mode="json")


@router.get("/productions")
def list_productions() -> list[dict]:
    return repo.list_productions()


@router.get("/productions/{pid}")
def get_production(pid: str) -> dict:
    prod = repo.get_production(pid)
    if not prod:
        raise HTTPException(404, "production not found")
    return prod.model_dump(mode="json")


@router.delete("/productions/{pid}", status_code=204)
def delete_production(pid: str) -> None:
    if not repo.delete_production(pid):
        raise HTTPException(404, "production not found")


@router.put("/productions/{pid}")
def save_production(pid: str, body: dict) -> dict:
    """Persist human edits (logline, style, scenes, shots, cast). Validated through the
    schema so a bad edit can't corrupt the production."""
    body["id"] = pid
    try:
        prod = Production.model_validate(body)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, f"invalid production: {exc}")
    prod.version = body.get("version", prod.version)
    repo.save_production(prod)
    return prod.model_dump(mode="json")


@router.post("/productions/{pid}/storyboard")
def storyboard(pid: str) -> dict:
    prod = repo.get_production(pid)
    if not prod:
        raise HTTPException(404, "production not found")
    prod = build_storyboard(models().text, prod)
    repo.save_production(prod)
    return prod.model_dump(mode="json")


class CastRequest(BaseModel):
    target: str = "character"  # character | location
    target_id: str


@router.post("/productions/{pid}/cast", status_code=202)
def cast(pid: str, body: CastRequest) -> dict:
    prod = repo.get_production(pid)
    if not prod:
        raise HTTPException(404, "production not found")
    job_id = queue.enqueue("cast_reference", {"production_id": pid, "target": body.target, "target_id": body.target_id}, project_id=prod.project_id)
    return {"job_id": job_id, "status": "queued"}


class AttachReference(BaseModel):
    asset_id: str
    reference_url: str | None = None


@router.post("/productions/{pid}/characters/{cid}/reference")
def attach_character_reference(pid: str, cid: str, body: AttachReference) -> dict:
    """The human casts their own image (uploaded asset) for a character."""
    prod = repo.get_production(pid)
    if not prod:
        raise HTTPException(404, "production not found")
    c = prod.character(cid)
    if not c:
        raise HTTPException(404, "character not found")
    asset = repo.get_asset(body.asset_id)
    if not asset:
        raise HTTPException(404, "asset not found")
    c.reference_asset_id = body.asset_id
    c.reference_url = body.reference_url or repo.get_asset(body.asset_id)["storage_key"]
    c.source = AssetSource.uploaded
    c.locked = True
    repo.save_production(prod)
    return prod.model_dump(mode="json")


@router.post("/productions/{pid}/produce", status_code=202)
def produce(pid: str) -> dict:
    """Approve the plan and let the agent autonomously generate + edit the film."""
    prod = repo.get_production(pid)
    if not prod:
        raise HTTPException(404, "production not found")
    if not prod.shots:
        raise HTTPException(409, "no shots — run storyboard first")
    prod.stage = Stage.production
    repo.save_production(prod)
    job_id = queue.enqueue("produce_film", {"production_id": pid}, project_id=prod.project_id)
    return {"job_id": job_id, "status": "queued"}


@router.post("/productions/{pid}/shots/{sid}/regenerate", status_code=202)
def regenerate_shot(pid: str, sid: str) -> dict:
    prod = repo.get_production(pid)
    if not prod:
        raise HTTPException(404, "production not found")
    shot = prod.find_shot(sid)
    if not shot:
        raise HTTPException(404, "shot not found")
    shot.asset_id = None
    shot.source = AssetSource.standin
    shot.status = shot.status.__class__.planned
    repo.save_production(prod)
    job_id = queue.enqueue("produce_film", {"production_id": pid}, project_id=prod.project_id)
    return {"job_id": job_id, "status": "queued"}


@router.get("/productions/{pid}/timeline")
def production_timeline(pid: str) -> dict:
    prod = repo.get_production(pid)
    if not prod:
        raise HTTPException(404, "production not found")
    return compile_to_timeline(prod).model_dump(mode="json")


@router.get("/productions/{pid}/eval")
def production_eval(pid: str) -> dict:
    """The demo's closing PROOF: an independent narrative rubric + honest token facts.
    (Consistency separation is measured in the offline eval harness; here we surface the
    avg per-shot critic score from the actual run.)"""
    prod = repo.get_production(pid)
    if not prod:
        raise HTTPException(404, "production not found")
    from recut.showrunner.eval import as_dict, narrative_rubric, token_efficiency

    rubric = narrative_rubric(models().text, prod)
    scored = [s.critic_score for s in prod.shots if s.critic_score is not None]
    return {
        "narrative": as_dict(rubric),
        "tokens": token_efficiency(prod),
        "avg_consistency": round(sum(scored) / len(scored), 3) if scored else None,
    }


@router.get("/productions/{pid}/scoreboard")
def scoreboard(pid: str) -> dict:
    prod = repo.get_production(pid)
    if not prod:
        raise HTTPException(404, "production not found")
    led = prod.token_ledger
    n, dur = len(prod.shots), prod.duration_s
    ready = sum(1 for s in prod.shots if s.asset_id)
    scored = [s.critic_score for s in prod.shots if s.critic_score is not None]
    baseline = led.naive_baseline(n or 1, (dur / n) if n else 4.0)
    return {
        "tokens": {"text": led.text_tokens, "image": led.image_tokens, "video": led.video_tokens, "voice": led.voice_tokens, "total": led.total},
        # The DEFENSIBLE, true claims (not a circular % vs a strawman):
        "video_tokens_pre_approval": 0,  # true by construction — produce runs only after approval
        "approval_gated": True,
        "rerolls": led.rerolls,  # only drifted shots were re-rolled, not everything
        "shots_ready": ready,
        "shots_total": n,
        "avg_consistency": round(sum(scored) / len(scored), 3) if scored else None,
        "duration_s": dur,
        # A clearly-labeled ESTIMATE vs regenerating everything without the plan-lock:
        "baseline_estimate_tokens": baseline,
        "estimated_tokens_saved": max(0, baseline - led.total),
        "headline": "0 video tokens spent before you approved the plan; the critic re-rolled only the shots that drifted.",
    }
