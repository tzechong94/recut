import type { ReactNode } from "react";

export function Head({ k, t, s }: { k: string; t: string; s: string }) {
  return (
    <div className="rc-head">
      <span className="rc-kicker">{k}</span>
      <h2>{t}</h2>
      <p>{s}</p>
    </div>
  );
}

export function Foot({
  left,
  right,
  note,
}: {
  left?: ReactNode;
  right?: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="rc-foot">
      <div className="rc-footl">
        {left}
        {note && <span className="rc-note">{note}</span>}
      </div>
      <div className="rc-footr">{right}</div>
    </div>
  );
}
