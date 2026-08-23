import { useEffect, useMemo, useState } from "react";
import type { AppConfig, PublishResult } from "../../shared/types.ts";
import { PasswordRejected, publish } from "../lib/api.ts";
import type { Draft } from "../lib/db.ts";
import { buildPublishPlan, defaultCommitMessage, publishBranchName, type PublishPlan } from "../lib/publish.ts";
import type { Settings } from "../lib/settings.ts";
import { Dialog } from "./Dialog.tsx";

interface PublishDialogProps {
  draft: Draft;
  settings: Settings;
  config: AppConfig | null;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
  onPublished: (result: PublishResult, plan: PublishPlan) => void;
}

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
  // Asked for only when there is none to send, or when the Worker has just
  // said the one we sent is wrong. Otherwise publishing is one button.
  const [password, setPassword] = useState(settings.publishPassword);
  const [rejected, setRejected] = useState(false);
  const asking = !settings.publishPassword || rejected;

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

  /**
   * A post's file name is built from its date and slug, so editing either of
   * those on a post that came from the blog writes a second file rather than
   * replacing the first.
   */
  const renamedFrom =
    draft.publishedPath && plan && plan.markdownPath !== draft.publishedPath
      ? draft.publishedPath
      : null;

  // Nothing to type and nothing to fix in this browser: either the deployment
  // can publish or it says what it is missing, and Cloudflare Access has
  // already decided whether this session is allowed to ask.
  const blocked = useMemo(
    () =>
      config === null
        ? "This app's own API did not answer, so it cannot publish. Reload and try again."
        : config.ready
          ? null
          : config.problem ?? "This deployment is not configured to publish.",
    [config],
  );

  const run = async () => {
    if (!plan || blocked || (asking && !password)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const branch = settings.openPullRequest ? publishBranchName(plan.slug) : baseBranch;
      const result = await publish(
        {
          message,
          files: plan.files,
          branch,
          pullRequest: settings.openPullRequest
            ? { title: message, body: `Published from write.\n\n\`${plan.markdownPath}\`` }
            : null,
        },
        password,
      );
      // It worked, so it is worth keeping: this is the last time this device
      // asks, until the password on the Worker changes.
      if (password !== settings.publishPassword) {
        onSettingsChange({ publishPassword: password });
      }
      onPublished(result, plan);
    } catch (cause) {
      if (cause instanceof PasswordRejected) {
        // A stored password that has stopped working is worse than none: it
        // would fail the same way every time without ever asking.
        setRejected(true);
        if (settings.publishPassword) {
          onSettingsChange({ publishPassword: "" });
        }
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Publish"
      subtitle={`${repo} · ${settings.openPullRequest ? "pull request" : baseBranch}`}
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
            {busy ? "Publishing…" : settings.openPullRequest ? "Open pull request" : "Commit"}
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

      {asking ? (
        <div className="field">
          <label htmlFor="publish-password">Password</label>
          <input
            id="publish-password"
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
                void run();
              }
            }}
          />
          <p className="hint">
            Remembered on this device once it works, so this is the only time it is asked for.
          </p>
        </div>
      ) : null}

      <div className="field">
        <span className="field-label">Review</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.openPullRequest}
            onChange={(event) => onSettingsChange({ openPullRequest: event.target.checked })}
          />
          Open a pull request
        </label>
      </div>

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
