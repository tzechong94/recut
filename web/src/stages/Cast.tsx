import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Loader2,
  Lock,
  RefreshCw,
  Sparkles,
  Upload,
  Wand2,
} from "lucide-react";
import { api, assetRawUrl } from "../api/client";
import { pollJob } from "../lib/jobs";
import type { UseProduction } from "../lib/useProduction";
import type { Character, Location, Production } from "../types";
import { Editable } from "../components/Editable";

interface StageProps {
  ctl: UseProduction;
  onAdvance: () => void;
}

const FALLBACK_STYLE_OPTIONS = [
  "cinematic", "noir", "anime", "claymation", "storybook", "pixar", "ghibli",
  "ink_wash", "comic", "pixel", "cyberpunk", "retro_film", "paper_craft",
];

export function CastStage({ ctl, onAdvance }: StageProps) {
  const p = ctl.production!;
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [castingAll, setCastingAll] = useState(false);
  const [styleOptions, setStyleOptions] = useState<string[]>(FALLBACK_STYLE_OPTIONS);
  const alive = useRef(true);
  // StrictMode remounts share the ref — reset to true on (re)mount or the false
  // from the simulated unmount sticks and busy spinners can never turn off.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    api.listStyles()
      .then((s) => s.length && setStyleOptions(s.map((x) => x.name)))
      .catch(() => {});
  }, []);

  /** One look for the whole bible: the first reference (or the custom style image)
   *  anchors every other one. References stream in as the job saves per item. */
  async function generateAll() {
    setCastingAll(true);
    setErrors({});
    try {
      const { job_id } = await api.castAll(p.id);
      await pollJob(job_id, {
        timeoutMs: 15 * 60 * 1000,
        onProgress: () => { if (alive.current) void ctl.refetch(); },
      });
    } catch (e) {
      if (alive.current)
        setErrors((er) => ({ ...er, _all: e instanceof Error ? e.message : "Casting failed" }));
    } finally {
      if (alive.current) {
        await ctl.refetch().catch(() => {});
        setCastingAll(false);
      }
    }
  }

  const setBusyFor = (id: string, v: boolean) =>
    setBusy((b) => ({ ...b, [id]: v }));

  async function generate(
    target: "character" | "location",
    id: string,
    instruction = "",
  ) {
    setBusyFor(id, true);
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      const { job_id } = await api.cast(p.id, target, id, instruction);
      await pollJob(job_id);
      await ctl.refetch();
    } catch (e) {
      setErrors((er) => ({
        ...er,
        [id]: e instanceof Error ? e.message : "Generation failed",
      }));
    } finally {
      setBusyFor(id, false);
    }
  }

  async function uploadFor(
    target: "character" | "location",
    id: string,
    file: File,
  ) {
    if (!p.project_id) {
      setErrors((e) => ({ ...e, [id]: "No project to upload to." }));
      return;
    }
    setBusyFor(id, true);
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      const asset = await api.uploadAsset(p.project_id, file, "upload");
      if (target === "character") {
        const saved = await api.attachCharacterReference(
          p.id,
          id,
          asset.id,
          asset.url,
        );
        ctl.set(saved);
      } else {
        // Locations: persist via PUT (no dedicated endpoint).
        const next: Production = {
          ...p,
          locations: p.locations.map((l) =>
            l.id === id
              ? {
                  ...l,
                  reference_asset_id: asset.id,
                  reference_url: asset.url,
                  source: "uploaded",
                  locked: true,
                }
              : l,
          ),
        };
        ctl.update(next);
      }
    } catch (e) {
      setErrors((er) => ({
        ...er,
        [id]: e instanceof Error ? e.message : "Upload failed",
      }));
    } finally {
      setBusyFor(id, false);
    }
  }

  function changeStyle(name: string) {
    // Changing the style re-locks the bible: references must be regenerated.
    ctl.update({
      ...p,
      style: { ...p.style, name, locked: false },
      characters: p.characters.map((c) => ({ ...c, locked: false })),
      locations: p.locations.map((l) => ({ ...l, locked: false })),
    });
  }

  const lockedCount =
    p.characters.filter((c) => c.reference_asset_id).length +
    p.locations.filter((l) => l.reference_asset_id).length;
  const totalRefs = p.characters.length + p.locations.length;

  return (
    <div className="rc-stage">
      <div className="rc-head">
        <div className="rc-kicker">STAGE 2 · THE SHOW BIBLE</div>
        <h2>Cast &amp; lock the look</h2>
        <p>
          Generate a reference image for each character and location. Once
          locked, every shot reuses these references — that's how the film stays
          consistent. Upload your own to override.
        </p>
      </div>

      <div className="sr-style-bar">
        <span className="sr-field-label">Visual style</span>
        <div className="sr-style-pills">
          {styleOptions.map((s) => (
            <button
              key={s}
              className={"sr-pill" + (p.style.name === s ? " on" : "")}
              onClick={() => changeStyle(s)}
            >
              {s.replace("_", " ")}
            </button>
          ))}
        </div>
        <span className="sr-bible-count">
          {lockedCount}/{totalRefs} locked
        </span>
      </div>

      {errors._all && <div className="rc-err">{errors._all}</div>}
      <div className="sr-castall-bar">
        <button
          className="rc-cta sm"
          disabled={castingAll}
          onClick={() => void generateAll()}
          data-testid="cast-all"
        >
          {castingAll ? (
            <Loader2 size={15} className="rc-spin" />
          ) : (
            <Wand2 size={15} />
          )}
          Generate all — one look
        </button>
        <span className="rc-note">
          The first reference anchors every other one (same art style, new
          subject), so the whole bible shares one look. Uploaded images are kept.
        </span>
      </div>

      <div className="sr-section-head">Characters</div>
      <div className="sr-bible-grid">
        {p.characters.map((c) => (
          <RefCard
            key={c.id}
            kind="character"
            name={c.name}
            description={c.description}
            assetId={c.reference_asset_id}
            source={c.source}
            busy={!!busy[c.id] || (castingAll && !c.reference_asset_id)}
            error={errors[c.id]}
            onGenerate={(instruction) => generate("character", c.id, instruction)}
            onUpload={(f) => uploadFor("character", c.id, f)}
            onRename={(v) =>
              ctl.update({
                ...p,
                characters: updateChar(p.characters, c.id, { name: v }),
              })
            }
          />
        ))}
      </div>

      <div className="sr-section-head">Locations</div>
      <div className="sr-bible-grid">
        {p.locations.map((l) => (
          <RefCard
            key={l.id}
            kind="location"
            name={l.name}
            description={l.description}
            assetId={l.reference_asset_id}
            source={l.source}
            busy={!!busy[l.id] || (castingAll && !l.reference_asset_id)}
            error={errors[l.id]}
            onGenerate={(instruction) => generate("location", l.id, instruction)}
            onUpload={(f) => uploadFor("location", l.id, f)}
            onRename={(v) =>
              ctl.update({
                ...p,
                locations: updateLoc(p.locations, l.id, { name: v }),
              })
            }
          />
        ))}
      </div>

      <div className="rc-foot">
        <div className="rc-footl">
          <span className="rc-note">
            {lockedCount === totalRefs && totalRefs > 0
              ? "Show bible locked — drift defended."
              : "Generate or upload references to lock the look."}
          </span>
        </div>
        <button className="rc-cta" onClick={onAdvance}>
          Approve → Storyboard <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

function updateChar(
  list: Character[],
  id: string,
  next: Partial<Character>,
): Character[] {
  return list.map((c) => (c.id === id ? { ...c, ...next } : c));
}
function updateLoc(
  list: Location[],
  id: string,
  next: Partial<Location>,
): Location[] {
  return list.map((l) => (l.id === id ? { ...l, ...next } : l));
}

interface RefCardProps {
  kind: "character" | "location";
  name: string;
  description: string;
  assetId?: string | null;
  source: string;
  busy: boolean;
  error?: string;
  onGenerate: (instruction: string) => void;
  onUpload: (file: File) => void;
  onRename: (name: string) => void;
}

function RefCard({
  kind,
  name,
  description,
  assetId,
  source,
  busy,
  error,
  onGenerate,
  onUpload,
  onRename,
}: RefCardProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [note, setNote] = useState("");
  const has = !!assetId;

  return (
    <div className={"sr-bible-card" + (has ? " is-locked" : "")}>
      <div className="sr-bible-img">
        {has ? (
          <img src={assetRawUrl(assetId!)} alt={name} />
        ) : busy ? (
          <div className="sr-bible-ph">
            <Loader2 size={22} className="rc-spin" />
            <span>generating…</span>
          </div>
        ) : (
          <div className="sr-bible-ph">
            <Sparkles size={20} />
            <span>no reference yet</span>
          </div>
        )}
        {has && (
          <div className="sr-bible-badge">
            <Lock size={11} /> {source === "uploaded" ? "yours" : "locked"}
          </div>
        )}
        <span className="sr-bible-kind">{kind}</span>
      </div>

      <Editable
        className="sr-edit sr-strong sr-bible-name"
        value={name}
        onCommit={onRename}
        aria-label={`${kind} name`}
      />
      <p className="sr-bible-desc">{description}</p>

      {error && <div className="rc-err">{error}</div>}

      <input
        className="sr-edit sr-cast-note"
        value={note}
        disabled={busy}
        placeholder={
          kind === "character"
            ? "Note to steer it — e.g. older, red scarf, kinder eyes"
            : "Note to steer it — e.g. at night, more cluttered"
        }
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !busy) onGenerate(note.trim());
        }}
        aria-label={`${kind} generation note`}
      />

      <div className="sr-bible-actions">
        <button
          className="sr-mini"
          disabled={busy}
          onClick={() => onGenerate(note.trim())}
        >
          {busy ? (
            <Loader2 size={13} className="rc-spin" />
          ) : has ? (
            <RefreshCw size={13} />
          ) : (
            <Sparkles size={13} />
          )}
          {has ? "Regenerate" : "Generate reference"}
        </button>
        <button
          className="sr-mini ghost"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={13} /> Upload
        </button>
        {has && (
          <span className="sr-bible-ok">
            <Check size={13} />
          </span>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
