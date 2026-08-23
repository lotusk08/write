import { useState } from "react";
import { tokenLogin } from "../../../shared/github.ts";
import { lockToken } from "../../lib/lock.ts";
import type { Settings } from "../../lib/settings.ts";
import { Section } from "./Section.tsx";

export interface SettingsPanelProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

/**
 * The token that can write. It is locked with a password here and opened again
 * at the moment of publishing, so the one credential that can change the blog
 * is not sitting in this browser in the clear.
 */
function PublishToken({ settings, onChange }: SettingsPanelProps) {
  const [token, setToken] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (settings.publishToken) {
    return (
      <div className="field">
        <span className="field-label">Publish token</span>
        <div className="row wide-first">
          <p className="hint">Locked. The password is asked for when you publish.</p>
          <button
            type="button"
            className="btn tiny danger"
            onClick={() => onChange({ publishToken: null })}
          >
            Forget it
          </button>
        </div>
      </div>
    );
  }

  const lock = async () => {
    setBusy(true);
    setError(null);
    try {
      // Better to find out now than at the end of writing a post: a token
      // pasted with a stray newline is one GitHub answers anonymously.
      if (!(await tokenLogin(token.trim()))) {
        setError("GitHub did not accept that token.");
        return;
      }
      onChange({ publishToken: await lockToken(token.trim(), passphrase) });
      setToken("");
      setPassphrase("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <label htmlFor="set-publish-token">Publish token</label>
      <input
        id="set-publish-token"
        className="input"
        type="password"
        autoComplete="off"
        placeholder="github_pat_…"
        value={token}
        onChange={(event) => setToken(event.target.value)}
      />
      <div className="row wide-first">
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          aria-label="Password for the publish token"
          placeholder="Password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
        />
        <button
          type="button"
          className="btn"
          disabled={!token.trim() || !passphrase || busy}
          onClick={() => void lock()}
        >
          {busy ? "Locking…" : "Lock it"}
        </button>
      </div>
      {error ? <p className="hint" style={{ color: "var(--danger)" }}>{error}</p> : null}
      <p className="hint">
        Fine-grained, Contents: read and write. It is locked with that password and never kept
        unlocked — forget the password and you issue a new token, nothing worse.
      </p>
    </div>
  );
}

/**
 * Both tokens, behind a fold. They are pasted once and then never touched
 * again — the password at the publish step is the only part of this anyone
 * meets twice — so the menu does not carry them about.
 */
function Access({ settings, onChange }: SettingsPanelProps) {
  const ready = Boolean(settings.githubToken) && Boolean(settings.publishToken);
  // Open on a browser that cannot publish yet: there is nothing else to do.
  const [open, setOpen] = useState(!ready);

  return (
    <div className="field">
      <div className="field-head">
        <div>
          <span className="field-label">Access</span>
          <p className="hint">
            {ready
              ? "A read token, and a publish token under your password."
              : "Needs a read token and a publish token before it can publish."}
          </p>
        </div>
        <button type="button" className="btn tiny ghost" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Change"}
        </button>
      </div>

      {open ? (
        <>
          <div className="field">
            <label htmlFor="set-token">Read token</label>
            <input
              id="set-token"
              className="input"
              type="password"
              autoComplete="off"
              placeholder="github_pat_…"
              value={settings.githubToken}
              onChange={(event) => onChange({ githubToken: event.target.value })}
            />
            <p className="hint">
              Fine-grained, Contents: read on the blog repo. It opens published posts for editing
              and is kept in this browser as it is — what it can reach is on the blog anyway.
            </p>
          </div>

          <PublishToken settings={settings} onChange={onChange} />
        </>
      ) : null}
    </div>
  );
}

export function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  return (
    <>
      <Section title="Blog">
        <div className="row wide-first">
          <div className="field">
            <label htmlFor="set-repo">Repository</label>
            <input
              id="set-repo"
              className="input"
              value={settings.repo}
              onChange={(event) => onChange({ repo: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="set-branch">Branch</label>
            <input
              id="set-branch"
              className="input"
              value={settings.branch}
              onChange={(event) => onChange({ branch: event.target.value })}
            />
          </div>
        </div>
        <Access settings={settings} onChange={onChange} />
      </Section>

      <Section title="Post defaults">
        <div className="row">
          <div className="field">
            <label htmlFor="set-author">Author</label>
            <input
              id="set-author"
              className="input"
              value={settings.author}
              onChange={(event) => onChange({ author: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="set-tz">UTC offset</label>
            <input
              id="set-tz"
              className="input mono"
              type="number"
              step={30}
              value={settings.timezoneOffset}
              onChange={(event) => onChange({ timezoneOffset: Number(event.target.value) })}
            />
          </div>
        </div>
        <p className="hint">Offset in minutes; +0700 is 420.</p>
      </Section>

      <Section title="Repository paths">
        <div className="row">
          <div className="field">
            <label htmlFor="set-posts">Posts</label>
            <input
              id="set-posts"
              className="input mono"
              value={settings.postsDir}
              onChange={(event) => onChange({ postsDir: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="set-drafts">Drafts</label>
            <input
              id="set-drafts"
              className="input mono"
              value={settings.draftsDir}
              onChange={(event) => onChange({ draftsDir: event.target.value })}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="set-images">Images</label>
          <input
            id="set-images"
            className="input mono"
            value={settings.imagesDir}
            onChange={(event) => onChange({ imagesDir: event.target.value })}
          />
        </div>
      </Section>
    </>
  );
}
