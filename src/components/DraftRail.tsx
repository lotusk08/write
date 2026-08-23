import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Draft } from "../lib/db.ts";
import { draftLabel } from "../lib/draft.ts";
import { Icon } from "./Icons.tsx";

interface DraftRailProps {
  drafts: Draft[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** Renames the open draft — the only one whose title is on show. */
  onRename: (title: string) => void;
  onDelete: (id: string) => void;
}

/**
 * Drafts live entirely on the rail: two decks of sheets with the open draft
 * between them. That one sheet renames in place on a double-click and carries
 * the delete button; the rest are one click away.
 */
export function DraftRail({
  drafts,
  currentId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: DraftRailProps) {
  const ordered = [...drafts].sort((a, b) => a.createdAt - b.createdAt);
  // Non-null only while the open title is being edited, so the tab can swap
  // its label for a field without a second flag.
  const [editing, setEditing] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const renaming = editing !== null;

  // Switching drafts abandons a rename rather than carrying it across.
  useEffect(() => setEditing(null), [currentId]);

  // Keyed off the flag, not the text: selecting on every keystroke would eat
  // each character as it was typed.
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

  // The open draft splits the rail in two, and each deck fans on its own:
  // reaching for the sheets above leaves the ones below stacked.
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
          // Earlier drafts paint over later ones, so each sheet tucks behind
          // the one above and leaves only its edge showing.
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
                // Sizes the field along its vertical run, so it grows with the
                // name the way the label it replaced did.
                size={Math.max(8, editing.length + 1)}
                aria-label="Draft title"
                autoFocus
                onChange={(event) => setEditing(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commit();
                  } else if (event.key === "Escape") {
                    // Kept off the document, where Escape closes the menu.
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
