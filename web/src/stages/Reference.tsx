import { useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Link2,
  Play,
  Upload,
} from "lucide-react";
import { Head, Foot } from "../components/Frame";
import { api, assetRawUrl } from "../api/client";
import type { Asset } from "../types";

export interface ReferenceProps {
  projectId: string;
  /** called with the uploaded asset id (or null for a link/demo) once ready. */
  onAnalyse: (assetId: string | null) => void;
  analysing: boolean;
}

export function Reference({ projectId, onAnalyse, analysing }: ReferenceProps) {
  const [mode, setMode] = useState<"upload" | "link">("upload");
  const [url, setUrl] = useState("");
  const [linked, setLinked] = useState<{ platform: string; url: string } | null>(
    null,
  );
  const [err, setErr] = useState("");
  const [asset, setAsset] = useState<Asset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const doUpload = async (file: File) => {
    setErr("");
    setUploading(true);
    try {
      const a = await api.uploadAsset(projectId, file, "reference");
      setAsset(a);
      setLinked(null);
    } catch (e) {
      setErr(
        "Upload failed — backend offline? You can still analyse with the demo reference.",
      );
      // keep a local stand-in so the flow continues
      setAsset(null);
    } finally {
      setUploading(false);
    }
  };

  const fetchLink = () => {
    const u = url.trim();
    if (!u) {
      setErr("Paste a reel or carousel link to continue.");
      return;
    }
    const platform = /tiktok/i.test(u) ? "TikTok" : "Instagram";
    setLinked({ platform, url: u });
    setAsset(null);
    setErr("");
  };

  const ref = linked
    ? { tag: linked.platform.toUpperCase() + " · linked", cap: linked.url }
    : asset
      ? { tag: "UPLOAD · ready", cap: asset.mime }
      : { tag: "REEL · 0:23", cap: "@studio.haul — “Sourcing haul → big reveal”" };

  const note = asset
    ? "Reference uploaded — analyse to see the recipe."
    : linked
      ? "Reference pulled from your link."
      : "Demo reference loaded — analyse to see the recipe.";

  return (
    <div className="rc-stage">
      <Head
        k="01"
        t="Drop a post you love the format of"
        s="One reel or carousel. The agent learns its recipe — the beats, the pacing, the caption rhythm — never its content."
      />
      <div className="rc-refgrid">
        <div className="rc-refcard">
          <div className="rc-refphone">
            {asset && asset.mime.startsWith("video") ? (
              <video src={assetRawUrl(asset.id)} muted playsInline />
            ) : (
              <div className="rc-refplay">
                <Play size={20} fill="#fff" strokeWidth={0} />
              </div>
            )}
            <div className="rc-reftag">{ref.tag}</div>
            <div className="rc-refcap">{ref.cap}</div>
          </div>
          <div className="rc-refmeta">
            {linked ? (
              <span className="rc-refstat">fetched from {linked.platform}</span>
            ) : asset ? (
              <span className="rc-refstat">your upload</span>
            ) : (
              <>
                <span className="rc-refstat">412k plays</span>
                <span className="rc-refstat">7 cuts</span>
                <span className="rc-refstat">fast-cut</span>
              </>
            )}
          </div>
        </div>

        <div
          className={"rc-drop" + (drag ? " is-drag" : "")}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void doUpload(f);
          }}
        >
          {mode === "upload" ? (
            <div className="rc-dropinner">
              <Upload size={22} strokeWidth={2} />
              <p className="rc-dropmain">
                {uploading
                  ? "Uploading…"
                  : asset
                    ? "Uploaded ✓"
                    : "Drop a video or carousel"}
              </p>
              <p className="rc-dropsub">MP4, MOV or images — up to 200MB</p>
              <input
                ref={fileRef}
                type="file"
                accept="video/*,image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void doUpload(f);
                }}
              />
              <div style={{ marginTop: 14 }}>
                <button
                  className="rc-ghost"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={15} /> Choose file
                </button>
              </div>
              <div className="rc-or">
                <span>or</span>
              </div>
              <button className="rc-ghost" onClick={() => setMode("link")}>
                <Link2 size={15} /> Paste a link
              </button>
            </div>
          ) : (
            <div className="rc-dropinner rc-linkmode">
              <Link2 size={22} strokeWidth={2} />
              <p className="rc-dropmain">Paste a reel or carousel link</p>
              <div className="rc-linkrow">
                <input
                  value={url}
                  autoFocus
                  placeholder="https://instagram.com/reel/…"
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setErr("");
                  }}
                  onKeyDown={(e) => e.key === "Enter" && fetchLink()}
                />
                <button className="rc-cta sm" onClick={fetchLink}>
                  Fetch
                </button>
              </div>
              {err && <p className="rc-err">{err}</p>}
              {linked && (
                <p className="rc-linkok">
                  <Check size={13} /> Pulled from {linked.platform} — ready to
                  analyse
                </p>
              )}
              <button
                className="rc-ghost rc-uploadinstead"
                onClick={() => setMode("upload")}
              >
                <Upload size={15} /> Upload instead
              </button>
            </div>
          )}
        </div>
      </div>
      {err && mode === "upload" && <p className="rc-err">{err}</p>}
      <Foot
        right={
          <button
            className="rc-cta"
            disabled={analysing}
            onClick={() => onAnalyse(asset?.id ?? null)}
          >
            {analysing ? "Analysing…" : "Analyse the format"}{" "}
            <ArrowRight size={16} />
          </button>
        }
        note={note}
      />
    </div>
  );
}
