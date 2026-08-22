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
  onClose: () => void;
  onPublished: (result: PublishResult, plan: PublishPlan) => void;
  onOpenSettings: () => void;
}

export function PublishDialog({
  draft,
  settings,
  config,
  onSettingsChange,
  onClose,
  onPublished,
  onOpenSettings,
}: PublishDialogProps) {
  const [plan, setPlan] = useState<PublishPlan | null>(null);
  const [message, setMessage] = useState(() => defaultCommitMessage(draft, Boolean(draft.publishedPath)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const missingCredentials = useMemo(() => {
    if (usesServerPublishing(config)) {
      return config?.authRequired && !settings.writePassword
        ? "This deployment needs the publish password before it will commit. Add it in Settings."
        : null;
    }
    return settings.githubToken
      ? null
      : "No GitHub token yet — add one in Settings, or deploy the worker with a GITHUB_TOKEN secret so the token stays off your browser.";
  }, [config, settings.githubToken, settings.writePassword]);

  const run = async () => {
    if (!plan) {
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
            disabled={!plan || busy || Boolean(missingCredentials)}
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
      {error ? <div className="notice warn">{error}</div> : null}

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
