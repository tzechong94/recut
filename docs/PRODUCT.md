# Recut: product north star

Written 2026-07-17 from founder answers. This is the goal document: when a build decision is unclear, this file wins. Supersedes vibes; updated only deliberately.

## The one-liner

**Recut turns a product photo into a cinematic product film a DTC brand would actually run, in minutes, with a director's pipeline under the hood for those who want the controls.**

## The customer (year one)

DTC/ecommerce brand owners who need product video weekly and today either pay freelancers ($300-500 a cut) or skip video. We build every feature for them. Film producers/editors are the secondary persona served by the pro layer, never at the expense of the primary.

## The wow (the only one that matters)

"**That's a real ad.**" Not "impressive for AI". The reaction target is a media buyer or brand owner watching the export and evaluating it as an ad, not as a demo. Speed, self-repair, and consistency are how we get there; they are not the pitch.

## Quality bar, concretely

**Cinematic product film**: Apple-adjacent, furniture-brand-adjacent. Hero product locked center, dramatic motivated light, slow deliberate camera, premium palette, 1080p. The LUNA sofa demo is the embryo of the house style. NOT UGC talking heads (lipsync risk, different product), NOT fast-cut montage (pacing tech we don't have yet).

The founder's own words on what reads as real: **video quality + the storyboard/shotlist craft. Rework the pipeline into something that does not break and does not show bad quality.** Reliability IS the feature.

## Product shape

**Simple mode on top of the pro pipeline.** One brief-to-finished-ad button that runs the existing three stages autonomously (assets → skill-drafted scenes → takes → judge → auto-repair → animate keepers → assemble), landing the user in a *finished* wizard they can open up and refine. Pros enter through the same hood. One engine, two doors.

## Non-goals (say no by default)

- UGC/avatar/talking-head ads (until cinematic is undeniably won)
- Music generation, community feeds, templates marketplaces, mobile
- Chasing every model release; bake-offs happen on a schedule, not on Twitter hype
- Pricing before 10 real DTC users have shipped real ads (founder call: too early)

## Constraints and sequence

- **Until July 21 (hackathon submission): Alibaba-native only.** Maximize Wan/Qwen: 1080p finals, draft-cheap/final-premium routing, retry discipline.
- **After submission: best model wins.** The gateway was built for this: adding Seedance 2.0 (our shotlist skill literally targets it), Kling, or Veo is one manifest + one serializer each. Bake-offs decide, with the same ad rendered on each stack and cost per finished ad tracked.
- **Dogfood gap (open):** no real advertiser yet. Post-hackathon priority: recruit 3-5 design-partner DTC brands (free ads for honest feedback). Until then, our judge + the founder's eye are the quality gate, and spec ads for real products (clearly labeled concept work) are the portfolio.

## The quality program (what "doesn't break, doesn't look bad" means in code)

1. **Usable-take rate is THE metric.** A take is usable if judge score ≥ 0.8 AND the founder wouldn't delete it on sight. Instrument every take; report the rate; every quality change must move it.
2. **Quality gate before the user sees anything:** every generated take is auto-judged; below threshold auto-retries once with the repair instruction applied. Bad takes the user never saw don't damage trust.
3. **Draft/final split:** 720p drafts for iteration, 1080p for keeper animation and export. Spend where it's seen.
4. **Never crash, never dead-end:** transient API errors retry with backoff; i2v polls survive; every failure surfaces a next action, not a stack trace.
5. **House looks:** 3-5 curated cinematic style prefixes (premium studio, golden-hour lifestyle, dark showroom) tuned on real generations, so default output has taste without prompting skill.

## Success criteria for "not a toy anymore"

- A finished 20-30s product film from one photo in under 15 minutes, hands-off
- Usable-take rate ≥ 70% on the house looks
- One external DTC owner says "I would run this" about an ad for THEIR product
- Cost per finished ad known and under $5 on the Alibaba stack
- Zero pipeline dead-ends across a full testing-guide pass (docs/TESTING-GUIDE.md)

## Near-term build order

1. Quality gate + auto-retry on takes (auto-judge before display)
2. Draft/final resolution split (1080p keepers)
3. **Simple mode**: the one-click brief-to-ad run over the existing engine
4. Platform formats on export (16:9 / 9:16 / 1:1 / 4:5, named per channel)
5. House style presets
6. Hackathon submission artifacts (deploy, video, repo) per docs/PLAN.md
7. Post-July-21: model bake-offs (Seedance first), design-partner recruitment
