import type { Editor } from "@tiptap/react";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GALLERY_KINDS, GALLERY_LABELS, type GalleryKind } from "../editor/extensions/gallery.ts";
import { Icon } from "./Icons.tsx";
import { useFloatingMenu } from "./useFloatingMenu.ts";

interface GalleryMenuProps {
  editor: Editor;
  kind: GalleryKind | null;
  enabled: boolean;
}

export function GalleryMenu({ editor, kind, enabled }: GalleryMenuProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useFloatingMenu(open, close, button, menu);

  const pick = (chosen: GalleryKind) => {
    setOpen(false);
    editor.chain().focus().setGallery(chosen).run();
  };

  const separate = () => {
    setOpen(false);
    editor.chain().focus().unsetGallery().run();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={kind ? "tool is-active" : "tool"}
        title={kind ? `Gallery — ${GALLERY_LABELS[kind]}` : "Gallery — several photos in one frame"}
        aria-label="Gallery"
        aria-pressed={Boolean(kind)}
        aria-expanded={open}
        disabled={!enabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="gallery" />
      </button>

      {open
        ? createPortal(
            <div ref={menu} className="menu floating" role="menu">
              {GALLERY_KINDS.map((option) => (
                <button key={option} type="button" onClick={() => pick(option)}>
                  <span>{GALLERY_LABELS[option]}</span>
                  {kind === option ? <span className="check">✓</span> : null}
                </button>
              ))}
              {kind ? (
                <button type="button" onClick={separate}>
                  <span>Separate images</span>
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
