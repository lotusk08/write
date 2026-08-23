import type { AppConfig } from "../../../shared/types.ts";
import { usesServerPublishing } from "../../lib/api.ts";
import type { Settings } from "../../lib/settings.ts";
import { Icon, type IconName } from "../Icons.tsx";
import { Section } from "./Section.tsx";

/** One button cycles these in order, rather than a menu of three. */
const THEMES: { value: Settings["theme"]; label: string; icon: IconName }[] = [
  { value: "system", label: "Follow system", icon: "auto" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];

export interface SettingsPanelProps {
  settings: Settings;
  config: AppConfig | null;
  onChange: (patch: Partial<Settings>) => void;
}

export function SettingsPanel({ settings, config, onChange }: SettingsPanelProps) {
  const serverMode = usesServerPublishing(config);

  const theme = Math.max(0, THEMES.findIndex((option) => option.value === settings.theme));
  const nextTheme = THEMES[(theme + 1) % THEMES.length];

  return (
    <>
      {config?.warning ? <div className="notice warn">{config.warning}</div> : null}

      {serverMode ? null : (
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
              Only needed because this copy has no worker to publish for it — deploy one with a
              GITHUB_TOKEN secret and this field disappears.
            </p>
          </div>
        </Section>
      )}

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

      {serverMode ? null : (
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
      )}

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
          <span className="field-label">Theme</span>
          <button
            type="button"
            className="btn theme-toggle"
            title={`${THEMES[theme].label} — click for ${nextTheme.label.toLowerCase()}`}
            onClick={() => onChange({ theme: nextTheme.value })}
          >
            <Icon name={THEMES[theme].icon} />
            {THEMES[theme].label}
          </button>
        </div>
      </Section>
    </>
  );
}
