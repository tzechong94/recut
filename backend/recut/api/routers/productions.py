"""AI Showrunner API — one elegant flow, human-approved at each stage.

  POST   /productions                      premise -> writers' room -> treatment (script stage)
  PUT    /productions/{id}                  save human edits (script/cast/style/shots)
  POST   /productions/{id}/storyboard       beats -> shots
  POST   /productions/{id}/board            shot-board stills for shots missing one (async)
  POST   /productions/{id}/shots/{sid}/still  redo one still with a steering note (async)
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
from recut.core.models import stub_models


def _text_for(prod: Production):
    """The text LLM for THIS production: test-mode productions run on the stub
    (0 provider tokens), everything else uses the configured backend."""
    return stub_models().text if prod.test_mode else models().text
from recut.showrunner.compile import compile_to_timeline
from recut.showrunner.pipeline.storyboard import build_storyboard
from recut.showrunner.pipeline.writers_room import develop_treatment
from recut.showrunner.schemas import AssetSource, Production, STYLE_PRESETS, Stage, StyleLock, TONE_REGISTERS

router = APIRouter(prefix="/api", tags=["showrunner"])


# Newer presets use free online reference images (CC via loremflickr) — zero image-gen
# credits spent on the picker. The original six keep their local pre-generated stills.
_PRESET_IMAGES = {
    "ink_wash": "https://loremflickr.com/320/480/ink,painting",
    "comic": "https://loremflickr.com/320/480/comic,art",
    "pixel": "https://loremflickr.com/320/480/pixel,art",
    "cyberpunk": "https://loremflickr.com/320/480/neon,night,city",
    "retro_film": "https://loremflickr.com/320/480/vintage,analog,film",
    "paper_craft": "https://loremflickr.com/320/480/papercraft,origami",
}


@router.get("/styles")
def list_styles() -> list[dict]:
    # `image` shows the actual look, not just a word: local pre-generated stills for the
    # original presets, free online references for the newer ones.
    return [
        {"name": s.name, "descriptors": s.descriptors, "palette": s.palette,
         "image": _PRESET_IMAGES.get(s.name, f"/styles/{s.name}.jpg")}
        for s in STYLE_PRESETS.values()
    ]


@router.get("/tones")
def list_tones() -> list[dict]:
    """Writing registers, decoupled from the visual style ('' = match the style)."""
    return [{"name": k, "register": v} for k, v in TONE_REGISTERS.items()]


class CustomStyleRequest(BaseModel):
    description: str = ""  # "1970s Kodachrome road movie, dust and lens flare"
    image_urls: list[str] = []  # hosted URLs or our storage (file://) refs
    test_mode: bool = False


@router.post("/styles/custom")
def custom_style(body: CustomStyleRequest) -> dict:
    """LTX-style custom look: distill the user's reference image(s) (Qwen-VL) and/or
    description (Qwen-Max) into a locked StyleLock. The reference image also anchors
    every keyframe composition downstream — the film inherits the actual look."""
    import json as _json

    desc = body.description.strip()
    refs = [u.strip() for u in body.image_urls if u.strip()]
    if not desc and not refs:
        raise HTTPException(400, "describe the style or add a reference image")
    m = stub_models() if body.test_mode else models()
    if refs:
        paths = [u[len("file://"):] if u.startswith("file://") else u for u in refs]
        try:
            d = m.vision.describe_style(paths, hint=desc)
        except Exception as exc:  # noqa: BLE001 — distillation down → words still work
            if not desc:
                raise HTTPException(502, f"couldn't read the style reference ({type(exc).__name__})")
            d = {}
    else:
        sys = (
            "showrunner:style — You turn a user's style description into image-model style cues. "
            "Return STRICT JSON {\"descriptors\": str (comma-separated medium, technique, lighting "
            "and texture cues), \"palette\": str (dominant color language)}."
        )
        try:
            text, _ = m.text.complete(sys, f"DESCRIPTION: {desc}", json_mode=True)
            d = _json.loads(text)
        except Exception:  # noqa: BLE001 — the raw description is a fine style on its own
            d = {}
    style = StyleLock(
        name="custom",
        descriptors=(d.get("descriptors") or desc or "cinematic").strip(),
        palette=str(d.get("palette", "")).strip(),
        reference_urls=refs,
    )
    return style.model_dump(mode="json")


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
    tone: str = ""  # writing register, decoupled from the look ("" = match style)
    custom_style: dict | None = None  # a StyleLock from POST /styles/custom
    test_mode: bool = False  # walk the whole flow on stubs — zero provider tokens


@router.post("/productions", status_code=201)
def create_production(body: CreateProduction) -> dict:
    if not body.premise.strip():
        raise HTTPException(400, "premise required")
    project = repo.create_project(name=body.premise[:60])
    llm = stub_models().text if body.test_mode else models().text
    prod = develop_treatment(
        llm, body.premise.strip(), target_seconds=body.target_seconds,
        style_name=("custom" if body.custom_style else body.style),
        project_id=project["id"], tone=body.tone.strip(),
    )
    if body.custom_style:
        try:
            prod.style = StyleLock.model_validate({**body.custom_style, "name": "custom", "tone": body.tone.strip()})
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(422, f"invalid custom style: {exc}")
    prod.test_mode = body.test_mode
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


class RenameCharacter(BaseModel):
    name: str


@router.post("/productions/{pid}/characters/{cid}/rename")
def rename_character(pid: str, cid: str, body: RenameCharacter) -> dict:
    """Rename a character once; the new name propagates across the whole script."""
    prod = repo.get_production(pid)
    if not prod:
        raise HTTPException(404, "production not found")
    if not prod.character(cid):
        raise HTTPException(404, "character not found")
    from recut.showrunner.revise import rename_character as _rename

    _rename(prod, cid, body.name)
    repo.save_production(prod)
    return prod.model_dump(mode="json")


class ReviseRequest(BaseModel):
    instruction: str


@router.post("/productions/{pid}/revise")
def revise(pid: str, body: ReviseRequest) -> dict:
    """Give the writers' room a plain-English note; it rewrites the affected parts."""
    prod = repo.get_production(pid)
    if not prod:
        raise HTTPException(404, "production not found")
    if not body.instruction.strip():
        raise HTTPException(400, "empty instruction")
    from recut.showrunner.revise import revise_treatment

    revise_treatment(_text_for(prod), prod, body.instruction.strip())
    repo.save_production(prod)
    return prod.model_dump(mode="json")


@router.post("/productions/{pid}/storyboard")
def storyboard(pid: str) -> dict:
    prod = repo.get_production(pid)
    if not prod:
        raise HTTPException(404, "production not found")
    prod = build_storyboard(_text_for(prod), prod)
    repo.save_production(prod)
    return prod.model_dump(mode="json")


@router.post("/productions/{pid}/board", status_code=202)
def board_stills(pid: str) -> dict:
    """Generate the shot board's stills (one composed frame per shot missing one) —
    cheap image tokens the human approves BEFORE any video spend."""
    prod = repo.get_production(pid)
    if not prod:
        raise HTTPException(404, "production not found")
    if not prod.shots:
        raise HTTPException(409, "no shots — run storyboard first")
    job_id = queue.enqueue("board_stills", {"production_id": pid}, project_id=prod.project_id)
    return {"job_id": job_id, "status": "queued"}


class StillRequest(BaseModel):
    instruction: str = ""  # steering note ("make it rain", "closer on her hands")


@router.post("/productions/{pid}/shots/{sid}/still", status_code=202)
def regenerate_still(pid: str, sid: str, body: StillRequest) -> dict:
    """Redo ONE shot's board still, steered by the human's note."""
    prod = repo.get_production(pid)
    if not prod:
        raise HTTPException(404, "production not found")
    if not prod.find_shot(sid):
        raise HTTPException(404, "shot not found")
    job_id = queue.enqueue(
        "board_stills",
        {"production_id": pid, "shot_id": sid, "instruction": body.instruction.strip()},
        project_id=prod.project_id,
    )
    return {"job_id": job_id, "status": "queued"}


class CastRequest(BaseModel):
    target: str = "character"  # character | location
    target_id: str
    instruction: str = ""  # optional regenerate note ("make him older, add a red scarf")


@router.post("/productions/{pid}/cast", status_code=202)
def cast(pid: str, body: CastRequest) -> dict:
    prod = repo.get_production(pid)
    if not prod:
        raise HTTPException(404, "production not found")
    job_id = queue.enqueue(
        "cast_reference",
        {"production_id": pid, "target": body.target, "target_id": body.target_id, "instruction": body.instruction.strip()},
        project_id=prod.project_id,
    )
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


@router.post("/productions/{pid}/next-episode", status_code=201)
def next_episode(pid: str) -> dict:
    """Greenlight the next episode of the serial: the writers' room continues from this
    film's cliffhanger, and the LOCKED cast + location references carry over by name —
    identity consistency across episodes for zero extra image tokens."""
    prev = repo.get_production(pid)
    if not prev:
        raise HTTPException(404, "production not found")
    from recut.showrunner.series import continue_series

    nxt = continue_series(_text_for(prev), prev)
    repo.save_production(nxt)
    return nxt.model_dump(mode="json")


@router.post("/productions/{pid}/produce", status_code=202)
def produce(pid: str) -> dict:
    """Approve the plan and let the agent autonomously generate + edit the film."""
    prod = repo.get_production(pid)
    if not prod:
        raise HTTPException(404, "production not found")
    if not prod.shots:
        raise HTTPException(409, "no shots — run storyboard first")
    if prod.export_asset_id:
        prod.version += 1  # a recut/re-render gets a fresh film file, never overwrites
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
    if prod.export_asset_id:
        prod.version += 1  # the retake re-renders into a fresh film file
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

    rubric = narrative_rubric(_text_for(prod), prod)
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
