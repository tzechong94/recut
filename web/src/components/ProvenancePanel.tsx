/**
 * Provenance / token-meter panel (accepted scope; not in the prototype).
 * Reads token_ledger and shows: % of cut that is the creator's footage, a
 * stacked seconds breakdown, tokens spent vs the naive full-generation
 * baseline, and a one-line IP-safety note.
 *
 * In the AI-first model the headline is reframed around AI-generated footage
 * (the default) vs the creator's own uploads vs not-yet-generated stand-ins.
 * The underlying ledger fields are unchanged — only the labels move.
 */
import { ShieldCheck, Sparkles } from "lucide-react";
import type { TokenLedger } from "../types";
import { deriveLedger, fmtTokens, pct } from "../lib/tokens";

export function ProvenancePanel({
  ledger,
  aiFirst = false,
}: {
  ledger: TokenLedger;
  aiFirst?: boolean;
}) {
  const d = deriveLedger(ledger);
  const realPct = d.real_footage_share * 100;
  const genPct = d.generated_share * 100;
  const standinPct = d.standin_share * 100;

  return (
    <div className="rc-prov" data-testid="provenance">
      <div className="rc-provhead">
        <ShieldCheck size={15} /> Provenance
      </div>

      {aiFirst ? (
        <>
          <div className="rc-provbig rc-provbig--ai">
            <span data-testid="gen-share">{pct(d.generated_share)}</span>{" "}
            AI-generated
          </div>
          <div className="rc-provsub" data-testid="ai-mix">
            AI-generated {pct(d.generated_share)} · your uploads{" "}
            {pct(d.real_footage_share)} · stand-in {pct(d.standin_share)}
          </div>
        </>
      ) : (
        <>
          <div className="rc-provbig">
            <span data-testid="real-share">{pct(d.real_footage_share)}</span> of
            this cut is YOUR footage
          </div>
          <div className="rc-provsub">
            {d.total_s.toFixed(0)}s total · {ledger.real_footage_s.toFixed(0)}s
            real · {ledger.generated_s.toFixed(0)}s generated ·{" "}
            {ledger.standin_s.toFixed(0)}s stand-in
          </div>
        </>
      )}

      <div className="rc-provbar" aria-hidden="true">
        <i className="gen" style={{ width: `${genPct}%` }} />
        <i className="real" style={{ width: `${realPct}%` }} />
        <i className="standin" style={{ width: `${standinPct}%` }} />
      </div>
      <div className="rc-provlegend">
        <span>
          <i style={{ background: "#7B5CFF" }} /> AI-generated
        </span>
        <span>
          <i style={{ background: "#0FB5A6" }} /> Your uploads
        </span>
        <span>
          <i style={{ background: "#4a4550" }} /> Stand-in
        </span>
      </div>

      <div className="rc-provtokens">
        <div>
          <b>{fmtTokens(ledger.tokens_spent)}</b>
          <small>tokens spent</small>
        </div>
        <div style={{ textAlign: "right" }}>
          <b className="saved" data-testid="tokens-saved">
            {fmtTokens(d.tokens_saved)}
          </b>
          <small>
            saved vs {fmtTokens(ledger.naive_baseline_tokens)} full-gen
          </small>
        </div>
      </div>

      <div className="rc-provnote">
        {aiFirst ? (
          <>
            <Sparkles size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            AI clips are generated for you — your uploads always replace them.
            Recipe = structure only, never the reference's footage.
          </>
        ) : (
          <>
            <ShieldCheck size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            Recipe = structure only. Never the reference's footage.
          </>
        )}
      </div>
    </div>
  );
}
