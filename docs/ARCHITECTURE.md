# Architecture

![Recut architecture](architecture.svg)

Recut is a Next.js 15 app whose API routes orchestrate Alibaba Cloud Model
Studio (DashScope, ap-southeast-1) models behind a manifest/adapter gateway.
All generated media is mirrored to durable local storage the moment it is
produced, because hosted result URLs expire.

```mermaid
flowchart LR
    subgraph Browser["Browser (React 19)"]
        M["Director's Monitor\nCast · Script · Shots · Edit"]
        T["Guided demo tour\n(?tour=1, staged replay)"]
        TL["Timeline editor\ntrim / split / reorder"]
    end

    subgraph Next["Next.js 15 App Router (API routes)"]
        PLAN["/api/agent/plan\ndirector skill"]
        STYLE["/api/agent/style"]
        GEN["/api/generate\nimage · video · tts · critique"]
        ASM["/api/assemble\nffmpeg render"]
        PIPE["/api/pipeline/:id\ndoc store, rev-checked saves"]
        GOV["Budget governor\nRECUT_BUDGET_USD hard cap\n+ persisted spend ledger"]
    end

    subgraph DS["Alibaba Cloud Model Studio (DashScope intl)"]
        QMAX["qwen-max\nscript → named cuts"]
        QIMG["qwen-image-plus / edit\ncast references"]
        QVL["qwen3-vl-plus\ncontinuity judge"]
        R2V["wan2.7-r2v\nreference-to-video, native audio"]
        TTS["qwen3-tts-flash\ndialogue voice"]
        OSS["DashScope file upload (OSS)\nmodel-reachable reference images"]
    end

    subgraph Store["Durable storage"]
        GENF["public/generated/\nmirrored media"]
        DOCS[".recut/projects/\nproject + pipeline JSON"]
    end

    M -->|premise + locked cast| PLAN --> QMAX
    M --> STYLE --> QMAX
    M -->|cut description + @refs| GEN
    GEN --> QIMG & QVL & TTS
    GEN -->|upload refs| OSS --> R2V
    GEN --> R2V
    GEN -->|mirror results| GENF
    TL --> ASM -->|reads clips| GENF
    M <--> PIPE <--> DOCS
    GEN & PLAN --> GOV
```

## Key decisions

- **Reference-to-video, not image-to-video.** Image-to-video only guarantees
  the first frame; identity drifts as soon as the shot moves. Binding locked
  cast references directly into wan2.7-r2v holds identity through every frame
  and returns motion plus native audio in one generation per cut.
- **Model ids only in `manifests/`.** A guard test fails the build if a model
  id string appears anywhere else. Adding a provider is one manifest plus one
  serializer; the router picks it up with no other changes.
- **Typed prompt compilation.** A cut's prompt is compiled from typed state
  (style prefix, cut text, camera presets, enumerated reference bindings that
  forbid merging distinct characters), never concatenated in components.
- **Budget governor.** Live mode requires a hard USD cap; the submitter refuses
  any job that would cross it and the ledger survives restarts.
- **Durability.** Hosted DashScope result URLs expire in about a day, so every
  image, clip, and voice line is mirrored into `public/generated/` at creation,
  and reference images are re-uploaded through DashScope's file API at
  generation time so the model can always fetch them.
- **Crash safety.** Saves retry and surface failures; the server rejects stale
  writes by revision and union-merges takes; a localStorage backup restores
  unsaved work; demo mode never persists.
