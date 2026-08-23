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
 * reading it back needs the same password publishing does.
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
      title="Edit the post from the blog"
      subtitle={path}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!password || busy} onClick={submit}>
            {busy ? "Opening…" : "Open"}
          </button>
        </>
      }
    >
      {error ? <div className="notice warn">{error}</div> : null}
      <div className="field">
        <label htmlFor="import-password">Publish password</label>
        <input
          id="import-password"
          className="input"
          type="password"
          autoComplete="current-password"
          autoFocus
          placeholder="••••••••"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
        <p className="hint">
          I built this feature just for myself - Steve Hoang
        </p>
      </div>
    </Dialog>
  );
}
