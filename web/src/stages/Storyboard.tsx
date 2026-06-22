import { useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  Loader2,
  MoreHorizontal,
  Mic,
  Music,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Type,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { Head, Foot } from "../components/Frame";
import { FONTS, TYPES } from "../components/types-map";
import { PreviewPlayer } from "../preview/PreviewPlayer";
import { ProvenancePanel } from "../components/ProvenancePanel";
import { api } from "../api/client";
import { STANDIN_COLOR, localId, recomputeLedger } from "../lib/demo";
import { runGeneration } from "../lib/generate";
import type { GenerateProgress } from "../lib/generate";
import type { Slot, SlotType, Timeline } from "../types";

export interface StoryboardProps {
  projectId: string;
  timeline: Timeline;
  setTimeline: (updater: (t: Timeline) => Timeline) => void;
  next: () => void;
  back: () => void;
}

/** A visual slot is anything that can carry a generated/uploaded clip. */
function isVisual(s: Slot): boolean {
  return s.type !== "text";
}

/** Short, single-line description of a slot's visual prompt. */
function promptOf(s: Slot): string {
  const p = s.generation?.prompt;
  if (typeof p === "string" && p.trim()) return p.trim();
  return s.text;
}

export function Storyboard({
  timeline,
  setTimeline,
  next,
  back,
}: StoryboardProps) {
  const slots = [...timeline.slots].sort((a, b) => a.order - b.order);
  const [active, setActive] = useState<string>(slots[0]?.id ?? "");
  const [ovFor, setOvFor] = useState<string | null>(null);
  const [styleFor, setStyleFor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const [promptText, setPromptText] = useState("");
  const uploadSlotRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // --- generation state ---
  // overall "generate all" run
  const [genRunning, setGenRunning] = useState(false);
  const [genProgress, setGenProgress] = useState<GenerateProgress | null>(null);
  const [genNote, setGenNote] = useState<string | null>(null);
  // per-slot regenerate (slot id currently regenerating)
  const [regenSlot, setRegenSlot] = useState<string | null>(null);

  const visualSlots = slots.filter(isVisual);
  const pending = visualSlots.filter(
    (s) => s.source === "standin" || s.status === "pending_generation",
  );
  const generatedCount = visualSlots.filter(
    (s) => s.source === "generated",
  ).length;
  const uploadCount = visualSlots.filter(
    (s) => s.source === "user_upload",
  ).length;

  const patch = (id: string, fn: (s: Slot) => Slot) => {
    setTimeline((t) => {
      const newSlots = t.slots.map((s) => (s.id === id ? fn(s) : s));
      return { ...t, slots: newSlots, token_ledger: recomputeLedger(newSlots) };
    });
  };

  const setStyle = (id: string, key: keyof Slot["style"], val: string) =>
    patch(id, (s) => ({ ...s, style: { ...s.style, [key]: val } }));

  const setText = (id: string, text: string) =>
    patch(id, (s) => ({ ...s, text }));

  // Edit a slot's visual prompt. The Editor's debounced useAutosave PUTs the
  // full timeline on change, so this persists automatically (no manual PUT).
  const setPrompt = (id: string, prompt: string) =>
    patch(id, (s) => ({
      ...s,
      generation: { ...(s.generation ?? {}), prompt },
    }));

  /* ----------------------- AI generation actions ----------------------- */

  const generateAll = async () => {
    if (genRunning) return;
    setGenRunning(true);
    setGenNote(null);
    setGenProgress({ jobs: [], done: 0, total: pending.length });
    const outcome = await runGeneration({
      timelineId: timeline.timeline_id,
      onProgress: (p) => setGenProgress(p),
    });
    setGenNote(noteForOutcome(outcome.kind));
    if (
      (outcome.kind === "settled" || outcome.kind === "timeout") &&
      outcome.timeline
    ) {
      setTimeline(() => outcome.timeline as Timeline);
    } else if (outcome.kind === "unsupported") {
      // backend can't generate (stub/offline): mark pending slots as generated
      // locally so the reel still fills and stays demoable.
      simulateGenerateAll();
    }
    setGenRunning(false);
  };

  const noteForOutcome = (kind: string): string | null => {
    if (kind === "unsupported")
      return "Live generation is offline — filled the reel with placeholders.";
    if (kind === "empty")
      return "Nothing to generate — every slot is already your upload.";
    if (kind === "timeout")
      return "Some clips are still rendering — check back in a moment.";
    return null;
  };

  const simulateGenerateAll = () => {
    setTimeline((t) => {
      const newSlots = t.slots.map((s) =>
        isVisual(s) && s.source === "standin"
          ? { ...s, source: "generated" as const, status: "ready" }
          : s,
      );
      return { ...t, slots: newSlots, token_ledger: recomputeLedger(newSlots) };
    });
  };

  const regenerate = async (id: string) => {
    if (regenSlot) return;
    setRegenSlot(id);
    setOvFor(null);
    patch(id, (s) => ({ ...s, status: "generating" }));
    const outcome = await runGeneration({
      timelineId: timeline.timeline_id,
      slotId: id,
    });
    if (
      (outcome.kind === "settled" || outcome.kind === "timeout") &&
      outcome.timeline
    ) {
      setTimeline(() => outcome.timeline as Timeline);
    } else {
      // offline/stub: mark this slot generated locally
      patch(id, (s) => ({
        ...s,
        source: "generated",
        status: "ready",
      }));
    }
    setRegenSlot(null);
  };

  /* --------------------------- Replace / upload --------------------------- */

  const triggerUpload = (id: string) => {
    uploadSlotRef.current = id;
    fileRef.current?.click();
    setOvFor(null);
  };

  const onFile = async (file: File) => {
    const id = uploadSlotRef.current;
    if (!id) return;
    try {
      const asset = await api.uploadAsset(timeline.project_id, file, "upload");
      try {
        const updated = await api.uploadToSlot(
          timeline.timeline_id,
          id,
          asset.id,
        );
        setTimeline(() => updated);
      } catch {
        // slot-upload endpoint offline: attach locally
        patch(id, (s) => ({
          ...s,
          asset_id: asset.id,
          source: "user_upload",
          status: "ready",
        }));
      }
    } catch {
      // whole upload offline: simulate "yours" so the flow is demoable
      patch(id, (s) => ({ ...s, source: "user_upload", status: "ready" }));
    } finally {
      uploadSlotRef.current = null;
    }
  };

  /* ------------------------------ Slot ops ------------------------------ */

  const remove = (id: string) => {
    setTimeline((t) => {
      const newSlots = t.slots
        .filter((s) => s.id !== id)
        .map((s, i) => ({ ...s, order: i }));
      return { ...t, slots: newSlots, token_ledger: recomputeLedger(newSlots) };
    });
    setOvFor(null);
  };

  const duplicate = (slot: Slot) => {
    setTimeline((t) => {
      const sorted = [...t.slots].sort((a, b) => a.order - b.order);
      const i = sorted.findIndex((s) => s.id === slot.id);
      const copy: Slot = { ...slot, id: localId("slot") };
      const newSlots = [
        ...sorted.slice(0, i + 1),
        copy,
        ...sorted.slice(i + 1),
      ].map((s, idx) => ({ ...s, order: idx }));
      return { ...t, slots: newSlots, token_ledger: recomputeLedger(newSlots) };
    });
    setOvFor(null);
  };

  const addManual = (type: SlotType) => {
    setTimeline((t) => {
      const newSlot: Slot = {
        id: localId("slot"),
        beat_label: "New",
        type,
        order: t.slots.length,
        duration_s: 3,
        source: "standin",
        asset_id: null,
        standin: {
          kind: type,
          color: STANDIN_COLOR[type],
          label: TYPES[type].label.toLowerCase(),
        },
        text: type === "text" ? "New text card" : "Describe this shot",
        text_role: type === "text" ? "on_screen_text" : "voiceover",
        style: {
          font: type === "text" ? "display" : "clean",
          size: "m",
          align: type === "text" ? "center" : "left",
        },
        status: type === "text" ? "ready" : "pending_generation",
        generation:
          type === "text"
            ? null
            : { prompt: "", status: "pending_generation" },
        kept: false,
      };
      const newSlots = [...t.slots, newSlot];
      return { ...t, slots: newSlots, token_ledger: recomputeLedger(newSlots) };
    });
    setAdding(false);
    setPrompting(false);
  };

  const addByPrompt = async () => {
    const prompt = promptText.trim();
    if (!prompt) return;
    const afterId = slots[slots.length - 1]?.id ?? "";
    try {
      const updated = await api.addSlot(timeline.timeline_id, afterId, prompt);
      setTimeline(() => updated);
    } catch {
      // offline: add a pending AI b-roll slot with the prompt
      setTimeline((t) => {
        const newSlot: Slot = {
          id: localId("slot"),
          beat_label: "New",
          type: "broll",
          order: t.slots.length,
          duration_s: 3,
          source: "standin",
          asset_id: null,
          standin: {
            kind: "broll",
            color: STANDIN_COLOR.broll,
            label: "AI b-roll",
          },
          text: prompt,
          text_role: "voiceover",
          style: { font: "clean", size: "m", align: "left" },
          status: "pending_generation",
          generation: { prompt, status: "pending_generation" },
          kept: false,
        };
        const newSlots = [...t.slots, newSlot];
        return {
          ...t,
          slots: newSlots,
          token_ledger: recomputeLedger(newSlots),
        };
      });
    }
    setPromptText("");
    setAdding(false);
    setPrompting(false);
  };

  const toggleAudio = (which: "voiceover" | "bed") => {
    setTimeline((t) => ({
      ...t,
      audio: {
        ...t.audio,
        [which]: { ...t.audio[which], enabled: !t.audio[which].enabled },
      },
    }));
  };

  return (
    <div className="rc-stage">
      <input
        ref={fileRef}
        type="file"
        accept="video/*,image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = "";
        }}
      />
      <Head
        k="04"
        t="Your reel — AI fills every shot, you keep what's yours"
        s="By default the AI generates a clip for every visual slot. Hit Generate to fill the reel, then regenerate any shot or replace it with your own upload."
      />
      <div className="rc-sbgrid">
        <div className="rc-slots">
          {/* Generate-all banner */}
          <div className="rc-genbar" data-testid="genbar">
            <div className="rc-genbarmain">
              <button
                className="rc-cta"
                data-testid="generate-all"
                disabled={genRunning || pending.length === 0}
                onClick={() => void generateAll()}
              >
                {genRunning ? (
                  <>
                    <Loader2 size={16} className="rc-spin" />{" "}
                    {genProgress
                      ? `Generating… ${genProgress.done}/${genProgress.total} clips done`
                      : "Generating…"}
                  </>
                ) : (
                  <>
                    <Sparkles size={16} /> Generate all AI clips
                  </>
                )}
              </button>
              <span className="rc-gencost">
                {pending.length > 0
                  ? `Generates a clip per slot — about ~90s and a few cents each on live models.`
                  : `All ${visualSlots.length} visual slots are filled.`}
              </span>
            </div>
            {genNote && (
              <div className="rc-gennote" data-testid="gen-note">
                {genNote}
              </div>
            )}
          </div>

          {slots.map((s) => {
            const T = TYPES[s.type];
            const visual = isVisual(s);
            const upload = s.source === "user_upload";
            const generated = s.source === "generated";
            const generating =
              s.status === "generating" || regenSlot === s.id;
            const standin = !upload && !generated && !generating;
            return (
              <div
                key={s.id}
                className={"rc-slot" + (active === s.id ? " is-active" : "")}
              >
                <button className="rc-slotmain" onClick={() => setActive(s.id)}>
                  <span
                    className="rc-slotrail"
                    style={{ background: T.color }}
                  />
                  <span className="rc-slotbody">
                    <span className="rc-slottop">
                      <span
                        className="rc-chip sm"
                        style={{ background: T.soft, color: T.color }}
                      >
                        <T.Icon size={12} /> {T.label}
                      </span>
                      <span className="rc-slotdur">{s.duration_s}s</span>
                    </span>
                    <span className="rc-slottext">
                      {s.type === "text" ? `“${s.text}”` : promptOf(s)}
                    </span>
                  </span>
                </button>
                <div className="rc-slotside">
                  {!visual ? (
                    <span className="rc-auto">Text card</span>
                  ) : upload ? (
                    <span className="rc-yours">
                      <CheckCircle2 size={14} /> Your upload
                    </span>
                  ) : generating ? (
                    <span className="rc-gen" data-testid={`generating-${s.id}`}>
                      <Loader2 size={13} className="rc-spin" /> Generating…
                    </span>
                  ) : generated ? (
                    <span className="rc-gen">
                      <Sparkles size={13} /> AI generated
                    </span>
                  ) : (
                    <span
                      className="rc-standin"
                      data-testid={`standin-${s.id}`}
                    >
                      AI clip not generated yet
                    </span>
                  )}

                  {visual && (
                    <button
                      className="rc-iconbtn sm"
                      aria-label="Slot options"
                      disabled={generating}
                      onClick={() => {
                        setOvFor(ovFor === s.id ? null : s.id);
                        setStyleFor(null);
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  )}
                  {!visual && (
                    <button
                      className="rc-iconbtn sm"
                      aria-label="Slot options"
                      onClick={() => {
                        setOvFor(ovFor === s.id ? null : s.id);
                        setStyleFor(null);
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  )}

                  {ovFor === s.id && (
                    <div className="rc-menu">
                      {visual && (
                        <button
                          data-testid={`regen-${s.id}`}
                          disabled={!!regenSlot || genRunning}
                          onClick={() => void regenerate(s.id)}
                        >
                          <RefreshCw size={13} />{" "}
                          {standin ? "Generate this clip" : "Regenerate"}
                        </button>
                      )}
                      {visual && (
                        <button
                          data-testid={`replace-${s.id}`}
                          onClick={() => triggerUpload(s.id)}
                        >
                          <Upload size={13} /> Replace with my upload
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setStyleFor(s.id);
                          setOvFor(null);
                        }}
                      >
                        <Type size={13} /> Edit{" "}
                        {visual ? "prompt & captions" : "text & font"}
                      </button>
                      <button onClick={() => duplicate(s)}>
                        <Copy size={13} /> Duplicate slot
                      </button>
                      <button className="rc-del" onClick={() => remove(s.id)}>
                        <Trash2 size={13} /> Delete slot
                      </button>
                    </div>
                  )}
                  {styleFor === s.id && (
                    <div className="rc-stylepop">
                      {visual && (
                        <label className="rc-promptlabel">
                          <span className="rc-promptcap">
                            <Sparkles size={12} /> Visual prompt
                          </span>
                          <textarea
                            value={s.generation?.prompt ?? ""}
                            aria-label="Edit visual prompt"
                            placeholder="Describe the shot the AI should generate…"
                            onChange={(e) => setPrompt(s.id, e.target.value)}
                          />
                        </label>
                      )}
                      <label className="rc-promptlabel">
                        <span className="rc-promptcap">
                          {visual ? "Caption" : "Text"}
                        </span>
                        <textarea
                          value={s.text}
                          aria-label="Edit slot text"
                          onChange={(e) => setText(s.id, e.target.value)}
                        />
                      </label>
                      <div className="rc-styrow">
                        <span>Font</span>
                        <div className="rc-seg3">
                          {(Object.keys(FONTS) as Array<keyof typeof FONTS>).map(
                            (f) => (
                              <button
                                key={f}
                                className={s.style.font === f ? "on" : ""}
                                onClick={() => setStyle(s.id, "font", f)}
                                style={{ fontFamily: FONTS[f] }}
                              >
                                {f === "display"
                                  ? "Display"
                                  : f === "clean"
                                    ? "Clean"
                                    : "Mono"}
                              </button>
                            ),
                          )}
                        </div>
                      </div>
                      <div className="rc-styrow">
                        <span>Size</span>
                        <div className="rc-seg3">
                          {(["s", "m", "l"] as const).map((z) => (
                            <button
                              key={z}
                              className={s.style.size === z ? "on" : ""}
                              onClick={() => setStyle(s.id, "size", z)}
                            >
                              {z.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="rc-styrow">
                        <span>Align</span>
                        <div className="rc-seg3">
                          <button
                            className={s.style.align === "left" ? "on" : ""}
                            onClick={() => setStyle(s.id, "align", "left")}
                          >
                            <AlignLeft size={13} />
                          </button>
                          <button
                            className={s.style.align === "center" ? "on" : ""}
                            onClick={() => setStyle(s.id, "align", "center")}
                          >
                            <AlignCenter size={13} />
                          </button>
                          <button
                            className={s.style.align === "right" ? "on" : ""}
                            onClick={() => setStyle(s.id, "align", "right")}
                          >
                            <AlignRight size={13} />
                          </button>
                        </div>
                      </div>
                      <button
                        className="rc-styclose"
                        onClick={() => setStyleFor(null)}
                      >
                        Done
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <div className="rc-addwrap">
            {!adding ? (
              <button className="rc-add" onClick={() => setAdding(true)}>
                <Plus size={15} /> Add slot
              </button>
            ) : prompting ? (
              <div className="rc-promptbox">
                <input
                  autoFocus
                  value={promptText}
                  placeholder="Describe the shot — e.g. ‘aerial of the harbour at dusk’"
                  onChange={(e) => setPromptText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addByPrompt()}
                />
                <button className="rc-cta sm" onClick={addByPrompt}>
                  Add
                </button>
                <button
                  className="rc-iconbtn sm"
                  aria-label="Cancel"
                  onClick={() => {
                    setAdding(false);
                    setPrompting(false);
                  }}
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <div className="rc-addmenu">
                <span className="rc-addlabel">Add manually</span>
                {(
                  Object.entries(TYPES) as Array<
                    [SlotType, (typeof TYPES)[SlotType]]
                  >
                ).map(([k, T]) => (
                  <button
                    key={k}
                    onClick={() => addManual(k)}
                    style={{ color: T.color }}
                  >
                    <T.Icon size={13} /> {T.label}
                  </button>
                ))}
                <span className="rc-addlabel">Or</span>
                <button
                  className="rc-addprompt"
                  onClick={() => setPrompting(true)}
                >
                  <Sparkles size={13} /> Describe it for the AI
                </button>
              </div>
            )}
          </div>
        </div>

        <aside style={{ position: "sticky", top: 0 }}>
          <PreviewPlayer
            timeline={timeline}
            activeSlotId={active}
            onActiveSlotChange={setActive}
          />
          <div style={{ marginTop: 14 }}>
            <ProvenancePanel ledger={timeline.token_ledger} aiFirst />
          </div>
          <div className="rc-mixline" data-testid="mix-summary">
            <Sparkles size={13} /> {generatedCount} AI · {uploadCount} yours ·{" "}
            {pending.length} not generated
          </div>
          <div className="rc-audio" style={{ marginTop: 14 }}>
            <div className="rc-audiohead">
              <Volume2 size={14} /> Audio
            </div>
            <button
              className={
                "rc-audiorow" + (timeline.audio.voiceover.enabled ? " on" : "")
              }
              onClick={() => toggleAudio("voiceover")}
            >
              <Mic size={13} /> Voiceover{" "}
              <span>
                {timeline.audio.voiceover.enabled ? "On · your voice" : "Off"}
              </span>
            </button>
            <button
              className={
                "rc-audiorow" + (timeline.audio.bed.enabled ? " on" : "")
              }
              onClick={() => toggleAudio("bed")}
            >
              <Music size={13} /> Sound{" "}
              <span>
                {timeline.audio.bed.enabled ? "On · upbeat" : "Add post-export"}
              </span>
            </button>
          </div>
        </aside>
      </div>
      <Foot
        left={
          <button className="rc-back" onClick={back}>
            <ArrowLeft size={16} /> Script
          </button>
        }
        right={
          <button className="rc-cta" onClick={next}>
            Make the cover <ArrowRight size={16} />
          </button>
        }
      />
    </div>
  );
}
