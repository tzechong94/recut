import { useEffect, useRef, useState } from "react";

interface EditableProps {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  "aria-label"?: string;
}

/**
 * Inline-editable text. Commits on blur (or Enter for single-line). Local state
 * mirrors the value so typing is smooth; parent owns persistence (autosave).
 */
export function Editable({
  value,
  onCommit,
  placeholder,
  className,
  multiline,
  ...rest
}: EditableProps) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => setDraft(value), [value]);

  const grow = () => {
    if (multiline && ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = ref.current.scrollHeight + "px";
    }
  };
  // re-measure on content change AND on focus — a field that mounted hidden
  // (collapsed card, late font) has scrollHeight 0 and would stay clipped
  useEffect(grow, [draft, multiline]);

  function commit() {
    if (draft !== value) onCommit(draft);
  }

  if (multiline) {
    return (
      <textarea
        ref={ref}
        className={className ?? "sr-edit sr-edit-multi"}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={grow}
        onBlur={commit}
        rows={1}
        {...rest}
      />
    );
  }

  return (
    <input
      className={className ?? "sr-edit"}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      {...rest}
    />
  );
}
