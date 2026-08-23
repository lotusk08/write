import type { Settings } from "../../lib/settings.ts";
import { Section } from "./Section.tsx";

export interface SettingsPanelProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
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
            Fine-grained, Contents: read and write on the blog repo. It is kept in this
            browser and sent to GitHub, nowhere else.
          </p>
        </div>
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
