import { useState, type KeyboardEvent } from "react";

interface TokenInputProps {
  id: string;
  values: string[];
  placeholder?: string;
  onChange: (values: string[]) => void;
}

/** Comma- or Enter-separated values shown as removable chips. */
export function TokenInput({ id, values, placeholder, onChange }: TokenInputProps) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const added = raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item && !values.includes(item));
    if (added.length) {
      onChange([...values, ...added]);
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
