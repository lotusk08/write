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
import {
  createShareRoom,
  endShareRoom,
  fetchAppConfig,
  fetchPostSource,
  shareRoomLive,
  PasswordRejected,
} from "./lib/api.ts";
import { draftStore, type Draft } from "./lib/db.ts";
import { createDraft, draftLabel, newPostMeta, sortDrafts } from "./lib/draft.ts";
import { downloadBlob, downloadText, printDocument } from "./lib/download.ts";
import { markdownToDoc, parsePost, postPathFromLink, slugFromPath } from "./lib/import.ts";
import { rememberPassword, sessionPassword } from "./lib/password.ts";
import {
  collabExtensions,
  joinShare,
  leaveShare,
  seedUpdate,
  shareLink,
  SHARE_TOKEN,
  type ShareSession,
} from "./lib/share.ts";
import { buildHtmlDocument } from "./lib/html.ts";
import { docToMarkdown, docToPlainText } from "./lib/markdown.ts";
import { draftSlug, markdownForExport, type PublishPlan } from "./lib/publish.ts";
import { applyConfig, loadSettings, saveSettings, type Settings } from "./lib/settings.ts";
import { setSiteUrl } from "./lib/site.ts";
import { countWords, datePrefix, slugify } from "./lib/text.ts";
import { usePinnedViewport } from "./lib/viewport.ts";

type SaveState = "idle" | "saving" | "saved";
type Toast = { message: string; kind: "info" | "error"; href?: string } | null;

const LABELS: Record<ExportFormat, string> = {
  markdown: "Markdown",
  docx: "Word",
  pdf: "PDF",
  html: "HTML",
  copy: "Copy",
};

const SAVE_DEBOUNCE_MS = 600;
const PARSE_DEBOUNCE_MS = 300;
const THINK_URL = "https://think.stevehoang.com";

export default function App() {
  usePinnedViewport();

  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [publishOpen, setPublishOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [exporting, setExporting] = useState(false);
  const [ready, setReady] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [session, setSession] = useState<ShareSession | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

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

  const settle = useCallback(async () => {
    window.clearTimeout(parseTimer.current);
    if (sourceRef.current !== null) {
      queueSave({ doc: markdownToDoc(sourceRef.current) });
    }
    await flush();
  }, [flush, queueSave]);

  const shareToken = current?.shareToken ?? null;

  const endedShare = useCallback(() => {
    const id = currentIdRef.current;
    if (!id) {
      return;
    }
    pendingRef.current = { ...pendingRef.current, shareToken: undefined };
    void flush();
    setToast({ message: "Sharing ended.", kind: "info" });
  }, [flush]);

  useEffect(() => {
    if (!shareToken) {
      setSession(null);
      return;
    }
    const joined = joinShare(shareToken, endedShare);
    setSession(joined);
    return () => {
      leaveShare(joined);
      setSession(null);
    };
  }, [shareToken, currentId, endedShare]);

  const editor = useEditor(
    {
      extensions: session ? collabExtensions(session, settings.author) : editorExtensions,
      ...(session ? {} : { content: { type: "doc", content: [{ type: "paragraph" }] } }),
      autofocus: false,
      onUpdate: ({ editor: instance }) => queueSave({ doc: instance.getJSON() }),
    },
    [session],
  );

  useEffect(() => {
    window.clearTimeout(parseTimer.current);
    setSource(null);
  }, [currentId]);

  useEffect(() => {
    document.title = current ? draftLabel(current) : "write";
  }, [current]);

  useEffect(() => {
    if (!editor || !currentId) {
      return;
    }
    const draft = draftsRef.current.find((item) => item.id === currentId);
    if (draft && !draft.shareToken) {
      editor.commands.setContent(draft.doc, { emitUpdate: false });
    }
  }, [editor, currentId]);

  useEffect(() => {
    void (async () => {
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
  }, []);

  useEffect(() => {
    const field = description.current;
    if (!field) {
      return;
    }
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [current?.meta.description, currentId, ready]);

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

  const newDraft = useCallback(async () => {
    await settle();
    const draft = createDraft(settings);
    await draftStore.put(draft);
    setDrafts((previous) => sortDrafts([draft, ...previous]));
    setCurrentId(draft.id);
    window.setTimeout(() => document.querySelector<HTMLInputElement>(".title-input")?.focus(), 40);
  }, [settle, settings]);

  const importPost = useCallback(
    async (path: string) => {
      try {
        const existing = draftsRef.current.find((draft) => draft.publishedPath === path);
        if (existing) {
          setCurrentId(existing.id);
          setToast({ message: `Opened your local draft of ${path}.`, kind: "info" });
          return;
        }

        const source = await fetchPostSource(path, sessionPassword());
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

  useEffect(() => {
    if (!ready) {
      return;
    }
    const token = new URLSearchParams(window.location.search).get("share");
    if (!token) {
      return;
    }
    window.history.replaceState({}, "", window.location.pathname);
    if (!SHARE_TOKEN.test(token)) {
      setToast({ message: "Not a share link.", kind: "error" });
      return;
    }
    void (async () => {
      const existing = draftsRef.current.find((draft) => draft.shareToken === token);
      if (existing) {
        setCurrentId(existing.id);
        return;
      }
      if (!(await shareRoomLive(token))) {
        setToast({ message: "That share has ended.", kind: "error" });
        return;
      }
      const draft: Draft = { ...createDraft(loadSettings()), shareToken: token };
      await draftStore.put(draft);
      setDrafts((previous) => sortDrafts([draft, ...previous]));
      setCurrentId(draft.id);
    })();
  }, [ready]);

  const editSource = useCallback(async () => {
    await settle();
    const draft = draftsRef.current.find((item) => item.id === currentIdRef.current);
    setSource(draft ? docToMarkdown(draft.doc) : "");
  }, [settle]);

  const editRich = useCallback(() => {
    if (source !== null) {
      editor?.commands.setContent(markdownToDoc(source), { emitUpdate: false });
    }
    setSource(null);
  }, [editor, source]);

  const changeSource = useCallback(
    (text: string) => {
      setSource(text);
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
      if (draft.shareToken && sessionPassword()) {
        void endShareRoom(draft.shareToken, sessionPassword()).catch(() => undefined);
      }
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
    async (formats: ExportFormat[]) => {
      if (!current || !editor || formats.length === 0) {
        return;
      }
      setExporting(true);
      try {
        await settle();
        const draft = draftsRef.current.find((item) => item.id === current.id) ?? current;
        const slug = draftSlug(draft);
        let html: string | null = null;
        const page = async () => (html ??= await buildHtmlDocument(editor.getHTML(), draft.meta));

        const done: ExportFormat[] = [];
        const failed: string[] = [];

        for (const format of formats) {
          try {
            if (format === "markdown" || format === "copy") {
              const markdown = await markdownForExport(draft, settings);
              if (format === "copy") {
                await navigator.clipboard.writeText(markdown);
              } else {
                downloadText(markdown, `${datePrefix(draft.meta.date)}-${slug}.md`, "text/markdown");
              }
            } else if (format === "docx") {
              const { docToDocxBlob } = await import("./lib/docx.ts");
              downloadBlob(await docToDocxBlob(draft.doc, draft.meta), `${slug}.docx`);
            } else if (format === "pdf") {
              await printDocument(await page());
            } else {
              downloadText(await page(), `${slug}.html`, "text/html");
            }
            done.push(format);
          } catch (error) {
            failed.push(
              `${LABELS[format]} — ${error instanceof Error ? error.message : "failed"}`,
            );
          }
        }

        if (failed.length) {
          setToast({ message: failed.join("; "), kind: "error" });
        } else {
          setToast({
            message:
              done.length === 1 && done[0] === "copy"
                ? "Markdown copied to clipboard."
                : `Exported ${done.length} file${done.length === 1 ? "" : "s"}.`,
            kind: "info",
          });
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

  const enableShare = useCallback(
    async (password: string) => {
      if (!password) {
        setShareError("The publish password turns sharing on.");
        return;
      }
      setShareBusy(true);
      setShareError(null);
      try {
        await settle();
        const draft = draftsRef.current.find((item) => item.id === currentIdRef.current);
        if (!draft) {
          return;
        }
        const token = await createShareRoom(seedUpdate(draft.doc), password);
        rememberPassword(password);
        setSource(null);
        queueSave({ shareToken: token });
        await flush();
      } catch (cause) {
        if (cause instanceof PasswordRejected) {
          rememberPassword("");
        }
        setShareError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setShareBusy(false);
      }
    },
    [settle, flush, queueSave],
  );

  const disableShare = useCallback(
    async (password: string) => {
      const draft = draftsRef.current.find((item) => item.id === currentIdRef.current);
      const token = draft?.shareToken;
      if (!token) {
        return;
      }
      setShareBusy(true);
      setShareError(null);
      try {
        await endShareRoom(token, password);
        rememberPassword(password);
        queueSave({ shareToken: undefined });
        await flush();
      } catch (cause) {
        if (cause instanceof PasswordRejected) {
          rememberPassword("");
        }
        setShareError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setShareBusy(false);
      }
    },
    [flush, queueSave],
  );

  const copyShareLink = useCallback(async () => {
    const draft = draftsRef.current.find((item) => item.id === currentIdRef.current);
    if (!draft?.shareToken) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shareLink(draft.shareToken));
      setToast({ message: "Share link copied.", kind: "info" });
    } catch {
      setToast({ message: "Could not reach the clipboard.", kind: "error" });
    }
  }, []);

  const openMindmap = useCallback(() => {
    const draft = draftsRef.current.find((item) => item.id === currentIdRef.current);
    if (!draft || !editor) {
      return;
    }
    const doc = sourceRef.current !== null ? markdownToDoc(sourceRef.current) : editor.getJSON();
    const meta = { ...draft.meta, ...pendingRef.current.meta };
    const title = meta.title.trim();
    const body = docToMarkdown(doc);
    const markdown = title ? `# ${title}\n\n${body}` : body;
    window.open(`${THINK_URL}/#${encodeURI(markdown)}`, "_blank", "noopener");
  }, [editor]);

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
        void exportAs(["copy"]);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [exportAs, flush, newDraft, updateSettings]);

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
                  placeholder="Description"
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
                    title={
                      session
                        ? "The Markdown source sits out while the draft is shared"
                        : source === null
                          ? "Edit the Markdown source"
                          : "Back to the page view"
                    }
                    aria-pressed={source !== null}
                    disabled={Boolean(session)}
                    onClick={() => (source === null ? void editSource() : editRich())}
                  >
                    <span className="tool-text">MD</span>
                  </button>
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
          settings,
          config,
          onChange: updateMeta,
          onSlugChange: setSlug,
          onSettingsChange: updateSettings,
        }}
        settings={{ settings, config, onChange: updateSettings }}
        share={{
          sharing: Boolean(current.shareToken),
          link: current.shareToken ? shareLink(current.shareToken) : null,
          busy: shareBusy,
          error: shareError,
          onEnable: (password) => void enableShare(password),
          onDisable: (password) => void disableShare(password),
          onCopyLink: () => void copyShareLink(),
        }}
        onPublish={() =>
          void settle().then(() => {
            setMenuOpen(false);
            setPublishOpen(true);
          })
        }
        onMindmap={openMindmap}
        onExport={(formats) => void exportAs(formats)}
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
