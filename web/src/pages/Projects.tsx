import { useEffect, useState } from "react";
import {
  Clapperboard,
  Copy,
  Library,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { STAGES, shade } from "../components/types-map";
import { api } from "../api/client";
import type { Project } from "../types";

const TONES = ["#5B3DF5", "#FF5C49", "#7B5CFF", "#0FB5A6", "#F5A524"];

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export interface ProjectsProps {
  open: (id: string) => void;
  openLibrary: () => void;
}

export function Projects({ open, openLibrary }: ProjectsProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const ps = await api.listProjects();
        setProjects(ps);
      } catch {
        setOffline(true);
        setProjects([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const create = async () => {
    const tone = TONES[Math.floor(Math.random() * TONES.length)];
    try {
      const p = await api.createProject({ name: "Untitled project", tone });
      setProjects((ps) => [p, ...ps]);
      open(p.id);
    } catch {
      // offline: make a local stand-in project so the editor is reachable
      const now = new Date().toISOString();
      const p: Project = {
        id: "local-" + Date.now().toString(36),
        name: "Untitled project",
        stage: 0,
        tone,
        token_cap: 100000,
        created_at: now,
        updated_at: now,
      };
      setProjects((ps) => [p, ...ps]);
      open(p.id);
    }
  };

  const dup = async (p: Project) => {
    setMenu(null);
    try {
      const copy = await api.createProject({
        name: p.name + " copy",
        tone: p.tone,
      });
      setProjects((ps) => [copy, ...ps]);
    } catch {
      const now = new Date().toISOString();
      setProjects((ps) => [
        {
          ...p,
          id: "local-" + Date.now().toString(36),
          name: p.name + " copy",
          created_at: now,
          updated_at: now,
        },
        ...ps,
      ]);
    }
  };

  const del = async (id: string) => {
    setConfirmDel(null);
    setMenu(null);
    setProjects((ps) => ps.filter((p) => p.id !== id));
    try {
      await api.deleteProject(id);
    } catch {
      /* local removal already applied */
    }
  };

  const rename = async (id: string, name: string) => {
    setRenaming(null);
    const finalName = name || "Untitled project";
    setProjects((ps) =>
      ps.map((p) => (p.id === id ? { ...p, name: finalName } : p)),
    );
    try {
      await api.patchProject(id, { name: finalName });
    } catch {
      /* local rename already applied */
    }
  };

  return (
    <div className="rc-proj-page">
      <header className="rc-top">
        <div className="rc-brand">
          <span className="rc-mark">
            <Clapperboard size={15} strokeWidth={2.4} />
          </span>
          <span className="rc-name">Recut</span>
        </div>
      </header>

      <div className="rc-proj-inner">
        {offline && (
          <div className="rc-banner">
            Backend offline — running in demo mode. Projects you create live in
            this browser only.
          </div>
        )}
        <div className="rc-proj-head">
          <div>
            <h1>Projects</h1>
            <p>
              Every post starts from a format you love. Pick up where you left
              off, or start a new one.
            </p>
          </div>
          <button className="rc-libbtn" onClick={openLibrary}>
            <Library size={16} /> Recipe library
          </button>
        </div>

        {loading ? (
          <div className="rc-loading">
            <div className="rc-genspin" />
            Loading projects…
          </div>
        ) : (
          <div className="rc-grid">
            <button className="rc-newtile" onClick={create}>
              <span className="rc-newplus">
                <Plus size={22} />
              </span>
              <span>New project</span>
            </button>

            {projects.map((p) => (
              <div className="rc-card" key={p.id}>
                <button
                  className="rc-cardthumb"
                  style={{
                    background: `linear-gradient(155deg, ${p.tone}, ${shade(
                      p.tone,
                    )})`,
                  }}
                  onClick={() => open(p.id)}
                >
                  <span className="rc-cardstage">
                    {STAGES[p.stage] || "Draft"}
                  </span>
                  <span className="rc-cardplay">
                    <Play size={16} fill="#fff" strokeWidth={0} />
                  </span>
                </button>
                <div className="rc-cardrow">
                  <div className="rc-cardinfo">
                    {renaming === p.id ? (
                      <input
                        autoFocus
                        className="rc-renameinput"
                        defaultValue={p.name}
                        onBlur={(e) => rename(p.id, e.target.value.trim())}
                        onKeyDown={(e) =>
                          e.key === "Enter" &&
                          rename(p.id, e.currentTarget.value.trim())
                        }
                      />
                    ) : (
                      <button
                        className="rc-cardname"
                        onClick={() => open(p.id)}
                      >
                        {p.name}
                      </button>
                    )}
                    <span className="rc-cardedited">
                      Edited {relTime(p.updated_at)}
                    </span>
                  </div>
                  <div className="rc-cardmenu">
                    <button
                      className="rc-iconbtn"
                      aria-label="Project options"
                      onClick={() => {
                        setMenu(menu === p.id ? null : p.id);
                        setConfirmDel(null);
                      }}
                    >
                      <MoreHorizontal size={17} />
                    </button>
                    {menu === p.id && (
                      <div className="rc-menu">
                        <button
                          onClick={() => {
                            setRenaming(p.id);
                            setMenu(null);
                          }}
                        >
                          <Pencil size={13} /> Rename
                        </button>
                        <button onClick={() => dup(p)}>
                          <Copy size={13} /> Duplicate
                        </button>
                        {confirmDel === p.id ? (
                          <button
                            className="rc-del"
                            onClick={() => del(p.id)}
                          >
                            <Trash2 size={13} /> Delete for good?
                          </button>
                        ) : (
                          <button
                            className="rc-del"
                            onClick={() => setConfirmDel(p.id)}
                          >
                            <Trash2 size={13} /> Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
