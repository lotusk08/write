import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppConfig, PostMeta, PublishResult } from "../shared/types.ts";
import { DraftRail } from "./components/DraftRail.tsx";
import { EditorPopover, type ExportFormat } from "./components/EditorPopover.tsx";
import { Icon } from "./components/Icons.tsx";
import { PublishDialog } from "./components/PublishDialog.tsx";
import { Toolbar } from "./components/Toolbar.tsx";
import { editorExtensions } from "./editor/extensions.ts";
import { fetchAppConfig, fetchPostSource } from "./lib/api.ts";
import { draftStore, type Draft } from "./lib/db.ts";
import { createDraft, draftLabel, newPostMeta, sortDrafts } from "./lib/draft.ts";
import { downloadBlob, downloadText } from "./lib/download.ts";
import { markdownToDoc, parsePost, postPathFromLink, slugFromPath } from "./lib/import.ts";
import { buildHtmlDocument } from "./lib/html.ts";
import { docToMarkdown, docToPlainText } from "./lib/markdown.ts";
import { draftSlug, markdownForExport, type PublishPlan } from "./lib/publish.ts";
import { applyConfig, loadSettings, saveSettings, type Settings } from "./lib/settings.ts";
import { setSiteUrl } from "./lib/site.ts";
import { countWords, datePrefix, slugify } from "./lib/text.ts";
import { usePinnedViewport } from "./lib/viewport.ts";

type SaveState = "idle" | "saving" | "saved";
type Toast = { message: string; kind: "info" | "error"; href?: string } | null;

const SAVE_DEBOUNCE_MS = 600;
/** Long enough that a long post is not re-parsed on every keystroke. */
const PARSE_DEBOUNCE_MS = 300;

export default function App() {
  // Keeps the shell inside the part of the window the keyboard leaves on
  // screen, so the toolbar and its menus stay reachable on a phone.
  usePinnedViewport();

  const [settings, setSettings] = useState<Settings>(loadSettings);
  // How the deployment is configured, as its own Worker reports it.
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [publishOpen, setPublishOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [exporting, setExporting] = useState(false);
  const [ready, setReady] = useState(false);
  // The post's Markdown while it is being edited as text; null in rich mode.
  const [source, setSource] = useState<string | null>(null);

  const draftsRef = useRef<Draft[]>([]);
  const currentIdRef = useRef<string | null>(null);
  const pendingRef = useRef<Partial<Draft>>({});
  const timerRef = useRef<number | undefined>(undefined);
  const parseTimer = useRef<number | undefined>(undefined);
  const sourceRef = useRef<string | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const description = useRef<HTMLTextAreaElement>(null);
  const mainRegion = useRef<HTMLDivElement>(null);

  draftsRef.current = drafts;
  currentIdRef.current = currentId;
  sourceRef.current = source;

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
    const merge = (list: Draft[]) => sortDrafts(list.map((draft) => (draft.id === id ? next : draft)));
    // The ref, not just the state: everything that reads the document after
    // awaiting a flush — the source view, the next draft, an export — reads it
    // through here, and React has not re-rendered yet to refill it. Saving and
    // immediately opening the Markdown source used to hand back the post as it
    // was a keystroke ago, and coming back out of it wrote that copy over the
    // real one.
    draftsRef.current = merge(draftsRef.current);
    setDrafts(merge);
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

  /**
   * Brings the draft up to date with whatever is still in flight: a Markdown
   * parse waiting on its debounce, then the save queue. Anything that reads
   * the document rather than the screen — publishing, exporting — goes through
   * here first, or it would work from a copy up to a second old.
   */
  const settle = useCallback(async () => {
    window.clearTimeout(parseTimer.current);
    if (sourceRef.current !== null) {
      queueSave({ doc: markdownToDoc(sourceRef.current) });
    }
    await flush();
  }, [flush, queueSave]);

  /* ---------------------------------------------------------------- editor */

  const editor = useEditor({
    extensions: editorExtensions,
    content: { type: "doc", content: [{ type: "paragraph" }] },
    autofocus: false,
    onUpdate: ({ editor: instance }) => queueSave({ doc: instance.getJSON() }),
  });

  useEffect(() => {
    window.clearTimeout(parseTimer.current);
    setSource(null);
  }, [currentId]);

  // The browser tab carries the draft's name, so a window full of them can be
  // told apart.
  useEffect(() => {
    document.title = current ? draftLabel(current) : "write";
  }, [current]);

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
      // The deployment knows where it publishes; this browser only remembers
      // how the writing is set up. Ask both before the first draft is made,
      // so a new post is stamped with the right paths from the start.
      const [stored, remote] = await Promise.all([draftStore.all(), fetchAppConfig()]);
      let active = loadSettings();
      if (remote) {
        active = applyConfig(active, remote);
        setConfig(remote);
        setSettings(active);
        saveSettings(active);
      }
      setSiteUrl(active.siteUrl);
      const sorted = sortDrafts(stored);
      if (sorted.length === 0) {
        const draft = createDraft(active);
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

  useEffect(() => {
    const field = description.current;
    if (!field) {
      return;
    }
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [current?.meta.description, currentId, ready]);

  /* ----------------------------------------------------------------- theme */

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = settings.theme === "dark" || (settings.theme === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
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
    await settle();
    const draft = createDraft(settings);
    await draftStore.put(draft);
    setDrafts((previous) => sortDrafts([draft, ...previous]));
    setCurrentId(draft.id);
    window.setTimeout(() => document.querySelector<HTMLInputElement>(".title-input")?.focus(), 40);
  }, [settle, settings]);

  /**
   * Opens a published post in the editor: the other end of the blog's edit
   * button. A draft already published to that path is reopened rather than
   * duplicated, so local edits are never silently replaced by the live copy.
   */
  const importPost = useCallback(
    async (path: string) => {
      try {
        const existing = draftsRef.current.find((draft) => draft.publishedPath === path);
        if (existing) {
          setCurrentId(existing.id);
          setToast({ message: `Opened your local draft of ${path}.`, kind: "info" });
          return;
        }

        const source = await fetchPostSource(path);
        const parsed = parsePost(source.markdown);
        const now = Date.now();
        const draft: Draft = {
          id: crypto.randomUUID(),
          title: parsed.meta.title ?? slugFromPath(path),
          slug: slugFromPath(path),
          doc: parsed.doc,
          meta: { ...newPostMeta(settings), ...parsed.meta },
          createdAt: now,
          updatedAt: now,
          publishedPath: path,
        };
        await draftStore.put(draft);
        setDrafts((previous) => sortDrafts([draft, ...previous]));
        setCurrentId(draft.id);
        // Re-publishing should land back on the file it came from.
        const drafts = settings.draftsDir.replace(/^\/+|\/+$/g, "");
        updateSettings({ publishTarget: path.startsWith(`${drafts}/`) ? "drafts" : "posts" });
        setToast({ message: `Opened ${path}.`, kind: "info" });
      } catch (cause) {
        setToast({
          message: cause instanceof Error ? cause.message : String(cause),
          kind: "error",
        });
      }
    },
    [settings, updateSettings],
  );

  // `?edit=_posts/…` — the blog's edit button pointing back here. The query is
  // dropped straight away so a reload does not import the post twice.
  useEffect(() => {
    if (!ready) {
      return;
    }
    const requested = new URLSearchParams(window.location.search).get("edit");
    if (!requested) {
      return;
    }
    window.history.replaceState({}, "", window.location.pathname);
    const path = postPathFromLink(requested);
    if (path) {
      void importPost(path);
    } else {
      setToast({ message: `Not a post path: ${requested}`, kind: "error" });
    }
  }, [ready, importPost]);

  /**
   * The same post as Markdown. Everything downstream reads the document, so
   * the text is parsed back as it is typed rather than only on the way out.
   */
  const editSource = useCallback(async () => {
    await settle();
    const draft = draftsRef.current.find((item) => item.id === currentIdRef.current);
    setSource(draft ? docToMarkdown(draft.doc) : "");
  }, [settle]);

  const editRich = useCallback(() => {
    if (source !== null) {
      // Reading the state rather than updating from it: a state updater has to
      // stay pure, and React may run it more than once.
      editor?.commands.setContent(markdownToDoc(source), { emitUpdate: false });
    }
    setSource(null);
  }, [editor, source]);

  const changeSource = useCallback(
    (text: string) => {
      setSource(text);
      // Parsing a long post on every keystroke is wasted work, so the document
      // catches up a beat behind the text — and `flush` is not what saves it,
      // so the debounce is here rather than in the save queue.
      window.clearTimeout(parseTimer.current);
      parseTimer.current = window.setTimeout(
        () => queueSave({ doc: markdownToDoc(text) }),
        PARSE_DEBOUNCE_MS,
      );
    },
    [queueSave],
  );

  const selectDraft = useCallback(
    async (id: string) => {
      await settle();
      setCurrentId(id);
    },
    [settle],
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
    async (format: ExportFormat) => {
      if (!current || !editor) {
        return;
      }
      setExporting(true);
      try {
        await settle();
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
      setPublishOpen(false);
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
        setMenuOpen((value) => !value);
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
  }, [exportAs, flush, newDraft, updateSettings]);

  /* ---------------------------------------------------------------- render */

  const words = useMemo(() => (current ? countWords(docToPlainText(current.doc)) : 0), [current]);

  if (!ready || !current) {
    return <div className="empty">Loading…</div>;
  }

  return (
    <div className="app" data-focus={settings.focusMode}>
      {settings.focusMode ? null : (
        <DraftRail
          drafts={drafts}
          currentId={currentId}
          onSelect={(id) => void selectDraft(id)}
          onNew={() => void newDraft()}
          onRename={(title) => updateMeta({ title })}
          onDelete={(id) => void deleteDraft(id)}
        />
      )}

      <div className="main" ref={mainRegion}>
        {/* The pop-up docks over this corner, so the button steps aside. */}
        {settings.focusMode && !menuOpen ? (
          <button
            ref={menuButton}
            type="button"
            className="menu-btn"
            title="Menu — ⌘\\"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
          >
            <Icon name="command" />
          </button>
        ) : null}

        <div className="editor-scroll">
          <div className="editor-page">
            <div className="editor-card">
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
                  ref={description}
                  className="description-input"
                  placeholder="A one-line description for the post card and SEO"
                  rows={1}
                  value={current.meta.description}
                  onChange={(event) => updateMeta({ description: event.target.value })}
                />
                {source !== null ? (
                  <textarea
                    className="source-editor"
                    spellCheck={false}
                    value={source}
                    onChange={(event) => changeSource(event.target.value)}
                  />
                ) : editor ? (
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
                          className={editor.isActive(icon) ? "tool is-active" : "tool"}
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

              {editor && !settings.focusMode ? (
                <div className="card-dock">
                  {source === null ? (
                    <Toolbar
                      editor={editor}
                      onToggleAllCollapsibles={(open) => editor.commands.setAllCollapsiblesOpen(open)}
                    />
                  ) : (
                    <span className="hint source-note">
                      Markdown source — exactly what gets published
                    </span>
                  )}
                  <button
                    type="button"
                    className={source === null ? "tool mode-toggle" : "tool mode-toggle is-active"}
                    title={source === null ? "Edit the Markdown source" : "Back to the page view"}
                    aria-pressed={source !== null}
                    onClick={() => (source === null ? void editSource() : editRich())}
                  >
                    <span className="tool-text">MD</span>
                  </button>
                  {/* On a phone the count gives way to the tools; the save
                      state, which is only up for a moment, does not. */}
                  <span className={saveState === "saving" ? "status is-saving" : "status"}>
                    {saveState === "saving" ? "Saving…" : `${words} words`}
                  </span>
                  <span className="tool-sep" />
                  <button
                    ref={menuButton}
                    type="button"
                    className={menuOpen ? "tool is-active" : "tool"}
                    title="Menu — ⌘\\"
                    aria-label="Open menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((value) => !value)}
                  >
                    <Icon name="command" />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <EditorPopover
        open={menuOpen}
        anchorRef={menuButton}
        regionRef={mainRegion}
        tab={settings.menuTab}
        onTab={(menuTab) => updateSettings({ menuTab })}
        onClose={() => setMenuOpen(false)}
        post={{
          meta: current.meta,
          slug: current.slug,
          onChange: updateMeta,
          onSlugChange: setSlug,
        }}
        settings={{ settings, config, onChange: updateSettings }}
        onPublish={() =>
          void settle().then(() => {
            // The menu is portalled and the dialog is not, so on a phone —
            // where the menu is a full-height sheet — it would sit over the
            // dialog it just opened, with Commit underneath it.
            setMenuOpen(false);
            setPublishOpen(true);
          })
        }
        onExport={(format) => void exportAs(format)}
        exporting={exporting}
        escapeCloses={!publishOpen}
      />

      {publishOpen ? (
        <PublishDialog
          draft={current}
          settings={settings}
          config={config}
          onSettingsChange={updateSettings}
          onClose={() => setPublishOpen(false)}
          onPublished={onPublished}
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
