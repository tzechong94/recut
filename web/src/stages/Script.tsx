import { ArrowRight, MapPin, MessagesSquare, Users } from "lucide-react";
import type { UseProduction } from "../lib/useProduction";
import type { Character, Location, Production, Scene } from "../types";
import { Editable } from "../components/Editable";

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

function WritersRoom({ production }: { production: Production }) {
  const room = production.writers_room;
  return (
    <aside className="sr-room">
      <div className="sr-room-head">
        <MessagesSquare size={15} /> Writers' room
      </div>
      <div className="sr-room-thread">
        {room.length === 0 && (
          <p className="sr-empty-note">The transcript will appear here.</p>
        )}
        {room.map((m, i) => {
          const role = (m.role || "writer").toLowerCase();
          const isCritic = role.includes("critic");
          return (
            <div
              key={i}
              className={"sr-room-msg " + (isCritic ? "critic" : "writer")}
            >
              <div className="sr-room-role">
                {isCritic ? "Critic" : "Writer"}
                {typeof m.score === "number" && (
                  <span className="sr-room-score">
                    score {m.score.toFixed(2)}
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
