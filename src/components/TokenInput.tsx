import { useState, type KeyboardEvent } from "react";
import { uniqueNames } from "../lib/markdown.ts";

interface TokenInputProps {
  id: string;
  values: string[];
  placeholder?: string;
  onChange: (values: string[]) => void;
}

export function TokenInput({ id, values, placeholder, onChange }: TokenInputProps) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const next = uniqueNames([
      ...values,
      ...raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ]);
    if (next.length !== values.length) {
      onChange(next);
    }
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && draft === "" && values.length) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="tokens" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        event.preventDefault();
        document.getElementById(id)?.focus();
      }
    }}>
      {values.map((value) => (
        <span key={value} className="token">
          {value}
          <button
            type="button"
            aria-label={`Remove ${value}`}
            onClick={() => onChange(values.filter((item) => item !== value))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        className="token-input"
        value={draft}
        placeholder={values.length ? "" : placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}
