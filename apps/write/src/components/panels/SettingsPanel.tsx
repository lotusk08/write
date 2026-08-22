import type { AppConfig } from "../../../shared/types.ts";
import { usesServerPublishing } from "../../lib/api.ts";
import type { Settings } from "../../lib/settings.ts";
import { Section } from "./Section.tsx";

export interface SettingsPanelProps {
  settings: Settings;
  config: AppConfig | null;
  onChange: (patch: Partial<Settings>) => void;
}

export function SettingsPanel({ settings, config, onChange }: SettingsPanelProps) {
  const serverMode = usesServerPublishing(config);

  return (
    <>
      <div className={serverMode ? "notice ok" : "notice"}>
        {serverMode
          ? `Publishing runs through this deployment's Cloudflare Worker, so the GitHub token never reaches your browser. Target: ${config?.repo} on ${config?.branch}.`
          : "No worker token found, so this browser talks to GitHub directly with the token below."}
      </div>
      {config?.warning ? <div className="notice warn">{config.warning}</div> : null}

      <Section title="Blog">
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
            <p className="hint">Matches the worker's WRITE_PASSWORD secret.</p>
          </div>
        ) : (
          <>
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
                Fine-grained, Contents: Read &amp; write on the blog repo only. Kept in this browser's local
                storage — deploy the worker with a GITHUB_TOKEN secret if you would rather it never be here.
              </p>
            </div>
          </>
        )}
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

      <Section title="Editor">
        <ul className="switch-list">
          <li>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.convertImagesToWebp}
                onChange={(event) => onChange({ convertImagesToWebp: event.target.checked })}
              />
              <span>
                Convert images to WebP
                <em>The blog only generates placeholders and sizes for .webp files</em>
              </span>
            </label>
          </li>
          <li>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.focusMode}
                onChange={(event) => onChange({ focusMode: event.target.checked })}
              />
              <span>
                Focus mode
                <em>Hides the toolbar and the draft rail</em>
              </span>
            </label>
          </li>
        </ul>
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
      </Section>
    </>
  );
}
