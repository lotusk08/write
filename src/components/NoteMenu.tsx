import type { Editor } from "@tiptap/react";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NOTE_TYPES, type NoteType } from "../editor/extensions/noteQuote.ts";
import { Icon } from "./Icons.tsx";
import { useFloatingMenu } from "./useFloatingMenu.ts";

interface NoteMenuProps {
  editor: Editor;
  active: boolean;
  note: NoteType | null;
}

const LABELS: Record<NoteType, string> = {
  tip: "Tip",
  info: "Info",
  important: "Important",
  warning: "Warning",
  danger: "Danger",
  author: "Author",
};

export function NoteMenu({ editor, active, note }: NoteMenuProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useFloatingMenu(open, close, button, menu);

  const plainQuote = () => {
    setOpen(false);
    if (note) {
      editor.chain().focus().updateAttributes("blockquote", { note: null }).run();
    } else {
      editor.chain().focus().toggleBlockquote().run();
    }
  };

  const pick = (type: NoteType) => {
    setOpen(false);
    editor
      .chain()
      .focus()
      .setBlockquoteNote(note === type ? null : type)
      .run();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={active ? "tool is-active" : "tool"}
        title={note ? `Callout — ${LABELS[note]}` : "Quote and callouts"}
        aria-label="Quote and callouts"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="quote" />
      </button>

      {open
        ? createPortal(
            <div ref={menu} className="menu floating" role="menu">
              <button type="button" onClick={plainQuote}>
                <span>Quote</span>
                {active && !note ? <span className="check">✓</span> : null}
              </button>
              {NOTE_TYPES.map((type) => (
                <button key={type} type="button" onClick={() => pick(type)}>
                  <span className="swatch-label">
                    <span className="swatch" data-note={type} />
                    {LABELS[type]}
                  </span>
                  {note === type ? <span className="check">✓</span> : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
