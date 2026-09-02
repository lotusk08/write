import { useState } from "react";
import { sessionPassword } from "../../lib/password.ts";
import { participantName } from "../../lib/share.ts";

export interface SharePanelProps {
  sharing: boolean;
  link: string | null;
  busy: boolean;
  error: string | null;
  onEnable: (password: string) => void;
  onDisable: (password: string) => void;
  onCopyLink: () => void;
}

export function SharePanel({ sharing, link, busy, error, onEnable, onDisable }: SharePanelProps) {
  const [password, setPassword] = useState("");
  const needsPassword = !sessionPassword();
  const supplied = () => sessionPassword() || password;

  return (
    <div className="share-panel">
      <ul className="switch-list">
        <li>
          <label className="switch">
            <input
              type="checkbox"
              checked={sharing}
              disabled={busy || (!sharing && needsPassword && !password)}
              onChange={() => (sharing ? onDisable(supplied()) : onEnable(supplied()))}
            />
            <span>
              Shared editing
              <em>Anyone with the link can open this draft and edit it live</em>
            </span>
          </label>
        </li>
      </ul>

      {!sharing && needsPassword ? (
        <div className="field">
          <span className="field-label">Publish password</span>
          <input
            className="input"
            type="password"
            value={password}
            autoComplete="current-password"
            placeholder="Needed before sharing can turn on"
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
      ) : null}

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
          ? `Everyone edits the same live copy while their tab is open — you appear as “${participantName()}”. Turning the switch off ends the link for all of them.`
          : "Turning this on sends the draft to your deployment and makes a link; the writing stays private until then."}
      </p>
    </div>
  );
}
