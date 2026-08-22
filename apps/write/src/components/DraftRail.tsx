import type { CSSProperties } from "react";
import type { Draft } from "../lib/db.ts";
import { draftLabel } from "../lib/draft.ts";
import { Icon } from "./Icons.tsx";

interface DraftRailProps {
  drafts: Draft[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

/**
 * Drafts as vertical tabs along the edge, so switching between them never
 * needs the menu. Only the open draft shows its title; the rest collapse into
 * a stack of layers behind it. Ordered by creation so tabs keep their place
 * while you type.
 */
export function DraftRail({ drafts, currentId, onSelect, onNew }: DraftRailProps) {
  const ordered = [...drafts].sort((a, b) => a.createdAt - b.createdAt);

  return (
    <nav className="rail" aria-label="Drafts">
      <button type="button" className="btn icon ghost" title="New draft — ⌘⇧N" aria-label="New draft" onClick={onNew}>
        <Icon name="plus" />
      </button>

      <div className="rail-tabs">
        {ordered.map((draft, index) => {
          const open = draft.id === currentId;
          return (
            <button
              key={draft.id}
              type="button"
              className={open ? "rail-tab is-open" : "rail-tab is-layer"}
              // Earlier drafts paint over later ones, so each sheet tucks
              // behind the one above and leaves only its edge showing.
              style={{ "--z": ordered.length - index } as CSSProperties}
              aria-current={open}
              title={draftLabel(draft)}
              onClick={() => onSelect(draft.id)}
            >
              <Icon name="file" size={13} />
              {open ? <span className="rail-tab-label">{draftLabel(draft)}</span> : null}
              {draft.publishedPath ? (
                <span className="dot" title={`Published to ${draft.publishedPath}`} />
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
