import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NOTE_TYPES, type NoteType } from "../editor/extensions/noteQuote.ts";
import { viewportBand } from "../lib/viewport.ts";
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

/** Gap between the menu and the button, and between the menu and the screen. */
const GAP = 6;
const EDGE = 8;

/** Quote styles that map onto the blog's `{: .note-* }` callouts. */
export function NoteMenu({ editor, active, note }: NoteMenuProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  /**
   * Puts the menu against its button, inside the part of the window that is on
   * screen. It opens upward — the toolbar is at the foot of the window — and
   * flips under the button when the keyboard has taken the room above it.
   *
   * It re-runs rather than closing when things move: the row this button sits
   * in scrolls, and on a phone tapping a half-visible tool scrolls it into
   * view, which would otherwise shut the menu on the way open.
   */
  const place = useCallback(() => {
    const element = menu.current;
    const anchor = button.current?.getBoundingClientRect();
    if (!element || !anchor) {
      return;
    }
    const band = viewportBand();
    // Measured from a corner it cannot be squeezed into, and never taller than
    // the band — with a keyboard out there is not much of one left.
    element.style.left = "0px";
    element.style.top = "0px";
    element.style.maxHeight = `${band.height - EDGE * 2}px`;
    const box = element.getBoundingClientRect();

    const above = anchor.top - GAP - box.height;
    const top =
      above >= band.top + EDGE
        ? above
        : Math.max(band.top + EDGE, Math.min(anchor.bottom + GAP, band.bottom - EDGE - box.height));
    // Left-hand edge wins when the menu is wider than what is left of the band.
    const left = Math.max(band.left + EDGE, Math.min(anchor.left - GAP, band.right - EDGE - box.width));
    element.style.top = `${Math.round(top)}px`;
    element.style.left = `${Math.round(left)}px`;
  }, []);

  useLayoutEffect(() => {
    if (open) {
      place();
    }
  }, [open, place]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Kept off the document, where Escape closes the editor menu.
        event.stopPropagation();
        close();
        button.current?.focus();
      }
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as globalThis.Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) {
        close();
      }
    };
    // One placement a frame: a scroll fires far more often than that.
    let frame = 0;
    const follow = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(place);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    window.visualViewport?.addEventListener("resize", follow);
    window.visualViewport?.addEventListener("scroll", follow);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
      window.visualViewport?.removeEventListener("resize", follow);
      window.visualViewport?.removeEventListener("scroll", follow);
    };
  }, [open, place]);

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

      {/* Portalled: the toolbar scrolls horizontally, which would clip it. */}
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
