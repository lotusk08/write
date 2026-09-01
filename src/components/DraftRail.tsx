import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Draft } from "../lib/db.ts";
import { draftLabel } from "../lib/draft.ts";
import { Icon } from "./Icons.tsx";

interface DraftRailProps {
  drafts: Draft[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (title: string) => void;
  onDelete: (id: string) => void;
}

export function DraftRail({
  drafts,
  currentId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: DraftRailProps) {
  const ordered = [...drafts].sort((a, b) => a.createdAt - b.createdAt);
  const [editing, setEditing] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const renaming = editing !== null;

  useEffect(() => setEditing(null), [currentId]);

  useEffect(() => {
    if (renaming) {
      field.current?.select();
    }
  }, [renaming]);

  const commit = () => {
    if (editing !== null) {
      onRename(editing.trim());
      setEditing(null);
    }
  };

  const open = ordered.findIndex((draft) => draft.id === currentId);
  const openDraft = open === -1 ? null : ordered[open];
  const label = openDraft ? draftLabel(openDraft) : "";

  const deck = (sheets: Draft[]) => (
    <div className="rail-deck">
      {sheets.map((draft) => (
        <button
          key={draft.id}
          type="button"
          className="rail-tab is-layer"
          style={{ "--z": ordered.length - ordered.indexOf(draft) } as CSSProperties}
          title={draftLabel(draft)}
          onClick={() => onSelect(draft.id)}
        >
          <Icon name="file" size={13} />
          {draft.publishedPath ? (
            <span className="dot" title={`Published to ${draft.publishedPath}`} />
          ) : null}
        </button>
      ))}
    </div>
  );

  return (
    <nav className="rail" aria-label="Drafts">
      <button
        type="button"
        className="btn icon ghost"
        title="New draft — ⌘⇧N"
        aria-label="New draft"
        onClick={onNew}
      >
        <Icon name="plus" />
      </button>

      <div className="rail-tabs">
        {deck(open === -1 ? ordered : ordered.slice(0, open))}

        {openDraft ? (
          <div className="rail-tab is-open" aria-current="true">
            <Icon name="file" size={13} />
            {editing === null ? (
              <span
                className="rail-tab-label"
                title={`${label} — double-click to rename`}
                onDoubleClick={() => setEditing(label)}
              >
                {label}
              </span>
            ) : (
              <input
                ref={field}
                className="rail-tab-label rail-tab-field"
                value={editing}
                size={Math.max(8, editing.length + 1)}
                aria-label="Draft title"
                autoFocus
                onChange={(event) => setEditing(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commit();
                  } else if (event.key === "Escape") {
                    event.stopPropagation();
                    setEditing(null);
                  }
                }}
              />
            )}
            {openDraft.publishedPath ? (
              <span className="dot" title={`Published to ${openDraft.publishedPath}`} />
            ) : null}
            <button
              type="button"
              className="rail-tab-delete"
              title="Delete draft"
              aria-label={`Delete ${label}`}
              onClick={() => onDelete(openDraft.id)}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        ) : null}

        {deck(open === -1 ? [] : ordered.slice(open + 1))}
      </div>
    </nav>
  );
}
