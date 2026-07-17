# Devpost submission kit

Track: **Track 2, AI Showrunner**. Deadline: **July 20, 2026, 2:00 pm Pacific**
(July 21, 5:00 am Singapore). Judging: Innovation & AI Creativity 30%,
Technical Depth & Engineering 30%, Problem Value & Impact 25%, Presentation &
Documentation 15%.

## Checklist

- [ ] Public GitHub repo with source, assets, and run instructions (README done;
      repo must be flipped to public and `pivot` merged to `main` and pushed)
- [ ] Proof of Alibaba Cloud deployment, linked from the repo (see
      docs/DEPLOYMENT.md once deployed)
- [x] Architecture diagram (docs/ARCHITECTURE.md, mermaid renders on GitHub)
- [ ] Demo video ~3 min on YouTube/Vimeo (VO parts ready, edit in progress)
- [ ] Devpost project description + track identification (draft below)
- [ ] Optional: blog/social post for bonus prize eligibility

## Description draft (paste into Devpost)

**Recut: the AI showrunner. Every other tool gives you shots. Recut gives you a
series.**

Short-form video models are astonishing per clip and useless per film: every
generation is a fresh roll of the dice, so characters drift, styles wander, and
"scene 2" stars a stranger. Recut fixes the film, not the frame.

You cast your characters once: generate or upload reference images, crown a
winner, lock it. Paste a script; a director skill built on qwen-max breaks it
into named cuts (1A, 2A, 3B) with blocking, acting beats, and camera presets,
respecting your character names and style word for word. Each cut then goes to
wan2.7-r2v with the locked references bound by name, so the same characters
come back in every shot, through every frame, with native audio. A continuity
judge (qwen3-vl-plus) scores takes against the cast. Keepers land on a real
timeline: trim, split, reorder, then ffmpeg renders the film with every clip's
own audio bed and TTS dialogue mixed in.

We learned this the hard way: our first build was a node canvas around
image-to-video. It demoed well and filmed badly, because i2v only guarantees
the first frame. The pivot to reference-to-video with a locked cast is why a
20-second, 5-cut film holds one look and one cast from sunrise to night.

Everything runs on Alibaba Cloud Model Studio (qwen-max, qwen-image-plus,
qwen3-vl-plus, wan2.7-r2v, qwen3-tts-flash), with model ids isolated in a
manifest layer (guard-tested), typed prompt compilation, a hard budget
governor, and durable media mirroring. The in-app /demo replays real projects
through the live product UI, step by step.

## Notes for the video upload

Use the yoopi yeepi walkthrough recording with the VO parts in
~/Desktop/recut-demo-vo/ (cue sheet in 00-script.md, target 2:30-2:45, well
under the cap).
