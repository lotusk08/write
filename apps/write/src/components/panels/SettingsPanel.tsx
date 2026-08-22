import type { AppConfig } from "../../../shared/types.ts";
import { usesServerPublishing } from "../../lib/api.ts";
import type { Settings } from "../../lib/settings.ts";

export interface SettingsPanelProps {
  settings: Settings;
  config: AppConfig | null;
  onChange: (patch: Partial<Settings>) => void;
}

export function SettingsPanel({ settings, config, onChange }: SettingsPanelProps) {
  const serverMode = usesServerPublishing(config);

  return (
    <>
      <p className="hint" style={{ marginBottom: 14 }}>
        {serverMode
          ? "This deployment publishes through its Cloudflare Worker, so no GitHub token is stored in your browser."
          : "No worker token found, so this browser talks to GitHub directly."}
      </p>
      {config?.warning ? <div className="notice warn">{config.warning}</div> : null}

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
          <label htmlFor="set-tz">UTC offset (minutes)</label>
          <input
            id="set-tz"
            className="input"
            type="number"
            step={30}
            value={settings.timezoneOffset}
            onChange={(event) => onChange({ timezoneOffset: Number(event.target.value) })}
          />
        </div>
      </div>

      {serverMode ? (
        <div className="field">
          <label htmlFor="set-password">Publish password</label>
          <input
            id="set-password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={settings.writePassword}
            onChange={(event) => onChange({ writePassword: event.target.value })}
          />
          <p className="hint">
            Matches the worker's WRITE_PASSWORD secret. Publishing to {config?.repo} on {config?.branch}.
          </p>
        </div>
      ) : (
        <>
          <div className="row">
            <div className="field">
              <label htmlFor="set-repo">Blog repository</label>
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
          <div className="field">
            <label htmlFor="set-token">GitHub token</label>
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
              Fine-grained token, Contents: Read &amp; write on the blog repo only. It is kept in this browser's
              local storage — deploy the worker with a GITHUB_TOKEN secret if you would rather it never be here.
            </p>
          </div>
        </>
      )}

      <div className="row">
        <div className="field">
          <label htmlFor="set-posts">Posts directory</label>
          <input
            id="set-posts"
            className="input"
            value={settings.postsDir}
            onChange={(event) => onChange({ postsDir: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="set-drafts">Drafts directory</label>
          <input
            id="set-drafts"
            className="input"
            value={settings.draftsDir}
            onChange={(event) => onChange({ draftsDir: event.target.value })}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="set-images">Images directory</label>
        <input
          id="set-images"
          className="input"
          value={settings.imagesDir}
          onChange={(event) => onChange({ imagesDir: event.target.value })}
        />
      </div>

      <div className="field">
        <span className="field-label">Images</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.convertImagesToWebp}
            onChange={(event) => onChange({ convertImagesToWebp: event.target.checked })}
          />
          Convert uploads to WebP before publishing
        </label>
      </div>

      <div className="field">
        <label htmlFor="set-theme">Theme</label>
        <select
          id="set-theme"
          className="select"
          value={settings.theme}
          onChange={(event) => onChange({ theme: event.target.value as Settings["theme"] })}
        >
          <option value="system">Follow system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      <div className="field">
        <span className="field-label">Editor</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.focusMode}
            onChange={(event) => onChange({ focusMode: event.target.checked })}
          />
          Focus mode — hide the bottom toolbar
        </label>
      </div>
    </>
  );
}
