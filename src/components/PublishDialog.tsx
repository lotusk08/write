import { useEffect, useMemo, useState } from "react";
import type { AppConfig, PublishResult } from "../../shared/types.ts";
import { publish, usesServerPublishing } from "../lib/api.ts";
import type { Draft } from "../lib/db.ts";
import { buildPublishPlan, defaultCommitMessage, publishBranchName, type PublishPlan } from "../lib/publish.ts";
import type { Settings } from "../lib/settings.ts";
import { Dialog } from "./Dialog.tsx";

interface PublishDialogProps {
  draft: Draft;
  settings: Settings;
  config: AppConfig | null;
  onSettingsChange: (patch: Partial<Settings>) => void;
  /** Unlocked earlier in this tab, if the post came from the blog. */
  password: string;
  onPassword: (password: string) => void;
  onClose: () => void;
  onPublished: (result: PublishResult, plan: PublishPlan) => void;
  onOpenSettings: () => void;
}

export function PublishDialog({
  draft,
  settings,
  config,
  onSettingsChange,
  password,
  onPassword,
  onClose,
  onPublished,
  onOpenSettings,
}: PublishDialogProps) {
  const [plan, setPlan] = useState<PublishPlan | null>(null);
  const [message, setMessage] = useState(() => defaultCommitMessage(draft, Boolean(draft.publishedPath)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsPassword = usesServerPublishing(config) && Boolean(config?.authRequired);

  const repo = usesServerPublishing(config) ? config!.repo : settings.repo;
  const baseBranch = usesServerPublishing(config) ? config!.branch : settings.branch;

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

  const missingCredentials = useMemo(() => {
    if (usesServerPublishing(config)) {
      // The password is asked for below rather than being a setting to fix.
      return null;
    }
    return settings.githubToken
      ? null
      : "No GitHub token yet — add one in Settings, or deploy the worker with a GITHUB_TOKEN secret so the token stays off your browser.";
  }, [config, settings.githubToken]);

  const run = async () => {
    if (!plan || (needsPassword && !password)) {
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
        config,
        settings,
        password,
      );
      onPublished(result, plan);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Publish to blog"
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
            disabled={!plan || busy || Boolean(missingCredentials) || (needsPassword && !password)}
            onClick={() => void run()}
          >
            {busy ? "Publishing…" : settings.openPullRequest ? "Open pull request" : "Commit"}
          </button>
        </>
      }
    >
      {config?.warning ? <div className="notice warn">{config.warning}</div> : null}
      {missingCredentials ? (
        <div className="notice warn">
          {missingCredentials}{" "}
          <button type="button" className="btn ghost" onClick={onOpenSettings}>
            Open settings
          </button>
        </div>
      ) : null}
      {renamedFrom ? (
        <div className="notice warn">
          This writes a new file. The post it was opened from,{" "}
          <span className="mono">{renamedFrom}</span>, stays on the blog — delete it there if you
          meant to rename this one.
        </div>
      ) : null}
      {error ? <div className="notice warn">{error}</div> : null}

      {needsPassword ? (
        <div className="field">
          <label htmlFor="publish-password">Publish password</label>
          <input
            id="publish-password"
            className="input"
            type="password"
            autoComplete="current-password"
            autoFocus
            placeholder="••••••••"
            value={password}
            onChange={(event) => onPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void run();
              }
            }}
          />
          <p className="hint">
            The worker holds the GitHub token; this unlocks it for this one commit and is not saved.
          </p>
        </div>
      ) : null}

      <div className="row">
        <div className="field">
          <label htmlFor="publish-target">Publish as</label>
          <select
            id="publish-target"
            className="select"
            value={settings.publishTarget}
            onChange={(event) => onSettingsChange({ publishTarget: event.target.value as Settings["publishTarget"] })}
          >
            <option value="posts">Post ({settings.postsDir})</option>
            <option value="drafts">Draft ({settings.draftsDir})</option>
          </select>
        </div>
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
