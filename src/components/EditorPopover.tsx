import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { AppConfig } from "../../shared/types.ts";
import { resolvedTheme, type MenuTab, type Settings } from "../lib/settings.ts";
import { PHONE_QUERY, useMediaQuery } from "../lib/viewport.ts";
import { Icon } from "./Icons.tsx";
import { ExportPanel, type ExportFormat } from "./panels/ExportPanel.tsx";
import { PostPanel, type PostPanelProps } from "./panels/PostPanel.tsx";
import { SharePanel, type SharePanelProps } from "./panels/SharePanel.tsx";

export type { ExportFormat };

export interface MenuSettings {
  settings: Settings;
  config: AppConfig | null;
  onChange: (patch: Partial<Settings>) => void;
}

interface EditorPopoverProps {
  open: boolean;
  anchorRef: RefObject<HTMLButtonElement | null>;
  regionRef: RefObject<HTMLElement | null>;
  tab: MenuTab;
  onTab: (tab: MenuTab) => void;
  onClose: () => void;
  post: PostPanelProps;
  settings: MenuSettings;
  share: SharePanelProps;
  onPublish: () => void;
  onMindmap: () => void;
  onExport: (formats: ExportFormat[]) => void;
  exporting: boolean;
  escapeCloses?: boolean;
}

const TABS: { id: MenuTab; label: string }[] = [
  { id: "post", label: "Post" },
  { id: "export", label: "Export" },
  { id: "share", label: "Share" },
];

export function EditorPopover({
  open,
  anchorRef,
  regionRef,
  tab,
  onTab,
  onClose,
  post,
  settings,
  share,
  onPublish,
  onMindmap,
  onExport,
  exporting,
  escapeCloses = true,
}: EditorPopoverProps) {
  const panel = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<DOMRect | null>(null);
  const [chosen, setChosen] = useState<ExportFormat[]>([]);
  const sheet = useMediaQuery(PHONE_QUERY);

  useLayoutEffect(() => {
    const region = regionRef.current;
    if (!open || !region) {
      setFrame(null);
      return;
    }
    const measure = () => setFrame(region.getBoundingClientRect());
    measure();
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
        ) : tab === "share" ? (
          <SharePanel {...share} />
        ) : (
          <ExportPanel chosen={chosen} exporting={exporting} onChange={setChosen} />
        )}
      </div>

      <footer className="popover-foot">
        {tab === "export" ? (
          <>
            <div className="foot-row">
              <button
                type="button"
                className="btn primary block"
                disabled={exporting || chosen.length === 0}
                onClick={() => onExport(chosen)}
              >
                <Icon name="download" />
                {exporting ? "Exporting…" : "Export"}
              </button>
              <button
                type="button"
                className="btn icon"
                title="Copy the Markdown to the clipboard — ⌘⇧C"
                aria-label="Copy the Markdown to the clipboard"
                disabled={exporting}
                onClick={() => onExport(["copy"])}
              >
                <Icon name="copy" />
              </button>
              <button
                type="button"
                className="btn icon"
                title="Open in the mindmap — think.stevehoang.com"
                aria-label="Open in the mindmap"
                onClick={onMindmap}
              >
                <Icon name="mindmap" />
              </button>
            </div>
            <p className="hint publish-target">
              {chosen.length === 0 ? "Choose the format before download" : `${chosen.length} selected`}
            </p>
          </>
        ) : tab === "share" ? (
          <>
            <button
              type="button"
              className="btn primary block"
              disabled={!share.sharing || !share.link}
              onClick={share.onCopyLink}
            >
              <Icon name="copy" />
              Copy link
            </button>
            <p className="hint publish-target">
              {share.busy
                ? share.sharing
                  ? "Turning on…"
                  : "Turning off…"
                : share.sharing
                  ? "Live — everyone with the link edits this draft"
                  : "Not shared"}
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
