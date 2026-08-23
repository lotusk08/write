import type { AppConfig } from "../../../shared/types.ts";
import type { Settings } from "../../lib/settings.ts";
import { Section } from "./Section.tsx";

export interface SettingsPanelProps {
  settings: Settings;
  config: AppConfig | null;
  onChange: (patch: Partial<Settings>) => void;
}

/**
 * Where the posts go, as the deployment has it. None of it is editable here
 * any more: the Worker commits with its own token, to its own repository, and
 * a different answer typed into this browser would only be a way to be wrong
 * about what just happened.
 */
function Blog({ config }: { config: AppConfig | null }) {
  if (!config) {
    return (
      <p className="hint">
        Could not reach this app's own API, so it does not know where it
        publishes. Reload; if that persists, the Worker is not answering.
      </p>
    );
  }

  return (
    <>
      {config.problem ? <div className="notice warn">{config.problem}</div> : null}
      <div className="field">
        <span className="field-label">Publishes to</span>
        <p className="hint mono">
          {config.repo || "—"} · {config.branch}
        </p>
      </div>
      <div className="field">
        <span className="field-label">Paths</span>
        <p className="hint mono">
          {config.postsDir} · {config.draftsDir} · {config.imagesDir}
        </p>
      </div>
    </>
  );
}

/**
 * The one thing this browser is trusted with. The token itself is on the
 * Worker; this only says it is you asking. Kept here so it is typed when a
 * device is set up and not once a post — clearing it is what makes the next
 * publish ask again.
 */
function Password({ settings, onChange }: SettingsPanelProps) {
  return (
    <div className="field">
      <label htmlFor="set-password">Password</label>
      <div className="row wide-first">
        <input
          id="set-password"
          className="input"
          type="password"
          autoComplete="current-password"
          placeholder={settings.publishPassword ? "••••••••" : "Asked for at the first publish"}
          value={settings.publishPassword}
          onChange={(event) => onChange({ publishPassword: event.target.value })}
        />
        {settings.publishPassword ? (
          <button
            type="button"
            className="btn tiny danger"
            onClick={() => onChange({ publishPassword: "" })}
          >
            Forget it
          </button>
        ) : null}
      </div>
      <p className="hint">
        Sent to this app's own Worker, which holds the GitHub token. Nothing here can reach the
        blog without it, and it is checked there rather than in this browser.
      </p>
    </div>
  );
}

export function SettingsPanel({ settings, config, onChange }: SettingsPanelProps) {
  return (
    <>
      <Section title="Blog">
        <Blog config={config} />
        <Password settings={settings} config={config} onChange={onChange} />
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
    </>
  );
}
