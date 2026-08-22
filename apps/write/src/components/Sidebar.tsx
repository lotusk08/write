import type { Draft } from "../lib/db.ts";
import { draftLabel } from "../lib/draft.ts";
import { relativeTime } from "../lib/text.ts";
import { Icon } from "./Icons.tsx";

interface SidebarProps {
  drafts: Draft[];
  currentId: string | null;
  query: string;
  onQuery: (value: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  theme: string;
}

export function Sidebar({
  drafts,
  currentId,
  query,
  onQuery,
  onSelect,
  onNew,
  onDuplicate,
  onDelete,
  onOpenSettings,
  onToggleTheme,
  theme,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">write</div>
        <button type="button" className="btn icon ghost" title="New draft — ⌘⇧N" aria-label="New draft" onClick={onNew}>
          <Icon name="plus" />
        </button>
      </div>

      <div className="sidebar-search">
        <input
          className="input"
          type="search"
          placeholder="Search drafts"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>

      <div className="sidebar-list">
        {drafts.length === 0 ? (
          <p className="empty">No drafts yet.</p>
        ) : (
          drafts.map((draft) => (
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
              {draft.id === currentId ? (
                <div className="draft-actions">
                  <button type="button" className="btn ghost tiny" onClick={() => onDuplicate(draft.id)}>
                    Duplicate
                  </button>
                  <button type="button" className="btn ghost tiny danger" onClick={() => onDelete(draft.id)}>
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="sidebar-foot">
        <button type="button" className="btn ghost" onClick={onOpenSettings}>
          <Icon name="settings" />
          Settings
        </button>
        <button
          type="button"
          className="btn icon ghost"
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label="Toggle theme"
          onClick={onToggleTheme}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
      </div>
    </aside>
  );
}
