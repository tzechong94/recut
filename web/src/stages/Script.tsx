import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CornerDownLeft,
  Pencil,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Head, Foot } from "../components/Frame";
import { TYPES } from "../components/types-map";
import { api } from "../api/client";
import { DEMO_THREAD } from "../lib/demo";
import type { Recipe, Slot, Timeline } from "../types";

interface Msg {
  who: "agent" | "you";
  text: string;
}

export interface ScriptProps {
  projectId: string;
  recipe: Recipe;
  timeline: Timeline;
  /** patch a single slot's fields and autosave. */
  patchSlot: (slotId: string, patch: Partial<Slot>) => void;
  drafted: boolean;
  setDrafted: (v: boolean) => void;
  generate: () => void;
  generating: boolean;
  back: () => void;
}

export function Script({
  projectId,
  recipe,
  timeline,
  patchSlot,
  drafted,
  setDrafted,
  generate,
  generating,
  back,
}: ScriptProps) {
  const [thread, setThread] = useState<Msg[]>([DEMO_THREAD[0]]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [demoStep, setDemoStep] = useState(1); // next canned message index
  const [refiningId, setRefiningId] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setThread((t) => [...t, { who: "you", text }]);
    setBusy(true);
    try {
      const res = await api.cowrite(projectId, text, recipe.recipe_id);
      setThread((t) => [...t, { who: "agent", text: res.reply }]);
      if (res.beats) applyBeats(res.beats);
    } catch {
      // canned fallback: advance the demo thread
      const nextMsg = DEMO_THREAD[demoStep] ?? {
        who: "agent" as const,
        text: "Got it — I've woven that into the beats. Refine any line on the left, or generate the base cut when you're happy.",
      };
      setThread((t) => [...t, nextMsg]);
      setDemoStep((s) => Math.min(DEMO_THREAD.length, s + 1));
    } finally {
      setBusy(false);
    }
  };

  const applyBeats = (beats: { index: number; text: string }[]) => {
    const ordered = [...timeline.slots].sort((a, b) => a.order - b.order);
    for (const b of beats) {
      const slot = ordered[b.index];
      if (slot) patchSlot(slot.id, { text: b.text });
    }
  };

  const draft = async () => {
    setBusy(true);
    try {
      const story = thread
        .filter((m) => m.who === "you")
        .map((m) => m.text)
        .join("\n");
      const res = await api.draftScript(projectId, recipe.recipe_id, story);
      applyBeats(res.beats);
    } catch {
      // offline: recipe already seeded the slot text; nothing to do
    } finally {
      setBusy(false);
      setDrafted(true);
    }
  };

  const refine = async (slot: Slot) => {
    setRefiningId(slot.id);
    try {
      const res = await api.refineSlot(
        timeline.timeline_id,
        slot.id,
        "Make this punchier and more in my voice.",
      );
      patchSlot(slot.id, { text: res.text });
    } catch {
      // offline tweak so the button does something visible
      patchSlot(slot.id, { text: slot.text.replace(/\.$/, "") + " — for real." });
    } finally {
      setRefiningId(null);
    }
  };

  const ordered = [...timeline.slots].sort((a, b) => a.order - b.order);
  const conversationStarted = thread.length > 1;

  return (
    <div className="rc-stage">
      <Head
        k="03"
        t="Your story, written into the recipe"
        s="Share as much as you can about your idea. The agent asks, you answer, it maps everything onto the beats — back and forth until it sounds like you."
      />
      <div className="rc-script">
        <div className="rc-scriptmain">
          {!drafted ? (
            <div className="rc-emptyscript">
              <Sparkles size={20} />
              <p>Your script appears here as you and the agent shape it.</p>
              <button
                className="rc-cta rc-draftbtn"
                disabled={busy}
                onClick={draft}
              >
                <Pencil size={15} /> {busy ? "Drafting…" : "Draft the script"}
              </button>
              {!conversationStarted && (
                <span className="rc-note">
                  Tip: chat with the agent first, then draft.
                </span>
              )}
            </div>
          ) : (
            <div className="rc-beats">
              {ordered.map((s) => {
                const T = TYPES[s.type];
                const kind =
                  s.text_role === "on_screen_text"
                    ? "On-screen text"
                    : s.text_role === "voiceover"
                      ? "Voiceover"
                      : "No text";
                return (
                  <div className="rc-beatcard" key={s.id}>
                    <div className="rc-beathead">
                      <span
                        className="rc-chip sm"
                        style={{ background: T.soft, color: T.color }}
                      >
                        <T.Icon size={12} /> {s.beat_label}
                      </span>
                      <span className="rc-beatkind">{kind}</span>
                    </div>
                    <textarea
                      className="rc-beatline"
                      value={s.text}
                      rows={2}
                      aria-label={`Edit ${s.beat_label} line`}
                      onChange={(e) => patchSlot(s.id, { text: e.target.value })}
                    />
                    <div className="rc-beatactions">
                      <button
                        className="rc-refine"
                        disabled={refiningId === s.id}
                        onClick={() => refine(s)}
                      >
                        <RefreshCw size={12} />{" "}
                        {refiningId === s.id ? "Refining…" : "Refine"}
                      </button>
                      <span className="rc-edithint">
                        click the line to edit directly
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside className="rc-chat">
          <div className="rc-chathead">
            <Sparkles size={14} /> Co-writing
          </div>
          <div className="rc-thread" ref={threadRef}>
            {thread.map((m, i) => (
              <div key={i} className={"rc-msg " + m.who}>
                {m.text}
              </div>
            ))}
            {busy && <div className="rc-msg agent typing">typing…</div>}
          </div>
          <div className="rc-chatbar">
            <input
              value={input}
              placeholder={drafted ? "Tweak any line…" : "Reply to the agent…"}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            <button onClick={send} disabled={busy} aria-label="Send">
              {drafted ? (
                <CornerDownLeft size={15} />
              ) : (
                <ArrowRight size={15} />
              )}
            </button>
          </div>
        </aside>
      </div>
      <Foot
        left={
          <button className="rc-back" onClick={back}>
            <ArrowLeft size={16} /> Recipe
          </button>
        }
        right={
          <button
            className="rc-cta"
            disabled={!drafted || generating}
            onClick={generate}
          >
            {generating ? "Building…" : "Generate base cut"}{" "}
            <ArrowRight size={16} />
          </button>
        }
        note={
          drafted
            ? "On your go-ahead — slots get assigned and the cut is built."
            : null
        }
      />
    </div>
  );
}
