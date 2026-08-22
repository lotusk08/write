import { useEffect } from "react";
import type { MenuTab } from "../lib/settings.ts";
import { Icon } from "./Icons.tsx";
import { DraftsPanel, type DraftsPanelProps } from "./panels/DraftsPanel.tsx";
import { PostPanel, type PostPanelProps } from "./panels/PostPanel.tsx";
import { SettingsPanel, type SettingsPanelProps } from "./panels/SettingsPanel.tsx";

export type ExportFormat = "markdown" | "docx" | "html" | "copy";

interface EditorMenuProps {
  open: boolean;
  tab: MenuTab;
  onTab: (tab: MenuTab) => void;
  onClose: () => void;
  drafts: DraftsPanelProps;
  post: PostPanelProps;
  settings: SettingsPanelProps;
  onPublish: () => void;
  onExport: (format: ExportFormat) => void;
  exporting: boolean;
  /** False while a modal is open, so Escape closes the modal only. */
  escapeCloses?: boolean;
}

const TABS: { id: MenuTab; label: string }[] = [
  { id: "drafts", label: "Drafts" },
  { id: "post", label: "Post" },
  { id: "settings", label: "Settings" },
];

const TAB_HINTS: Record<MenuTab, string> = {
  drafts: "Everything kept in this browser",
  post: "Front matter for the open draft",
  settings: "Where and how posts are published",
};

const EXPORTS: { id: ExportFormat; label: string }[] = [
  { id: "markdown", label: "Markdown" },
  { id: "docx", label: "Word" },
  { id: "html", label: "HTML" },
  { id: "copy", label: "Copy" },
];

/**
 * Every non-writing control lives here: drafts, front matter, settings and the
 * publish/export actions. The editor itself stays free of chrome.
 */
export function EditorMenu({
  open,
  tab,
  onTab,
  onClose,
  drafts,
  post,
  settings,
  onPublish,
  onExport,
  exporting,
  escapeCloses = true,
}: EditorMenuProps) {
  useEffect(() => {
    if (!open || !escapeCloses) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, escapeCloses, onClose]);

  if (!open) {
    return null;
  }

  const publishRepo = settings.config?.repo || settings.settings.repo;
  const publishDir = (
    settings.settings.publishTarget === "drafts"
      ? settings.settings.draftsDir
      : settings.settings.postsDir
  ).replace(/^\/+|\/+$/g, "");

  return (
    <>
      <div className="drawer-scrim" role="presentation" onMouseDown={onClose} />
      <aside className="drawer" aria-label="Editor menu">
        <header className="drawer-head">
          <div className="brand">write</div>
          <button type="button" className="btn icon ghost" title="Close menu — ⌘\" aria-label="Close menu" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <div className="drawer-tabs" role="tablist">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={tab === id ? "drawer-tab is-active" : "drawer-tab"}
              aria-selected={tab === id}
              onClick={() => onTab(id)}
            >
              {label}
              {id === "drafts" ? <span className="count">{drafts.drafts.length}</span> : null}
            </button>
          ))}
        </div>

        <div className="drawer-body">
          <p className="drawer-lede">{TAB_HINTS[tab]}</p>
          {tab === "drafts" ? <DraftsPanel {...drafts} /> : null}
          {tab === "post" ? <PostPanel {...post} /> : null}
          {tab === "settings" ? <SettingsPanel {...settings} /> : null}
        </div>

        <footer className="drawer-foot">
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
      </aside>
    </>
  );
}
