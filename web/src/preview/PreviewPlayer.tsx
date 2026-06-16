/**
 * Pure-React live preview player. NO ffmpeg.
 *
 * Sequences the timeline's slots, advancing per slot.duration_s with play/pause
 * and a scrubber. Overlays captions using geometry derived from
 * shared/caption-style.json (via captionGeometry). Stand-ins render as the
 * tinted gradient + label exactly like the prototype; user_upload/generated
 * slots render the actual media. This reads the SAME timeline the export reads.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { Slot, Timeline } from "../types";
import { TYPES, shade } from "../components/types-map";
import { assetRawUrl } from "../api/client";
import { captionGeometry } from "./captionGeometry";

export interface PreviewPlayerProps {
  timeline: Timeline;
  /** controlled active slot id (clicking a slot elsewhere selects it). */
  activeSlotId?: string;
  onActiveSlotChange?: (slotId: string) => void;
  /** when true, autoplay-style timer drives playback. */
}

function fmt(t: number): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function PreviewPlayer({
  timeline,
  activeSlotId,
  onActiveSlotChange,
}: PreviewPlayerProps) {
  const slots = timeline.slots;
  const totalDur = useMemo(
    () => slots.reduce((a, s) => a + s.duration_s, 0),
    [slots],
  );

  // cumulative start time of each slot
  const starts = useMemo(() => {
    const out: number[] = [];
    let t = 0;
    for (const s of slots) {
      out.push(t);
      t += s.duration_s;
    }
    return out;
  }, [slots]);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  // index of the slot covering the current time
  const slotIndex = useMemo(() => {
    if (slots.length === 0) return 0;
    let idx = 0;
    for (let i = 0; i < slots.length; i++) {
      if (time >= starts[i]) idx = i;
    }
    return idx;
  }, [time, starts, slots.length]);

  const current: Slot | undefined = slots[slotIndex];

  // measure the phone width so caption geometry scales correctly
  const screenRef = useRef<HTMLDivElement | null>(null);
  const [screenW, setScreenW] = useState(270);
  useLayoutEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setScreenW(e.contentRect.width);
    });
    ro.observe(el);
    setScreenW(el.clientWidth || 270);
    return () => ro.disconnect();
  }, []);

  // playback timer
  useEffect(() => {
    if (!playing) {
      lastTsRef.current = null;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      setTime((prev) => {
        const next = prev + dt;
        if (next >= totalDur) {
          setPlaying(false);
          return totalDur;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, totalDur]);

  // when an external active slot is selected, jump the playhead there
  useEffect(() => {
    if (activeSlotId == null) return;
    const i = slots.findIndex((s) => s.id === activeSlotId);
    if (i >= 0 && (current?.id ?? null) !== activeSlotId) {
      setTime(starts[i]);
      setPlaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlotId]);

  // notify parent of the slot under the playhead
  useEffect(() => {
    if (current && onActiveSlotChange) onActiveSlotChange(current.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // ---- voiceover / bed audio ----
  const voAsset = timeline.audio.voiceover.enabled
    ? timeline.audio.voiceover.asset_id
    : null;
  const bedAsset = timeline.audio.bed.enabled ? timeline.audio.bed.asset_id : null;
  const voRef = useRef<HTMLAudioElement | null>(null);
  const bedRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    for (const a of [voRef.current, bedRef.current]) {
      if (!a) continue;
      if (playing) {
        a.currentTime = Math.min(time, a.duration || time);
        void a.play().catch(() => {});
      } else {
        a.pause();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  if (!current) {
    return (
      <div className="rc-preview" data-testid="preview-empty">
        <div className="rc-phone">
          <div className="rc-screen" style={{ background: "#0d0b12" }} />
        </div>
      </div>
    );
  }

  const meta = TYPES[current.type];
  const isText = current.type === "text";
  const hasMedia =
    (current.source === "user_upload" || current.source === "generated") &&
    current.asset_id;

  // caption geometry from the shared keystone
  const geo = captionGeometry(
    current.style.size,
    current.style.align,
    current.style.font,
    isText ? "text_card" : "caption",
    screenW,
  );

  const captionStyle: React.CSSProperties = isText
    ? {
        fontFamily: geo.fontFamily,
        fontWeight: geo.fontWeight,
        fontSize: geo.fontSizePx,
        textAlign: geo.textAlign,
        lineHeight: geo.lineSpacing,
        top: "50%",
        transform: "translateY(-50%)",
        maxWidth: `${geo.maxWidthFrac * 100}%`,
        marginInline: "auto",
      }
    : {
        fontFamily: geo.fontFamily,
        fontWeight: geo.fontWeight,
        fontSize: geo.fontSizePx,
        textAlign: geo.textAlign,
        lineHeight: geo.lineSpacing,
        top: `${(geo.lowerThirdYFrac ?? 0.72) * 100}%`,
        maxWidth: `${geo.maxWidthFrac * 100}%`,
        marginInline: "auto",
      };

  return (
    <div className="rc-preview">
      <div className="rc-phone">
        <div
          ref={screenRef}
          className="rc-screen"
          data-testid="preview-screen"
          style={
            hasMedia
              ? { background: "#000" }
              : {
                  background: `linear-gradient(150deg, ${meta.color}, ${shade(
                    meta.color,
                  )})`,
                }
          }
        >
          <div className="rc-screenbadge">
            <meta.Icon size={13} /> {meta.label}
          </div>

          {hasMedia ? (
            <video
              key={current.asset_id ?? undefined}
              src={assetRawUrl(current.asset_id!)}
              muted
              playsInline
              autoPlay={playing}
              loop
            />
          ) : !isText ? (
            <div className="rc-screenghost">stand-in</div>
          ) : null}

          {current.text && current.text_role !== "none" && (
            <div
              className={isText ? "rc-screentext" : "rc-caption"}
              data-testid="preview-caption"
              data-canvas-px={geo.fontSizeCanvasPx}
              style={captionStyle}
            >
              {current.text}
            </div>
          )}
        </div>

        {/* segment scrubber per slot */}
        <div className="rc-timeline">
          {slots.map((s, i) => (
            <button
              key={s.id}
              title={s.beat_label}
              aria-label={`Go to ${s.beat_label}`}
              className={"rc-seg" + (i === slotIndex ? " is-active" : "")}
              style={{
                flex: s.duration_s,
                background: TYPES[s.type].color,
                opacity: s.source === "standin" ? 0.45 : 1,
              }}
              onClick={() => {
                setTime(starts[i]);
                setPlaying(false);
                onActiveSlotChange?.(s.id);
              }}
            />
          ))}
        </div>
      </div>

      {/* transport */}
      <div className="rc-pvctrls">
        <button
          className="rc-pvplay"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => {
            if (time >= totalDur) setTime(0);
            setPlaying((p) => !p);
          }}
        >
          {playing ? (
            <Pause size={15} fill="currentColor" strokeWidth={0} />
          ) : (
            <Play size={15} fill="currentColor" strokeWidth={0} />
          )}
        </button>
        <div
          className="rc-pvscrub"
          role="slider"
          aria-label="Scrubber"
          aria-valuemin={0}
          aria-valuemax={Math.round(totalDur)}
          aria-valuenow={Math.round(time)}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const frac = (e.clientX - rect.left) / rect.width;
            setTime(Math.max(0, Math.min(1, frac)) * totalDur);
          }}
        >
          <div
            className="rc-pvscrubfill"
            style={{ width: `${totalDur ? (time / totalDur) * 100 : 0}%` }}
          />
        </div>
        <span className="rc-pvtime">
          {fmt(time)} / {fmt(totalDur)}
        </span>
      </div>

      <div className="rc-previewfoot">
        <Play size={13} fill="currentColor" strokeWidth={0} /> Plays now · edits
        apply live
      </div>

      {voAsset && (
        <audio ref={voRef} src={assetRawUrl(voAsset)} preload="auto" />
      )}
      {bedAsset && (
        <audio ref={bedRef} src={assetRawUrl(bedAsset)} preload="auto" />
      )}
    </div>
  );
}
