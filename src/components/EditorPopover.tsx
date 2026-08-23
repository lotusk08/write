import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { AppConfig } from "../../shared/types.ts";
import { resolvedTheme, type MenuTab, type Settings } from "../lib/settings.ts";
import { PHONE_QUERY, useMediaQuery } from "../lib/viewport.ts";
import { Icon } from "./Icons.tsx";
import { ExportPanel, type ExportFormat } from "./panels/ExportPanel.tsx";
import { PostPanel, type PostPanelProps } from "./panels/PostPanel.tsx";

export type { ExportFormat };

/** The theme and focus toggles live in the head, so this is needed either tab. */
export interface MenuSettings {
  settings: Settings;
  config: AppConfig | null;
  onChange: (patch: Partial<Settings>) => void;
}

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
  settings: MenuSettings;
  onPublish: () => void;
  /** Runs every ticked format, in the order they are listed. */
  onExport: (formats: ExportFormat[]) => void;
  exporting: boolean;
  /** False while a modal is open, so Escape closes the modal only. */
  escapeCloses?: boolean;
}

const TABS: { id: MenuTab; label: string }[] = [
  { id: "post", label: "Post" },
  { id: "export", label: "Export" },
];

/**
 * Front matter, the ways out of the editor, and the publish action, in a pop-up
 * docked to the right of the writing surface. Drafts are not here — they live
 * on the rail.
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
  // Ticks live as long as the menu does. They are a choice about this trip to
  // the menu, not a preference worth keeping.
  const [chosen, setChosen] = useState<ExportFormat[]>([]);
  // A phone has no room beside the writing surface, so the pop-up becomes a
  // sheet across the foot of it instead of a panel docked to one corner.
  const sheet = useMediaQuery(PHONE_QUERY);

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
    // The observer catches the rail and focus mode; the window covers the
    // rest, and the visual viewport the keyboard sliding the page around.
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
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
    const onDown = (event: PointerEvent) => {
      const target = event.target as globalThis.Node;
      // The anchor is excluded so its own click toggles rather than reopening.
      if (panel.current?.contains(target) || anchorRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, escapeCloses, onClose, anchorRef]);

  if (!open || !frame) {
    return null;
  }

  const scheme = resolvedTheme(settings.settings.theme);
  const publishDir = (
    settings.settings.publishTarget === "drafts"
      ? settings.settings.draftsDir
      : settings.settings.postsDir
  ).replace(/^\/+|\/+$/g, "");

  // Inset from the writing surface: down its right-hand edge, or across its
  // foot on a phone. The surface is pinned to the part of the window the
  // keyboard leaves on screen, so both stay above it.
  const inset = sheet ? 10 : 16;
  const position = sheet
    ? {
        left: frame.left + inset,
        right: window.innerWidth - frame.right + inset,
        bottom: window.innerHeight - frame.bottom + inset,
        maxHeight: Math.max(200, frame.height - inset * 2),
      }
    : {
        top: frame.top + inset,
        right: window.innerWidth - frame.right + inset,
        maxHeight: Math.max(240, frame.height - inset * 2),
      };

  return createPortal(
    <div
      ref={panel}
      className={sheet ? "popover is-sheet" : "popover"}
      role="dialog"
      aria-label="Editor menu"
      style={position}
    >
      <header className="popover-head">
        <button
          type="button"
          className="btn icon ghost"
          title={scheme === "dark" ? "Switch to light" : "Switch to dark"}
          aria-label={scheme === "dark" ? "Switch to light" : "Switch to dark"}
          onClick={() => settings.onChange({ theme: scheme === "dark" ? "light" : "dark" })}
        >
          <Icon name={scheme === "dark" ? "sun" : "moon"} />
        </button>
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
          className={settings.settings.focusMode ? "btn icon ghost is-active" : "btn icon ghost"}
          title="Focus mode — hides the toolbar and the draft rail"
          aria-label="Focus mode"
          aria-pressed={settings.settings.focusMode}
          onClick={() => settings.onChange({ focusMode: !settings.settings.focusMode })}
        >
          <Icon name="focus" />
        </button>
      </header>

      <div className="popover-body">
        {tab === "post" ? (
          <PostPanel {...post} />
        ) : (
          <ExportPanel chosen={chosen} exporting={exporting} onChange={setChosen} />
        )}
      </div>

      <footer className="popover-foot">
        {tab === "export" ? (
          <>
            <button
              type="button"
              className="btn primary block"
              disabled={exporting || chosen.length === 0}
              onClick={() => onExport(chosen)}
            >
              <Icon name="download" />
              {exporting ? "Exporting…" : "Export"}
            </button>
            <p className="hint publish-target">
              {chosen.length === 0 ? "Choose the format before download" : `${chosen.length} selected`}
            </p>
          </>
        ) : (
          <>
            <button type="button" className="btn primary block" onClick={onPublish}>
              <Icon name="upload" />
              Publish
            </button>
            <p className="hint publish-target">
              <span className="mono">{publishDir}/</span>
            </p>
          </>
        )}
      </footer>
    </div>,
    document.body,
  );
}
