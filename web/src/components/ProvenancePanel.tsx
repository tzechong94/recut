/**
 * Provenance / token-meter panel (accepted scope; not in the prototype).
 * Reads token_ledger and shows: % of cut that is the creator's footage, a
 * stacked seconds breakdown, tokens spent vs the naive full-generation
 * baseline, and a one-line IP-safety note.
 */
import { ShieldCheck } from "lucide-react";
import type { TokenLedger } from "../types";
import { deriveLedger, fmtTokens, pct } from "../lib/tokens";

export function ProvenancePanel({ ledger }: { ledger: TokenLedger }) {
  const d = deriveLedger(ledger);
  const realPct = d.real_footage_share * 100;
  const genPct = d.generated_share * 100;
  const standinPct = d.standin_share * 100;

  return (
    <div className="rc-prov" data-testid="provenance">
      <div className="rc-provhead">
        <ShieldCheck size={15} /> Provenance
      </div>
      <div className="rc-provbig">
        <span data-testid="real-share">{pct(d.real_footage_share)}</span> of this
        cut is YOUR footage
      </div>
      <div className="rc-provsub">
        {d.total_s.toFixed(0)}s total · {ledger.real_footage_s.toFixed(0)}s real ·{" "}
        {ledger.generated_s.toFixed(0)}s generated ·{" "}
        {ledger.standin_s.toFixed(0)}s stand-in
      </div>

      <div className="rc-provbar" aria-hidden="true">
        <i className="real" style={{ width: `${realPct}%` }} />
        <i className="gen" style={{ width: `${genPct}%` }} />
        <i className="standin" style={{ width: `${standinPct}%` }} />
      </div>
      <div className="rc-provlegend">
        <span>
          <i style={{ background: "#0FB5A6" }} /> Your footage
        </span>
        <span>
          <i style={{ background: "#7B5CFF" }} /> Generated
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
        <ShieldCheck size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        Recipe = structure only. Never the reference's footage.
      </div>
    </div>
  );
}
