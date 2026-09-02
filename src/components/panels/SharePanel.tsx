export interface SharePanelProps {
  sharing: boolean;
  link: string | null;
  busy: boolean;
  error: string | null;
  name: string;
  onName: (name: string) => void;
  onEnable: () => void;
  onDisable: () => void;
  onCopyLink: () => void;
}

export function SharePanel({ sharing, link, busy, error, name, onName, onEnable, onDisable }: SharePanelProps) {
  return (
    <div className="share-panel">
      <ul className="switch-list">
        <li>
          <label className="switch">
            <input
              type="checkbox"
              checked={sharing}
              disabled={busy}
              onChange={() => (sharing ? onDisable() : onEnable())}
            />
            <span>
              Shared editing
              <em>Anyone with the link can open this draft and edit it live</em>
            </span>
          </label>
        </li>
      </ul>

      <div className="field">
        <span className="field-label">Your name</span>
        <input
          className="input"
          value={name}
          maxLength={40}
          placeholder="How your caret is labelled to the others"
          onChange={(event) => onName(event.target.value)}
        />
      </div>

      {sharing && link ? (
        <div className="share-link">
          <input
            className="input mono"
            readOnly
            value={link}
            onFocus={(event) => event.target.select()}
          />
        </div>
      ) : null}

      {error ? (
        <p className="hint" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}

      <p className="hint">
        {sharing
          ? "Everyone edits the same live copy while their tab is open. Turning the switch off ends the link for all of them."
          : "No password here — the link itself is the key, and the publish password guards only the blog. The writing stays private until the switch goes on."}
      </p>
    </div>
  );
}
