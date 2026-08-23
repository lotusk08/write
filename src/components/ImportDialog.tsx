import { useState } from "react";
import { Dialog } from "./Dialog.tsx";

interface ImportDialogProps {
  /** Repo path being opened, e.g. `_posts/2026-08-22-coffee.md`. */
  path: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onUnlock: (password: string) => void;
}

/**
 * Shown when the blog's edit button sends a post here. The repo is private, so
 * reading it back needs the same password publishing does — which is the whole
 * dialog: the file being opened, one field, and a way in.
 */
export function ImportDialog({ path, busy, error, onCancel, onUnlock }: ImportDialogProps) {
  const [password, setPassword] = useState("");
  const submit = () => {
    if (password && !busy) {
      onUnlock(password);
    }
  };

  return (
    <Dialog
      compact
      title="Open from the blog"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!password || busy} onClick={submit}>
            {busy ? "Opening…" : "Open"}
          </button>
        </>
      }
    >
      <p className="unlock-path mono">{path}</p>

      <input
        className="input unlock-field"
        type="password"
        autoComplete="current-password"
        aria-label="Publish password"
        autoFocus
        placeholder="Password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
      />

      {error ? <p className="unlock-error">{error}</p> : null}
      <p className="hint unlock-note">I built this feature just for myself — Steve Hoang</p>
    </Dialog>
  );
}
