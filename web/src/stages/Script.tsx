import {
  ArrowRight,
  MapPin,
  MessagesSquare,
  TrendingUp,
  Users,
} from "lucide-react";
import type { UseProduction } from "../lib/useProduction";
import type {
  Character,
  DialogueLine,
  Location,
  Production,
  Scene,
} from "../types";
import { Editable } from "../components/Editable";
import { WarningsBanner } from "../components/WarningsBanner";

interface StageProps {
  ctl: UseProduction;
  onAdvance: () => void;
}

export function ScriptStage({ ctl, onAdvance }: StageProps) {
  const p = ctl.production!;
  const patch = (next: Partial<Production>) =>
    ctl.update({ ...p, ...next });

  const setChar = (id: string, next: Partial<Character>) =>
    patch({
      characters: p.characters.map((c) =>
        c.id === id ? { ...c, ...next } : c,
      ),
    });
  const setLoc = (id: string, next: Partial<Location>) =>
    patch({
      locations: p.locations.map((l) => (l.id === id ? { ...l, ...next } : l)),
    });
  const setScene = (id: string, next: Partial<Scene>) =>
    patch({
      scenes: p.scenes.map((s) => (s.id === id ? { ...s, ...next } : s)),
    });
  const setLine = (sceneId: string, lineIdx: number, line: string) =>
    patch({
      scenes: p.scenes.map((s) =>
        s.id === sceneId
          ? {
              ...s,
              script: (s.script ?? []).map((d, i) =>
                i === lineIdx ? { ...d, line } : d,
              ),
            }
          : s,
      ),
    });

  return (
    <div className="rc-stage">
      <div className="rc-head">
        <div className="rc-kicker">STAGE 1 · THE WRITERS' ROOM</div>
        <h2>The treatment</h2>
        <p>
          A writer drafted it, a critic pushed back, the writer revised. Read the
          room below — then shape the treatment. Every field is editable and
          autosaves.
        </p>
      </div>

      <WarningsBanner warnings={p.warnings} />

      <div className="sr-script-grid">
        <div className="sr-treatment">
          <label className="sr-field-label">Title</label>
          <Editable
            className="sr-title-edit"
            value={p.title}
            onCommit={(v) => patch({ title: v })}
            aria-label="Title"
          />

          <label className="sr-field-label">Logline</label>
          <Editable
            value={p.logline}
            onCommit={(v) => patch({ logline: v })}
            multiline
            placeholder="One sentence that sells the film…"
            aria-label="Logline"
          />

          {p.dramatic_question && (
            <div className="sr-question" data-testid="dramatic-question">
              <span className="sr-question-tag">The question</span>
              <Editable
                className="sr-question-text"
                value={p.dramatic_question}
                onCommit={(v) => patch({ dramatic_question: v })}
                multiline
                aria-label="Dramatic question"
              />
              {p.theme && (
                <div className="sr-question-theme">
                  Theme · <b>{p.theme}</b>
                </div>
              )}
            </div>
          )}

          <div className="sr-section-head">
            <Users size={14} /> Characters
          </div>
          <div className="sr-cards">
            {p.characters.map((c) => (
              <div className="sr-treat-card" key={c.id}>
                <div className="sr-treat-row">
                  <Editable
                    className="sr-edit sr-strong"
                    value={c.name}
                    onCommit={(v) => setChar(c.id, { name: v })}
                    aria-label="Character name"
                  />
                  <Editable
                    className="sr-edit sr-role"
                    value={c.role}
                    onCommit={(v) => setChar(c.id, { role: v })}
                    placeholder="role"
                    aria-label="Character role"
                  />
                </div>
                <Editable
                  value={c.description}
                  onCommit={(v) => setChar(c.id, { description: v })}
                  multiline
                  placeholder="Appearance + wardrobe…"
                  aria-label="Character description"
                />
              </div>
            ))}
            {p.characters.length === 0 && (
              <p className="sr-empty-note">No characters yet.</p>
            )}
          </div>

          <div className="sr-section-head">
            <MapPin size={14} /> Locations
          </div>
          <div className="sr-cards">
            {p.locations.map((l) => (
              <div className="sr-treat-card" key={l.id}>
                <Editable
                  className="sr-edit sr-strong"
                  value={l.name}
                  onCommit={(v) => setLoc(l.id, { name: v })}
                  aria-label="Location name"
                />
                <Editable
                  value={l.description}
                  onCommit={(v) => setLoc(l.id, { description: v })}
                  multiline
                  placeholder="Mood + lighting…"
                  aria-label="Location description"
                />
              </div>
            ))}
            {p.locations.length === 0 && (
              <p className="sr-empty-note">No locations yet.</p>
            )}
          </div>

          <div className="sr-section-head">Scene beats</div>
          <div className="sr-cards">
            {p.scenes.map((s, i) => (
              <div className="sr-treat-card sr-beat" key={s.id}>
                <div className="sr-beat-num">{i + 1}</div>
                <div className="sr-beat-body">
                  <Editable
                    className="sr-edit sr-heading"
                    value={s.heading}
                    onCommit={(v) => setScene(s.id, { heading: v })}
                    placeholder="INT. LOCATION - TIME"
                    aria-label="Scene heading"
                  />
                  <Editable
                    value={s.summary}
                    onCommit={(v) => setScene(s.id, { summary: v })}
                    multiline
                    placeholder="What happens — and why it matters…"
                    aria-label="Scene summary"
                  />
                  <ScriptBlock
                    scene={s}
                    onEditLine={(idx, line) => setLine(s.id, idx, line)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <WritersRoom production={p} />
      </div>

      <div className="rc-foot">
        <div className="rc-footl">
          <span className="rc-note">{p.scenes.length} scenes · cheap text tokens only</span>
        </div>
        <button className="rc-cta" onClick={onAdvance}>
          Approve → Cast <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

/**
 * The written, critiqued dialogue for a scene, laid out as a screenplay block
 * (CHARACTER over their line). These are the ACTUAL lines that get spoken and
 * burned to screen — kept inline-editable, autosaving like every other field.
 */
function ScriptBlock({
  scene,
  onEditLine,
}: {
  scene: Scene;
  onEditLine: (idx: number, line: string) => void;
}) {
  const lines: DialogueLine[] = scene.script ?? [];
  if (lines.length === 0) return null;

  return (
    <div className="sr-screenplay" data-testid="script-block">
      <div className="sr-screenplay-tag">The lines · spoken &amp; burned</div>
      {lines.map((d, i) => (
        <div className="sr-sp-line" key={i}>
          <div className="sr-sp-char">{d.character_name}</div>
          <Editable
            className="sr-sp-dialogue"
            value={d.line}
            onCommit={(v) => onEditLine(i, v)}
            multiline
            aria-label={`Line ${i + 1} for ${d.character_name}`}
          />
        </div>
      ))}
    </div>
  );
}

function roomKind(role: string): "critic" | "system" | "writer" | "dialogue" {
  const r = (role || "writer").toLowerCase();
  if (r.includes("critic")) return "critic";
  if (r.includes("dialogue")) return "dialogue";
  if (r.includes("system")) return "system";
  return "writer";
}

function WritersRoom({ production }: { production: Production }) {
  const room = production.writers_room;
  // Track the critic's score as it climbs across rounds so each critic turn can
  // show its delta vs. the previous critic pass — the "narrative" showpiece.
  const scores = room
    .filter((m) => roomKind(m.role) === "critic" && typeof m.score === "number")
    .map((m) => m.score as number);
  const finalScore = scores.length ? scores[scores.length - 1] : null;
  let criticSeen = 0;

  return (
    <aside className="sr-room">
      <div className="sr-room-head">
        <MessagesSquare size={15} /> Writers' room
        {finalScore !== null && (
          <span className="sr-room-final" data-testid="room-final-score">
            <TrendingUp size={12} /> {finalScore.toFixed(2)}
          </span>
        )}
      </div>
      <div className="sr-room-thread" data-testid="writers-room">
        {room.length === 0 && (
          <p className="sr-empty-note">The transcript will appear here.</p>
        )}
        {room.map((m, i) => {
          const kind = roomKind(m.role);
          const hasScore = typeof m.score === "number";
          let delta: number | null = null;
          let round = 0;
          if (kind === "critic" && hasScore) {
            const prev = criticSeen > 0 ? scores[criticSeen - 1] : null;
            delta = prev === null ? null : (m.score as number) - prev;
            criticSeen += 1;
            round = criticSeen;
          }
          const label =
            kind === "critic"
              ? "Critic"
              : kind === "system"
                ? "System"
                : kind === "dialogue"
                  ? "Dialogue"
                  : "Writer";
          return (
            <div key={i} className={"sr-room-msg " + kind}>
              <div className="sr-room-role">
                {kind === "critic" && round > 0 && (
                  <span className="sr-room-round">round {round}</span>
                )}
                {label}
                {hasScore && (
                  <span
                    className="sr-room-score"
                    title="Critic's narrative score (0–1)"
                  >
                    {(m.score as number).toFixed(2)}
                    {delta !== null && delta > 0 && (
                      <i className="sr-room-delta up">
                        ▲ {delta.toFixed(2)}
                      </i>
                    )}
                    {delta !== null && delta < 0 && (
                      <i className="sr-room-delta down">
                        ▼ {Math.abs(delta).toFixed(2)}
                      </i>
                    )}
                  </span>
                )}
              </div>
              <div className="sr-room-text">{m.text}</div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
