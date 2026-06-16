import { useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Film,
  ListChecks,
  MoreHorizontal,
  Mic,
  Music,
  Plus,
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
import type { Slot, SlotType, Timeline } from "../types";

export interface StoryboardProps {
  projectId: string;
  timeline: Timeline;
  setTimeline: (updater: (t: Timeline) => Timeline) => void;
  next: () => void;
  back: () => void;
}

export function Storyboard({
  timeline,
  setTimeline,
  next,
  back,
}: StoryboardProps) {
  const slots = [...timeline.slots].sort((a, b) => a.order - b.order);
  const [active, setActive] = useState<string>(slots[0]?.id ?? "");
  const [swapFor, setSwapFor] = useState<string | null>(null);
  const [ovFor, setOvFor] = useState<string | null>(null);
  const [styleFor, setStyleFor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const [promptText, setPromptText] = useState("");
  const uploadSlotRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const need = slots.filter(
    (s) => TYPES[s.type].actor === "you" && s.source === "standin",
  );

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

  const keepGenerated = (id: string) => {
    patch(id, (s) => ({ ...s, kept: true, source: "generated" }));
    setSwapFor(null);
  };

  const useBroll = (id: string) => {
    patch(id, (s) => ({
      ...s,
      type: "broll",
      source: "generated",
      kept: true,
      standin: { ...s.standin, color: STANDIN_COLOR.broll, kind: "broll" },
    }));
    setSwapFor(null);
  };

  const triggerUpload = (id: string) => {
    uploadSlotRef.current = id;
    fileRef.current?.click();
    setSwapFor(null);
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
        }));
      }
    } catch {
      // whole upload offline: simulate "yours" so the flow is demoable
      patch(id, (s) => ({ ...s, source: "user_upload" }));
    } finally {
      uploadSlotRef.current = null;
    }
  };

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
        source: type === "broll" ? "generated" : "standin",
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
        status: "ready",
        generation: null,
        kept: type === "broll",
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
      // offline: add a generated b-roll slot with the prompt as its text
      setTimeline((t) => {
        const newSlot: Slot = {
          id: localId("slot"),
          beat_label: "New",
          type: "broll",
          order: t.slots.length,
          duration_s: 3,
          source: "generated",
          asset_id: null,
          standin: {
            kind: "broll",
            color: STANDIN_COLOR.broll,
            label: "generated b-roll",
          },
          text: prompt,
          text_role: "voiceover",
          style: { font: "clean", size: "m", align: "left" },
          status: "ready",
          generation: null,
          kept: true,
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
        t="Your base cut — swap, restyle, add"
        s="Every slot has a stand-in, so it plays end to end now. Replace what's yours, change the type or font, or add new slots — manually or by asking the agent."
      />
      <div className="rc-sbgrid">
        <div className="rc-slots">
          <div className="rc-checklist">
            <ListChecks size={15} />
            {need.length ? (
              <span>
                <b>{need.length} slots</b> need you — film{" "}
                {need.filter((s) => s.type === "talk").length}, pick{" "}
                {need.filter((s) => s.type === "roll").length}
              </span>
            ) : (
              <span>All yours. Nothing left to swap.</span>
            )}
          </div>

          {slots.map((s) => {
            const T = TYPES[s.type];
            const isYou = T.actor === "you";
            const filled = s.source === "user_upload";
            const gen = s.source === "generated";
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
                      {s.type === "text" ? `“${s.text}”` : s.text}
                    </span>
                  </span>
                </button>
                <div className="rc-slotside">
                  {filled ? (
                    <span className="rc-yours">
                      <CheckCircle2 size={14} /> Yours
                    </span>
                  ) : gen ? (
                    <span className="rc-gen">
                      <Sparkles size={13} /> Generated
                    </span>
                  ) : isYou ? (
                    <button
                      className="rc-swap"
                      onClick={() => {
                        setSwapFor(swapFor === s.id ? null : s.id);
                        setOvFor(null);
                        setStyleFor(null);
                      }}
                    >
                      {T.hint}
                    </button>
                  ) : (
                    <span className="rc-auto">{T.hint}</span>
                  )}
                  <button
                    className="rc-iconbtn sm"
                    aria-label="Slot options"
                    onClick={() => {
                      setOvFor(ovFor === s.id ? null : s.id);
                      setSwapFor(null);
                      setStyleFor(null);
                    }}
                  >
                    <MoreHorizontal size={16} />
                  </button>

                  {swapFor === s.id && (
                    <div className="rc-menu">
                      {s.type === "talk" && (
                        <>
                          <button onClick={() => triggerUpload(s.id)}>
                            <Upload size={13} /> Upload a take{" "}
                            <em className="rc-rec">best</em>
                          </button>
                          <button onClick={() => triggerUpload(s.id)}>
                            <Film size={13} /> Record with teleprompter
                          </button>
                        </>
                      )}
                      {s.type === "roll" && (
                        <>
                          <button onClick={() => triggerUpload(s.id)}>
                            <Upload size={13} /> Upload a clip
                          </button>
                          <button onClick={() => useBroll(s.id)}>
                            <Sparkles size={13} /> Use generated b-roll
                          </button>
                        </>
                      )}
                      <button
                        className="rc-menukeep"
                        onClick={() => setSwapFor(null)}
                      >
                        Keep stand-in
                      </button>
                    </div>
                  )}
                  {ovFor === s.id && (
                    <div className="rc-menu">
                      <button
                        onClick={() => {
                          setStyleFor(s.id);
                          setOvFor(null);
                        }}
                      >
                        <Type size={13} /> Edit text & font
                      </button>
                      {gen && (
                        <button onClick={() => keepGenerated(s.id)}>
                          <Check size={13} /> Keep (mark for generation)
                        </button>
                      )}
                      <button onClick={() => duplicate(s)}>
                        <Copy size={13} /> Duplicate slot
                      </button>
                      <button
                        className="rc-del"
                        onClick={() => remove(s.id)}
                      >
                        <Trash2 size={13} /> Delete slot
                      </button>
                    </div>
                  )}
                  {styleFor === s.id && (
                    <div className="rc-stylepop">
                      <textarea
                        value={s.text}
                        aria-label="Edit slot text"
                        onChange={(e) => setText(s.id, e.target.value)}
                      />
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
                        <Check size={13} /> Done
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
                {(Object.entries(TYPES) as Array<[SlotType, (typeof TYPES)[SlotType]]>).map(
                  ([k, T]) => (
                    <button
                      key={k}
                      onClick={() => addManual(k)}
                      style={{ color: T.color }}
                    >
                      <T.Icon size={13} /> {T.label}
                    </button>
                  ),
                )}
                <span className="rc-addlabel">Or</span>
                <button
                  className="rc-addprompt"
                  onClick={() => setPrompting(true)}
                >
                  <Sparkles size={13} /> Describe it for the agent
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
            <ProvenancePanel ledger={timeline.token_ledger} />
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
