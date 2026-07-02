import { useState } from "react";
import { Check, Columns2, Loader2 } from "lucide-react";
import { api, assetRawUrl } from "../api/client";
import { modelLabel, takeCostUsd, takeIsStale } from "../lib/takes";
import type { Pricing, Production, Shot, Take } from "../types";

/**
 * THE PICKER — the fidelity contract's UI. Every take ever filmed for this shot,
 * permanent and selectable; compare two side by side; the chosen take is what ships.
 */
export function TakePicker({
  production,
  shot,
  pricing,
  onChanged,
}: {
  production: Production;
  shot: Shot;
  pricing: Pricing | null;
  onChanged: (p: Production) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const takes = shot.takes ?? [];

  async function choose(take: Take) {
    setBusy(take.id);
    try {
      const next = await api.chooseTake(production.id, shot.id, take.id);
      onChanged(next);
    } catch {
      /* row resets; retry available */
    } finally {
      setBusy(null);
    }
  }

  const toggleCompare = (id: string) =>
    setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c.slice(-1), id]));

  const compared = takes.filter((t) => compare.includes(t.id));

  return (
    <div className="sr-takes" data-testid={`takes-${shot.id}`}>
      {compared.length === 2 && (
        <div className="sr-take-compare">
          {compared.map((t) => (
            <div className="sr-take-compare-cell" key={t.id}>
              <video src={assetRawUrl(t.asset_id)} controls playsInline preload="metadata" />
              <div className="sr-take-compare-meta">
                <span>{modelLabel(t.model)}</span>
                {takeCostUsd(t, pricing) != null && <b>${takeCostUsd(t, pricing)!.toFixed(2)}</b>}
                <button
                  className="sr-mini"
                  disabled={busy === t.id || shot.chosen_take_id === t.id}
                  onClick={() => void choose(t)}
                >
                  {shot.chosen_take_id === t.id ? <Check size={12} /> : null}
                  {shot.chosen_take_id === t.id ? "In the film" : "Use this take"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="sr-take-strip">
        {takes.map((t, i) => {
          const chosen = shot.chosen_take_id === t.id;
          const stale = takeIsStale(shot, t);
          const cost = takeCostUsd(t, pricing);
          return (
            <div className={"sr-take" + (chosen ? " is-chosen" : "")} key={t.id}>
              <video
                src={assetRawUrl(t.asset_id)}
                muted
                playsInline
                preload="metadata"
                onClick={() => toggleCompare(t.id)}
                title={t.note || `take ${i + 1}`}
              />
              <div className="sr-take-meta">
                <span className="sr-take-model">{modelLabel(t.model)}</span>
                {typeof t.critic_score === "number" && <span>{t.critic_score.toFixed(2)}</span>}
                {cost != null && <span>${cost.toFixed(2)}</span>}
                {stale && <span className="sr-take-stale">stale</span>}
              </div>
              <div className="sr-take-actions">
                <button
                  className="sr-mini sm"
                  disabled={busy === t.id || chosen}
                  onClick={() => void choose(t)}
                  aria-label={`Use take ${i + 1}`}
                >
                  {busy === t.id ? <Loader2 size={11} className="rc-spin" /> : chosen ? <Check size={11} /> : null}
                  {chosen ? "in film" : "use"}
                </button>
                <button
                  className={"sr-mini sm ghost" + (compare.includes(t.id) ? " on" : "")}
                  onClick={() => toggleCompare(t.id)}
                  aria-label={`Compare take ${i + 1}`}
                >
                  <Columns2 size={11} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
