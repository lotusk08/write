import type { Draft } from "../lib/db.ts";
import { draftLabel } from "../lib/draft.ts";
import { relativeTime } from "../lib/text.ts";

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
        <div className="brand">
          write<span>.</span>
        </div>
        <button type="button" className="btn icon" title="New draft — ⌘⇧N" onClick={onNew}>
          ＋
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
            <div key={draft.id} style={{ position: "relative" }}>
              <button
                type="button"
                className="draft-item"
                aria-current={draft.id === currentId}
                onClick={() => onSelect(draft.id)}
              >
                <div className="draft-item-title">{draftLabel(draft)}</div>
                <div className="draft-item-meta">
                  {draft.publishedPath ? <span className="dot" title={`Published to ${draft.publishedPath}`} /> : null}
                  <span>{relativeTime(draft.updatedAt)}</span>
                </div>
              </button>
              {draft.id === currentId ? (
                <div style={{ display: "flex", gap: 4, padding: "2px 10px 8px" }}>
                  <button type="button" className="btn ghost" onClick={() => onDuplicate(draft.id)}>
                    Duplicate
                  </button>
                  <button type="button" className="btn ghost danger" onClick={() => onDelete(draft.id)}>
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
          Settings
        </button>
        <button
          type="button"
          className="btn ghost"
          title="Toggle theme"
          onClick={onToggleTheme}
          style={{ marginLeft: "auto" }}
        >
          {theme === "dark" ? "☾" : "☀"}
        </button>
      </div>
    </aside>
  );
}
