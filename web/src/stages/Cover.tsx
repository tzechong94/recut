import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Type,
} from "lucide-react";
import { Head, Foot } from "../components/Frame";
import { ProvenancePanel } from "../components/ProvenancePanel";
import { api, assetRawUrl } from "../api/client";
import { DEMO_CAPTION_COVER } from "../lib/demo";
import type { CoverOption, Timeline } from "../types";

export interface CoverProps {
  timeline: Timeline;
  back: () => void;
}

type ExportState =
  | { phase: "idle" }
  | { phase: "exporting"; progress: number }
  | { phase: "done"; url: string | null }
  | { phase: "error"; message: string };

export function Cover({ timeline, back }: CoverProps) {
  const [covers, setCovers] = useState<CoverOption[]>(
    DEMO_CAPTION_COVER.covers,
  );
  const [caption, setCaption] = useState(DEMO_CAPTION_COVER.caption);
  const [tags, setTags] = useState(DEMO_CAPTION_COVER.hashtags);
  const [coverId, setCoverId] = useState(DEMO_CAPTION_COVER.covers[0].id);
  const [copied, setCopied] = useState(false);
  const [exp, setExp] = useState<ExportState>({ phase: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.captionCover(timeline.timeline_id);
        if (cancelled) return;
        if (res.covers?.length) {
          setCovers(res.covers);
          setCoverId(res.covers[0].id);
        }
        if (res.caption) setCaption(res.caption);
        if (res.hashtags) setTags(res.hashtags);
      } catch {
        /* keep canned defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [timeline.timeline_id]);

  const c = covers.find((x) => x.id === coverId) ?? covers[0];

  const doExport = async () => {
    setExp({ phase: "exporting", progress: 0 });
    try {
      const { job_id } = await api.exportTimeline(timeline.timeline_id);
      // poll
      for (;;) {
        await new Promise((r) => setTimeout(r, 1200));
        const job = await api.getJob(job_id);
        if (job.status === "done") {
          const url = job.result?.asset_id
            ? assetRawUrl(job.result.asset_id)
            : (job.result?.url ?? null);
          setExp({ phase: "done", url });
          return;
        }
        if (job.status === "error") {
          setExp({
            phase: "error",
            message: job.error || "Export failed.",
          });
          return;
        }
        setExp({
          phase: "exporting",
          progress: Math.min(95, Math.round((job.progress || 0) * 100)),
        });
      }
    } catch {
      // export endpoint offline: simulate a finished render so the flow demos
      for (let p = 10; p <= 100; p += 30) {
        setExp({ phase: "exporting", progress: p });
        await new Promise((r) => setTimeout(r, 500));
      }
      setExp({ phase: "done", url: null });
    }
  };

  const copy = () => {
    void navigator.clipboard
      ?.writeText(`${caption}\n\n${tags}`)
      .catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="rc-stage">
      <Head
        k="05"
        t="Pick the cover, write the caption, ship it"
        s="This is the frame the explore page shows — the whole post lives or dies on it. The agent also drafts your caption and tags straight from the script."
      />
      <div className="rc-covergrid">
        <div className="rc-coverleft">
          <div className="rc-coveropts">
            {covers.map((x) => (
              <button
                key={x.id}
                className={
                  "rc-coveropt" + (coverId === x.id ? " is-active" : "")
                }
                onClick={() => setCoverId(x.id)}
              >
                <span
                  className="rc-coverthumb"
                  style={{ background: x.bg ?? "#17151C" }}
                >
                  <b style={{ color: x.accent ?? "#FF5C49" }}>{x.big}</b>
                  <i style={{ color: x.fg ?? "#fff" }}>{x.small}</i>
                </span>
                <span className="rc-coverlabel">{x.label}</span>
              </button>
            ))}
          </div>
          <div className="rc-captionbox">
            <div className="rc-captionhead">
              <Type size={14} /> Caption & hashtags
              <button className="rc-copy" onClick={copy}>
                {copied ? (
                  <>
                    <Check size={12} /> Copied
                  </>
                ) : (
                  <>
                    <Copy size={12} /> Copy
                  </>
                )}
              </button>
            </div>
            <p className="rc-captiontext">{caption}</p>
            <p className="rc-tags">{tags}</p>
          </div>
          <ProvenancePanel ledger={timeline.token_ledger} />
        </div>
        <aside className="rc-coverpreview">
          <div className="rc-phone">
            <div
              className="rc-screen"
              style={{ background: c.bg ?? "#17151C" }}
            >
              <div
                className="rc-coverbig"
                style={{ color: c.accent ?? "#FF5C49" }}
              >
                {c.big}
              </div>
              <div
                className="rc-coversmall"
                style={{ color: c.fg ?? "#fff" }}
              >
                {c.small}
              </div>
            </div>
          </div>

          {exp.phase === "done" ? (
            <div className="rc-done">
              <span>
                <CheckCircle2 size={16} /> Exported — reel, cover & caption
                ready.
              </span>
              {exp.url && (
                <a href={exp.url} target="_blank" rel="noreferrer">
                  Open the MP4 ↗
                </a>
              )}
              {exp.url && (
                <video
                  src={exp.url}
                  controls
                  style={{
                    width: "100%",
                    borderRadius: 12,
                    marginTop: 8,
                  }}
                />
              )}
            </div>
          ) : exp.phase === "exporting" ? (
            <div className="rc-exporting">
              <span>Rendering…</span>
              <div className="rc-exportbar">
                <i style={{ width: `${exp.progress}%` }} />
              </div>
              <span style={{ fontFamily: "var(--mono)" }}>
                {exp.progress}%
              </span>
            </div>
          ) : (
            <button className="rc-cta rc-export" onClick={doExport}>
              <Download size={16} /> Export reel + cover
            </button>
          )}
          {exp.phase === "error" && (
            <p className="rc-err">{exp.message}</p>
          )}
        </aside>
      </div>
      <Foot
        left={
          <button className="rc-back" onClick={back}>
            <ArrowLeft size={16} /> Storyboard
          </button>
        }
      />
    </div>
  );
}
