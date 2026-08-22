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
 * needs the menu. Ordered by creation so tabs keep their place while you type.
 */
export function DraftRail({ drafts, currentId, onSelect, onNew }: DraftRailProps) {
  return (
    <nav className="rail" aria-label="Drafts">
      <button type="button" className="btn icon ghost" title="New draft — ⌘⇧N" aria-label="New draft" onClick={onNew}>
        <Icon name="plus" />
      </button>

      <div className="rail-tabs">
        {[...drafts]
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((draft) => (
            <button
              key={draft.id}
              type="button"
              className="rail-tab"
              aria-current={draft.id === currentId}
              title={draftLabel(draft)}
              onClick={() => onSelect(draft.id)}
            >
              <Icon name="file" size={13} />
              <span className="rail-tab-label">{draftLabel(draft)}</span>
              {draft.publishedPath ? <span className="dot" title={`Published to ${draft.publishedPath}`} /> : null}
            </button>
          ))}
      </div>
    </nav>
  );
}
