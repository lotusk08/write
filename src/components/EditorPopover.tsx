import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { MenuTab } from "../lib/settings.ts";
import { Icon } from "./Icons.tsx";
import { PostPanel, type PostPanelProps } from "./panels/PostPanel.tsx";
import { SettingsPanel, type SettingsPanelProps } from "./panels/SettingsPanel.tsx";

export type ExportFormat = "markdown" | "docx" | "html" | "copy";

interface EditorPopoverProps {
  open: boolean;
  /** The menu button — excluded from the outside-click close. */
  anchorRef: RefObject<HTMLButtonElement | null>;
  /** The writing surface the pop-up docks to the right of. */
  regionRef: RefObject<HTMLElement | null>;
  tab: MenuTab;
  onTab: (tab: MenuTab) => void;
  onClose: () => void;
  post: PostPanelProps;
  settings: SettingsPanelProps;
  onPublish: () => void;
  onExport: (format: ExportFormat) => void;
  exporting: boolean;
  /** False while a modal is open, so Escape closes the modal only. */
  escapeCloses?: boolean;
}

const TABS: { id: MenuTab; label: string }[] = [
  { id: "post", label: "Post" },
  { id: "settings", label: "Settings" },
];

const EXPORTS: { id: ExportFormat; label: string }[] = [
  { id: "markdown", label: "Markdown" },
  { id: "docx", label: "Word" },
  { id: "html", label: "HTML" },
  { id: "copy", label: "Copy" },
];

/**
 * Front matter, settings and the publish actions, in a pop-up docked to the
 * right of the writing surface. Drafts are not here — they live on the rail.
 */
export function EditorPopover({
  open,
  anchorRef,
  regionRef,
  tab,
  onTab,
  onClose,
  post,
  settings,
  onPublish,
  onExport,
  exporting,
  escapeCloses = true,
}: EditorPopoverProps) {
  const panel = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<DOMRect | null>(null);

  // Measured from the editor region, not the button: the pop-up hangs off the
  // region's right edge, so it holds still while the document scrolls under it
  // and only has to be re-measured when that region changes size.
  useLayoutEffect(() => {
    const region = regionRef.current;
    if (!open || !region) {
      setFrame(null);
      return;
    }
    const measure = () => setFrame(region.getBoundingClientRect());
    measure();
    // The observer catches the rail and focus mode; the window covers the rest.
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, regionRef]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && escapeCloses) {
        onClose();
      }
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as globalThis.Node;
      // The anchor is excluded so its own click toggles rather than reopening.
      if (panel.current?.contains(target) || anchorRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, escapeCloses, onClose, anchorRef]);

  if (!open || !frame) {
    return null;
  }

  const publishDir = (
    settings.settings.publishTarget === "drafts"
      ? settings.settings.draftsDir
      : settings.settings.postsDir
  ).replace(/^\/+|\/+$/g, "");

  // Inset from the top-right corner of the writing surface, tall enough to run
  // its length — past that the body takes the scroll.
  const inset = 16;
  const position = {
    top: frame.top + inset,
    right: window.innerWidth - frame.right + inset,
    maxHeight: Math.max(240, frame.height - inset * 2),
  };

  return createPortal(
    <div ref={panel} className="popover" role="dialog" aria-label="Editor menu" style={position}>
      <header className="popover-head">
        <div className="popover-tabs" role="tablist">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={tab === id ? "popover-tab is-active" : "popover-tab"}
              aria-selected={tab === id}
              onClick={() => onTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn icon ghost"
          title="Close — Esc"
          aria-label="Close menu"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>

      <div className="popover-body">
        {tab === "post" ? <PostPanel {...post} /> : <SettingsPanel {...settings} />}
      </div>

      <footer className="popover-foot">
        <div className="export-row">
          <span className="field-label">Download</span>
          <div className="segmented">
            {EXPORTS.map(({ id, label }) => (
              <button key={id} type="button" disabled={exporting} onClick={() => onExport(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="btn primary block" onClick={onPublish}>
          <Icon name="upload" />
          Publish to blog
        </button>
        <p className="hint publish-target">
          <span className="mono">{publishDir}/</span>
        </p>
      </footer>
    </div>,
    document.body,
  );
}
