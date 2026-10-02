import { useEffect, useMemo, useRef, useState } from "react";
import type { AppConfig, PublishResult } from "../../shared/types.ts";
import { PasswordRejected, publish } from "../lib/api.ts";
import { addPasskey, passkeysAvailable, signInWithPasskey } from "../lib/passkey.ts";
import { rememberPassword, rememberSession, sessionPassword, sessionToken } from "../lib/password.ts";
import type { Draft } from "../lib/db.ts";
import { buildPublishPlan, defaultCommitMessage, type PublishPlan } from "../lib/publish.ts";
import type { Settings } from "../lib/settings.ts";
import { Dialog } from "./Dialog.tsx";
import { Toggle, type ToggleOption } from "./Toggle.tsx";

interface PublishDialogProps {
  draft: Draft;
  settings: Settings;
  config: AppConfig | null;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
  onPublished: (result: PublishResult, plan: PublishPlan) => void;
}

const TARGETS: ToggleOption<Settings["publishTarget"]>[] = [
  { id: "posts", label: "Post" },
  { id: "drafts", label: "Draft" },
];

export function PublishDialog({
  draft,
  settings,
  config,
  onSettingsChange,
  onClose,
  onPublished,
}: PublishDialogProps) {
  const [plan, setPlan] = useState<PublishPlan | null>(null);
  const [message, setMessage] = useState(() => defaultCommitMessage(draft, Boolean(draft.publishedPath)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState(sessionPassword);
  const [session, setSession] = useState(sessionToken);
  const [rejected, setRejected] = useState(0);
  const passwordField = useRef<HTMLInputElement>(null);
  const canPasskey = useMemo(passkeysAvailable, []);
  const asking = (!sessionPassword() && !session) || rejected > 0;

  const repo = settings.repo;
  const baseBranch = settings.branch;

  useEffect(() => {
    let cancelled = false;
    setPlan(null);
    void buildPublishPlan(draft, settings)
      .then((next) => {
        if (!cancelled) {
          setPlan(next);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [draft, settings]);

  useEffect(() => {
    if (rejected) {
      passwordField.current?.focus();
    }
  }, [rejected]);

  const renamedFrom =
    draft.publishedPath && plan && plan.markdownPath !== draft.publishedPath
      ? draft.publishedPath
      : null;

  const blocked = useMemo(
    () =>
      config === null
        ? "This app's own API did not answer, so it cannot publish. Reload and try again."
        : config.ready
          ? null
          : config.problem ?? "This deployment is not configured to publish.",
    [config],
  );

  const forget = () => {
    setRejected((count) => count + 1);
    setPassword("");
    setSession("");
    rememberPassword("");
    rememberSession("");
  };

  const withPasskey = async (ceremony: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      const token = await ceremony();
      if (token) {
        rememberSession(token);
        setSession(token);
        setRejected(0);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!plan || blocked || (asking && !password)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await publish({ message, files: plan.files }, asking ? password : sessionPassword());
      if (asking) {
        rememberPassword(password);
      }
      onPublished(result, plan);
    } catch (cause) {
      if (cause instanceof PasswordRejected) {
        forget();
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Publish"
      subtitle={`${repo} · ${baseBranch}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!plan || busy || Boolean(blocked) || (asking && !password)}
            onClick={() => void run()}
          >
            {busy ? "Publishing…" : "Commit"}
          </button>
        </>
      }
    >
      {blocked ? <div className="notice warn">{blocked}</div> : null}
      {renamedFrom ? (
        <div className="notice warn">
          This writes a new file. The post it was opened from,{" "}
          <span className="mono">{renamedFrom}</span>, stays on the blog — delete it there if you
          meant to rename this one.
        </div>
      ) : null}
      {error ? <div className="notice warn">{error}</div> : null}

      <div className="menu-row publish-as">
        <span className="field-label">Publish as</span>
        <Toggle
          label="Publish as"
          options={TARGETS}
          value={settings.publishTarget}
          onChange={(publishTarget) => onSettingsChange({ publishTarget })}
        />
      </div>

      {asking ? (
        <div className="field">
          <label htmlFor="publish-password">Password</label>
          <div className="password-row">
            <input
              ref={passwordField}
              id="publish-password"
              className="input"
              type="password"
              autoComplete="current-password"
              autoFocus={!canPasskey}
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void run();
                }
              }}
            />
            {canPasskey ? (
              <button
                type="button"
                className="btn"
                disabled={busy || Boolean(blocked)}
                onClick={() => void withPasskey(signInWithPasskey)}
              >
                Passkey
              </button>
            ) : null}
          </div>
          {canPasskey && password ? (
            <button
              type="button"
              className="btn tiny save-passkey"
              disabled={busy || Boolean(blocked)}
              onClick={() => void withPasskey(() => addPasskey(password))}
            >
              Save a passkey on this device
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="publish-message">Commit message</label>
        <input
          id="publish-message"
          className="input"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
      </div>

      <div className="field">
        <span className="field-label">Files</span>
        {plan ? (
          <ul className="file-list">
            {plan.files.map((file) => (
              <li key={file.path}>{file.path}</li>
            ))}
          </ul>
        ) : (
          <p className="hint">Preparing…</p>
        )}
        {plan?.skippedImages.length ? (
          <p className="hint" style={{ color: "var(--danger)" }}>
            {plan.skippedImages.length} image(s) missing from this browser's storage and will not be uploaded.
          </p>
        ) : null}
      </div>

      <div className="field">
        <span className="field-label">Preview</span>
        <pre className="code-preview">{plan ? plan.markdown.slice(0, 4000) : ""}</pre>
      </div>
    </Dialog>
  );
}
