import { participantName, type SharePeer } from "../../lib/share.ts";

export interface SharePanelProps {
  sharing: boolean;
  owner: boolean;
  link: string | null;
  busy: boolean;
  error: string | null;
  name: string;
  peers: SharePeer[];
  onName: (name: string) => void;
  onEnable: () => void;
  onDisable: () => void;
  onCopyLink: () => void;
}

export function SharePanel({
  sharing,
  owner,
  link,
  busy,
  error,
  name,
  peers,
  onName,
  onEnable,
  onDisable,
}: SharePanelProps) {
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
              <em>
                {owner
                  ? "Anyone with the link can open this draft and edit it live"
                  : "You joined this draft through its link — everyone edits the same live copy"}
              </em>
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
          onBlur={() => {
            if (!name.trim()) {
              onName(participantName());
            }
          }}
        />
      </div>

      {sharing && peers.length > 0 ? (
        <div className="field">
          <span className="field-label">Here now</span>
          <div className="peers">
            {peers.map((peer) => (
              <span key={peer.key} className="peer">
                <span className="peer-dot" style={{ background: peer.color }} />
                {peer.name}
                {peer.you ? " (you)" : ""}
              </span>
            ))}
          </div>
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
          ? owner
            ? "Everyone edits the same live copy while their tab is open. Turning the switch off ends the link for all of them."
            : "Everyone edits the same live copy while their tab is open. Turning the switch off just leaves — the share stays live for the others, and this copy stays yours."
          : "The writing stays private until the switch goes on."}
      </p>
    </div>
  );
}
