import type { Draft } from "../../lib/db.ts";
import { draftLabel } from "../../lib/draft.ts";
import { relativeTime } from "../../lib/text.ts";
import { Icon } from "../Icons.tsx";

export interface DraftsPanelProps {
  drafts: Draft[];
  currentId: string | null;
  query: string;
  onQuery: (value: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

export function DraftsPanel({
  drafts,
  currentId,
  query,
  onQuery,
  onSelect,
  onNew,
  onDuplicate,
  onDelete,
}: DraftsPanelProps) {
  return (
    <>
      <div className="panel-toolbar">
        <input
          className="input"
          type="search"
          placeholder="Search drafts"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
        <button type="button" className="btn icon" title="New draft — ⌘⇧N" aria-label="New draft" onClick={onNew}>
          <Icon name="plus" />
        </button>
      </div>

      {drafts.length === 0 ? (
        <p className="empty">No drafts match.</p>
      ) : (
        <div className="draft-list">
          {drafts.map((draft) => (
            <div key={draft.id} className="draft-row">
              <button
                type="button"
                className="draft-item"
                aria-current={draft.id === currentId}
                onClick={() => onSelect(draft.id)}
              >
                <span className="draft-item-title">{draftLabel(draft)}</span>
                <span className="draft-item-meta">
                  {draft.publishedPath ? <span className="dot" title={`Published to ${draft.publishedPath}`} /> : null}
                  {relativeTime(draft.updatedAt)}
                </span>
              </button>
              <div className="draft-row-actions">
                <button
                  type="button"
                  className="tool"
                  title="Duplicate"
                  aria-label={`Duplicate ${draftLabel(draft)}`}
                  onClick={() => onDuplicate(draft.id)}
                >
                  <Icon name="copy" size={14} />
                </button>
                <button
                  type="button"
                  className="tool danger"
                  title="Delete"
                  aria-label={`Delete ${draftLabel(draft)}`}
                  onClick={() => onDelete(draft.id)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
