import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { MenuTab } from "../lib/settings.ts";
import { Icon } from "./Icons.tsx";
import { PostPanel, type PostPanelProps } from "./panels/PostPanel.tsx";
import { SettingsPanel, type SettingsPanelProps } from "./panels/SettingsPanel.tsx";

export type ExportFormat = "markdown" | "docx" | "html" | "copy";

interface EditorPopoverProps {
  open: boolean;
  /** The menu button the pop-up hangs from. */
  anchorRef: RefObject<HTMLButtonElement | null>;
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
 * Front matter, settings and the publish actions, in a pop-up anchored to the
 * menu button in the toolbar. Drafts are not here — they live on the rail.
 */
export function EditorPopover({
  open,
  anchorRef,
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
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    setAnchor(open ? (anchorRef.current?.getBoundingClientRect() ?? null) : null);
  }, [open, anchorRef]);

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
    // The pop-up is placed once, so anything that moves the anchor closes it —
    // the toolbar it hangs from is sticky, and settles as the document ends.
    const onMove = () => onClose();
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, escapeCloses, onClose, anchorRef]);

  if (!open || !anchor) {
    return null;
  }

  const publishRepo = settings.config?.repo || settings.settings.repo;
  const publishDir = (
    settings.settings.publishTarget === "drafts"
      ? settings.settings.draftsDir
      : settings.settings.postsDir
  ).replace(/^\/+|\/+$/g, "");

  // Opens upward from the toolbar, and flips down when the anchor sits near
  // the top of the window (focus mode's floating button).
  const spaceAbove = anchor.top - 24;
  const placement =
    spaceAbove >= 320 || spaceAbove >= window.innerHeight - anchor.bottom - 24 ? "up" : "down";
  const position =
    placement === "up"
      ? { bottom: window.innerHeight - anchor.top + 8, maxHeight: Math.max(240, spaceAbove) }
      : {
          top: anchor.bottom + 8,
          maxHeight: Math.max(240, window.innerHeight - anchor.bottom - 24),
        };

  return createPortal(
    <div
      ref={panel}
      className="popover"
      role="dialog"
      aria-label="Editor menu"
      style={{ right: Math.max(12, window.innerWidth - anchor.right), ...position }}
    >
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
          {publishRepo} · <span className="mono">{publishDir}/</span>
        </p>
      </footer>
    </div>,
    document.body,
  );
}
