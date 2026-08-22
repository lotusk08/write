import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppConfig, PostMeta, PublishResult } from "../shared/types.ts";
import { ExportMenu } from "./components/ExportMenu.tsx";
import { Icon } from "./components/Icons.tsx";
import { MetaPanel } from "./components/MetaPanel.tsx";
import { PublishDialog } from "./components/PublishDialog.tsx";
import { SettingsDialog } from "./components/SettingsDialog.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { Toolbar } from "./components/Toolbar.tsx";
import { editorExtensions } from "./editor/extensions.ts";
import { fetchAppConfig } from "./lib/api.ts";
import { draftStore, type Draft } from "./lib/db.ts";
import { createDraft, draftLabel, sortDrafts } from "./lib/draft.ts";
import { downloadBlob, downloadText } from "./lib/download.ts";
import { buildHtmlDocument } from "./lib/html.ts";
import { docToPlainText } from "./lib/markdown.ts";
import { draftSlug, markdownForExport, type PublishPlan } from "./lib/publish.ts";
import { loadSettings, saveSettings, type Settings } from "./lib/settings.ts";
import { countWords, datePrefix, slugify } from "./lib/text.ts";

type SaveState = "idle" | "saving" | "saved";
type Toast = { message: string; kind: "info" | "error"; href?: string } | null;

const SAVE_DEBOUNCE_MS = 600;

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [dialog, setDialog] = useState<null | "publish" | "settings">(null);
  const [toast, setToast] = useState<Toast>(null);
  const [exporting, setExporting] = useState(false);
  const [ready, setReady] = useState(false);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");

  const draftsRef = useRef<Draft[]>([]);
  const currentIdRef = useRef<string | null>(null);
  const pendingRef = useRef<Partial<Draft>>({});
  const timerRef = useRef<number | undefined>(undefined);

  draftsRef.current = drafts;
  currentIdRef.current = currentId;

  const current = useMemo(
    () => drafts.find((draft) => draft.id === currentId) ?? null,
    [drafts, currentId],
  );

  /* ----------------------------------------------------------- persistence */

  const flush = useCallback(async () => {
    const id = currentIdRef.current;
    const patch = pendingRef.current;
    pendingRef.current = {};
    if (!id || Object.keys(patch).length === 0) {
      return;
    }
    const base = draftsRef.current.find((draft) => draft.id === id);
    if (!base) {
      return;
    }
    const next: Draft = { ...base, ...patch, updatedAt: Date.now() };
    await draftStore.put(next);
    setDrafts((previous) => sortDrafts(previous.map((draft) => (draft.id === id ? next : draft))));
    setSaveState("saved");
  }, []);

  const queueSave = useCallback(
    (patch: Partial<Draft>) => {
      pendingRef.current = { ...pendingRef.current, ...patch };
      setSaveState("saving");
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  /* ---------------------------------------------------------------- editor */

  const editor = useEditor({
    extensions: editorExtensions,
    content: { type: "doc", content: [{ type: "paragraph" }] },
    autofocus: false,
    onUpdate: ({ editor: instance }) => queueSave({ doc: instance.getJSON() }),
  });

  useEffect(() => {
    if (!editor || !currentId) {
      return;
    }
    const draft = draftsRef.current.find((item) => item.id === currentId);
    if (draft) {
      editor.commands.setContent(draft.doc, { emitUpdate: false });
    }
    // Only re-run when the open draft changes, never on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, currentId]);

  /* ------------------------------------------------------------ first load */

  useEffect(() => {
    void (async () => {
      const [stored, remote] = await Promise.all([draftStore.all(), fetchAppConfig()]);
      setConfig(remote);
      if (remote) {
        // The worker is authoritative about where posts go.
        updateSettings({
          repo: remote.repo || undefined,
          branch: remote.branch || undefined,
          postsDir: remote.postsDir,
          draftsDir: remote.draftsDir,
          imagesDir: remote.imagesDir,
        } as Partial<Settings>);
      }

      const sorted = sortDrafts(stored);
      if (sorted.length === 0) {
        const draft = createDraft(loadSettings());
        await draftStore.put(draft);
        setDrafts([draft]);
        setCurrentId(draft.id);
      } else {
        setDrafts(sorted);
        setCurrentId(sorted[0].id);
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----------------------------------------------------------------- theme */

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = settings.theme === "dark" || (settings.theme === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      setResolvedTheme(dark ? "dark" : "light");
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const id = window.setTimeout(() => setToast(null), 7000);
    return () => window.clearTimeout(id);
  }, [toast]);

  /* -------------------------------------------------------------- commands */

  const newDraft = useCallback(async () => {
    await flush();
    const draft = createDraft(settings);
    await draftStore.put(draft);
    setDrafts((previous) => sortDrafts([draft, ...previous]));
    setCurrentId(draft.id);
    window.setTimeout(() => document.querySelector<HTMLInputElement>(".title-input")?.focus(), 40);
  }, [flush, settings]);

  const selectDraft = useCallback(
    async (id: string) => {
      await flush();
      setCurrentId(id);
    },
    [flush],
  );

  const duplicateDraft = useCallback(
    async (id: string) => {
      const source = draftsRef.current.find((draft) => draft.id === id);
      if (!source) {
        return;
      }
      const copy: Draft = {
        ...structuredClone(source),
        id: crypto.randomUUID(),
        title: `${draftLabel(source)} (copy)`,
        meta: { ...source.meta, title: `${draftLabel(source)} (copy)` },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        publishedPath: undefined,
        publishedAt: undefined,
      };
      await draftStore.put(copy);
      setDrafts((previous) => sortDrafts([copy, ...previous]));
      setCurrentId(copy.id);
    },
    [],
  );

  const deleteDraft = useCallback(
    async (id: string) => {
      const draft = draftsRef.current.find((item) => item.id === id);
      if (!draft || !window.confirm(`Delete "${draftLabel(draft)}"? This cannot be undone.`)) {
        return;
      }
      pendingRef.current = {};
      await draftStore.remove(id);
      const remaining = draftsRef.current.filter((item) => item.id !== id);
      setDrafts(remaining);
      if (remaining.length === 0) {
        const replacement = createDraft(settings);
        await draftStore.put(replacement);
        setDrafts([replacement]);
        setCurrentId(replacement.id);
      } else {
        setCurrentId(remaining[0].id);
      }
    },
    [settings],
  );

  const updateMeta = useCallback(
    (patch: Partial<PostMeta>) => {
      const draft = draftsRef.current.find((item) => item.id === currentIdRef.current);
      if (!draft) {
        return;
      }
      const meta = { ...draft.meta, ...pendingRef.current.meta, ...patch };
      const next: Partial<Draft> = { meta };
      if (patch.title !== undefined) {
        next.title = patch.title;
        // Keep the slug following the title until it is edited by hand.
        if (!draft.slug || draft.slug === slugify(draft.meta.title)) {
          next.slug = slugify(patch.title);
        }
      }
      queueSave(next);
      setDrafts((previous) =>
        previous.map((item) => (item.id === draft.id ? { ...item, ...next } : item)),
      );
    },
    [queueSave],
  );

  const setSlug = useCallback(
    (slug: string) => {
      queueSave({ slug: slugify(slug) });
      setDrafts((previous) =>
        previous.map((item) => (item.id === currentIdRef.current ? { ...item, slug: slugify(slug) } : item)),
      );
    },
    [queueSave],
  );

  const exportAs = useCallback(
    async (format: "markdown" | "docx" | "html" | "copy") => {
      if (!current || !editor) {
        return;
      }
      setExporting(true);
      try {
        await flush();
        const draft = draftsRef.current.find((item) => item.id === current.id) ?? current;
        const slug = draftSlug(draft);

        if (format === "markdown" || format === "copy") {
          const markdown = await markdownForExport(draft, settings);
          if (format === "copy") {
            await navigator.clipboard.writeText(markdown);
            setToast({ message: "Markdown copied to clipboard.", kind: "info" });
          } else {
            downloadText(markdown, `${datePrefix(draft.meta.date)}-${slug}.md`, "text/markdown");
          }
        } else if (format === "docx") {
          const { docToDocxBlob } = await import("./lib/docx.ts");
          downloadBlob(await docToDocxBlob(draft.doc, draft.meta), `${slug}.docx`);
        } else {
          const html = await buildHtmlDocument(editor.getHTML(), draft.meta);
          downloadText(html, `${slug}.html`, "text/html");
        }
      } catch (error) {
        setToast({
          message: error instanceof Error ? error.message : "Export failed.",
          kind: "error",
        });
      } finally {
        setExporting(false);
      }
    },
    [current, editor, flush, settings],
  );

  const onPublished = useCallback(
    (result: PublishResult, plan: PublishPlan) => {
      setDialog(null);
      queueSave({ publishedPath: plan.markdownPath, publishedAt: Date.now() });
      void flush();
      setToast({
        message: result.pullRequestUrl
          ? `Pull request opened for ${plan.markdownPath}`
          : `Committed ${plan.markdownPath} to ${result.branch}`,
        kind: "info",
        href: result.pullRequestUrl ?? result.commitUrl,
      });
    },
    [flush, queueSave],
  );

  /* ------------------------------------------------------------- shortcuts */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) {
        return;
      }
      if (event.key === "s") {
        event.preventDefault();
        void flush().then(() => setToast({ message: "Saved.", kind: "info" }));
      } else if (event.key === "\\") {
        event.preventDefault();
        updateSettings({ sidebarOpen: !settings.sidebarOpen });
      } else if (event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void newDraft();
      } else if (event.shiftKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void exportAs("copy");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [exportAs, flush, newDraft, settings.sidebarOpen, updateSettings]);

  /* ---------------------------------------------------------------- render */

  const visibleDrafts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return drafts;
    }
    return drafts.filter((draft) =>
      `${draftLabel(draft)} ${draft.meta.tags.join(" ")} ${draft.meta.categories.join(" ")}`
        .toLowerCase()
        .includes(needle),
    );
  }, [drafts, query]);

  const words = useMemo(() => (current ? countWords(docToPlainText(current.doc)) : 0), [current]);

  if (!ready || !current) {
    return <div className="empty">Loading…</div>;
  }

  return (
    <div className="app" data-sidebar={settings.sidebarOpen ? "open" : "closed"} data-focus={settings.focusMode}>
      {settings.sidebarOpen ? (
        <Sidebar
          drafts={visibleDrafts}
          currentId={currentId}
          query={query}
          onQuery={setQuery}
          onSelect={(id) => void selectDraft(id)}
          onNew={() => void newDraft()}
          onDuplicate={(id) => void duplicateDraft(id)}
          onDelete={(id) => void deleteDraft(id)}
          onOpenSettings={() => setDialog("settings")}
          onToggleTheme={() => updateSettings({ theme: resolvedTheme === "dark" ? "light" : "dark" })}
          theme={resolvedTheme}
        />
      ) : null}

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="btn icon ghost"
            title="Toggle drafts — ⌘\"
            aria-label="Toggle drafts"
            onClick={() => updateSettings({ sidebarOpen: !settings.sidebarOpen })}
          >
            <Icon name="panel" />
          </button>
          <div className="topbar-title">{draftLabel(current)}</div>
          <div className="topbar-tools">
            <span className="status">
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
              {saveState === "idle" ? "" : " · "}
              {words} words
            </span>
            <button
              type="button"
              className="btn optional"
              onClick={() => updateSettings({ metaOpen: !settings.metaOpen })}
            >
              Front matter
            </button>
            <ExportMenu busy={exporting} onExport={(format) => void exportAs(format)} />
            <button type="button" className="btn primary" onClick={() => setDialog("publish")}>
              Publish
            </button>
            <button
              type="button"
              className={settings.focusMode ? "btn icon ghost optional is-on" : "btn icon ghost optional"}
              title="Focus mode"
              aria-label="Focus mode"
              aria-pressed={settings.focusMode}
              onClick={() =>
                updateSettings({ focusMode: !settings.focusMode, sidebarOpen: settings.focusMode })
              }
            >
              <Icon name="focus" />
            </button>
          </div>
        </header>

        <div className="editor-scroll">
          <div className="editor-page">
            <div className="editor-card">
              {editor && !settings.focusMode ? (
                <Toolbar
                  editor={editor}
                  onToggleAllCollapsibles={(open) => editor.commands.setAllCollapsiblesOpen(open)}
                />
              ) : null}
              <div
                className="editor-body"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                    event.preventDefault();
                    editor?.commands.focus("end");
                  }
                }}
              >
            <input
              className="title-input"
              placeholder="Title"
              value={current.meta.title}
              onChange={(event) => updateMeta({ title: event.target.value })}
            />
            <textarea
              className="description-input"
              placeholder="A one-line description for the post card and SEO"
              rows={2}
              value={current.meta.description}
              onChange={(event) => updateMeta({ description: event.target.value })}
            />
            {editor ? (
              <>
                <BubbleMenu editor={editor} className="bubble">
                  {(
                    [
                      ["bold", "Bold", () => editor.chain().focus().toggleBold().run()],
                      ["italic", "Italic", () => editor.chain().focus().toggleItalic().run()],
                      ["highlight", "Highlight", () => editor.chain().focus().toggleHighlight().run()],
                      ["code", "Inline code", () => editor.chain().focus().toggleCode().run()],
                      [
                        "link",
                        "Link",
                        () => {
                          const href = window.prompt("Link URL", "https://");
                          if (href) {
                            editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
                          }
                        },
                      ],
                    ] as const
                  ).map(([icon, label, action]) => (
                    <button
                      key={icon}
                      type="button"
                      className={editor.isActive(icon === "highlight" ? "highlight" : icon) ? "tool is-active" : "tool"}
                      title={label}
                      aria-label={label}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={action}
                    >
                      <Icon name={icon} />
                    </button>
                  ))}
                </BubbleMenu>
                <EditorContent editor={editor} />
              </>
            ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {settings.metaOpen ? (
        <MetaPanel
          meta={current.meta}
          slug={current.slug}
          onChange={updateMeta}
          onSlugChange={setSlug}
          onClose={() => updateSettings({ metaOpen: false })}
        />
      ) : null}

      {dialog === "publish" ? (
        <PublishDialog
          draft={current}
          settings={settings}
          config={config}
          onSettingsChange={updateSettings}
          onClose={() => setDialog(null)}
          onPublished={onPublished}
          onOpenSettings={() => setDialog("settings")}
        />
      ) : null}

      {dialog === "settings" ? (
        <SettingsDialog
          settings={settings}
          config={config}
          onChange={updateSettings}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {toast ? (
        <div className={toast.kind === "error" ? "toast error" : "toast"} role="status">
          {toast.message}{" "}
          {toast.href ? (
            <a href={toast.href} target="_blank" rel="noreferrer">
              View →
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
