import type { CSSProperties } from "react";
import type { Draft } from "../lib/db.ts";
import { draftLabel } from "../lib/draft.ts";
import { relativeTime } from "../lib/text.ts";
import { Icon } from "./Icons.tsx";

interface DraftRailProps {
  drafts: Draft[];
  currentId: string | null;
  query: string;
  onQuery: (value: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * Drafts live entirely on the rail. At rest it is a deck of sheets with only
 * the open draft named; hovering it — or focusing anything inside it — slides
 * out the full list with search and per-draft actions.
 */
export function DraftRail({
  drafts,
  currentId,
  query,
  onQuery,
  onSelect,
  onNew,
  onDuplicate,
  onDelete,
}: DraftRailProps) {
  const ordered = [...drafts].sort((a, b) => a.createdAt - b.createdAt);
  const needle = query.trim().toLowerCase();
  const listed = needle
    ? drafts.filter((draft) =>
        `${draftLabel(draft)} ${draft.meta.tags.join(" ")} ${draft.meta.categories.join(" ")}`
          .toLowerCase()
          .includes(needle),
      )
    : drafts;

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

      <div className="rail-panel">
        <header className="rail-panel-head">
          <h2>
            Drafts <span className="count">{drafts.length}</span>
          </h2>
          <button type="button" className="btn icon ghost" title="New draft" aria-label="New draft" onClick={onNew}>
            <Icon name="plus" />
          </button>
        </header>

        <input
          className="input"
          type="search"
          placeholder="Search drafts"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />

        <div className="rail-panel-list">
          {listed.length === 0 ? (
            <p className="empty">No drafts match.</p>
          ) : (
            listed.map((draft) => (
              <div key={draft.id} className="draft-row">
                <button
                  type="button"
                  className="draft-item"
                  aria-current={draft.id === currentId}
                  onClick={() => onSelect(draft.id)}
                >
                  <span className="draft-item-title">{draftLabel(draft)}</span>
                  <span className="draft-item-meta">
                    {draft.publishedPath ? (
                      <span className="dot" title={`Published to ${draft.publishedPath}`} />
                    ) : null}
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
            ))
          )}
        </div>
      </div>
    </nav>
  );
}
