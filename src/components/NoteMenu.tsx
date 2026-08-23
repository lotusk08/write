import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NOTE_TYPES, type NoteType } from "../editor/extensions/noteQuote.ts";
import { Icon } from "./Icons.tsx";

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
  // Not a callout: the blog's centred attribution under a pull quote.
  author: "Author",
};

/** Quote styles that map onto the blog's `{: .note-* }` callouts. */
export function NoteMenu({ editor, active, note }: NoteMenuProps) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!anchor) {
      return;
    }
    const close = () => setAnchor(null);
    const onDown = (event: MouseEvent) => {
      const target = event.target as globalThis.Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) {
        close();
      }
    };
    document.addEventListener("mousedown", onDown);
    // The menu is positioned once, so anything that moves the anchor closes it.
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [anchor]);

  const plainQuote = () => {
    setAnchor(null);
    if (note) {
      editor.chain().focus().updateAttributes("blockquote", { note: null }).run();
    } else {
      editor.chain().focus().toggleBlockquote().run();
    }
  };

  const pick = (type: NoteType) => {
    setAnchor(null);
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
        aria-expanded={anchor !== null}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() =>
          setAnchor((current) => (current ? null : (button.current?.getBoundingClientRect() ?? null)))
        }
      >
        <Icon name="quote" />
      </button>

      {/* Portalled: the toolbar scrolls horizontally, which would clip it. */}
      {anchor
        ? createPortal(
            <div
              ref={menu}
              className="menu floating"
              role="menu"
              style={{ left: anchor.left - 6, top: anchor.top - 8 }}
            >
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
