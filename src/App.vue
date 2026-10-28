<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { AppConfig, PostMeta, PublishResult } from "../shared/types.ts";
import { fileDate } from "../shared/paths.ts";
import DraftRail from "./components/DraftRail.vue";
import EditorPopover from "./components/EditorPopover.vue";
import Icon from "./components/Icon.vue";
import PostEditor from "./components/PostEditor.vue";
import PublishDialog from "./components/PublishDialog.vue";
import TocAside from "./components/TocAside.vue";
import TocBar from "./components/TocBar.vue";
import type { DoneAction, ExportFormat, ShareState } from "./components/types.ts";
import { useOutline } from "./components/useOutline.ts";
import { docToHtml } from "./editor/bridge.ts";
import type { JSONContent } from "./editor/doc.ts";
import { createShareRoom, endShareRoom, fetchAppConfig, fetchPostSource, shareRoomState } from "./lib/api.ts";
import { draftStore, isLocalSrc, keepSnapshot, NOTICE, resolveLocalSrc, restoreSnapshots, type Draft } from "./lib/db.ts";
import { createDraft, currentDoc, currentMeta, currentSource, draftLabel, newPostMeta, sortDrafts } from "./lib/draft.ts";
import { downloadBlob, downloadText, printDocument } from "./lib/download.ts";
import type { PinWritten } from "./lib/home.ts";
import { buildHtmlDocument } from "./lib/html.ts";
import { postPathFromLink, slugFromPath } from "./lib/paths.ts";
import { loadReader, preloadReader } from "./lib/reader.ts";
import { keptFront, readSource, rememberSource, sameMeta, sourceFor, withFront } from "./lib/source.ts";
import { docToPlainText } from "./lib/markdown.ts";
import { mindmapUrl } from "./lib/mindmap.ts";
import { sessionPassword } from "./lib/password.ts";
import {
  draftPrint,
  draftSlug,
  markdownForExport,
  printOf,
  repointCover,
  repointDoc,
  type PublishPlan,
} from "./lib/publish.ts";
import { applyConfig, loadSettings, saveSettings, type Settings } from "./lib/settings.ts";
import {
  participantColor,
  participantName,
  samePeers,
  saveParticipantName,
  SHARE_TOKEN,
  shareLink,
  type SharePeer,
} from "./lib/participants.ts";
import type { ShareSession } from "./lib/share.ts";
import { previewSrc, setSiteUrl, showPublishedAs } from "./lib/site.ts";
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
const TOAST_MS = 7000;
const DONE_MS = 1800;

let booting: Promise<{ drafts: Draft[]; settings: Settings; config: AppConfig | null }> | null = null;

/** One startup, however many times it is asked for: two runs against an empty store made two drafts. */
function boot() {
  booting ??= (async () => {
    const [kept, config] = await Promise.all([draftStore.all(), fetchAppConfig()]);
    const stored = await restoreSnapshots(kept);
    const settings = config ? applyConfig(loadSettings(), config) : loadSettings();
    if (config) {
      saveSettings(settings);
    }
    if (stored.length) {
      const drafts = stored.map((draft) => ({
        ...draft,
        doc: currentDoc(draft.doc),
        meta: currentMeta(draft.meta),
        sourceText: currentSource(draft.sourceText),
      }));
      return { drafts: sortDrafts(drafts), settings, config };
    }
    const draft = createDraft();
    await draftStore.put(draft);
    return { drafts: [draft], settings, config };
  })();
  return booting;
}

usePinnedViewport();

const settings = ref<Settings>(loadSettings());
const config = shallowRef<AppConfig | null>(null);
const drafts = shallowRef<Draft[]>([]);
const currentId = ref<string | null>(null);
const saveState = ref<SaveState>("idle");
const publishOpen = ref(false);
const menuOpen = ref(false);
const toast = ref<Toast>(null);
const justDone = ref<DoneAction | null>(null);
const exporting = ref(false);
const ready = ref(false);
const source = ref<string | null>(null);
const session = shallowRef<ShareSession | null>(null);
let shareRoom: typeof import("./lib/share.ts") | null = null;
const loadShare = async () => (shareRoom ??= await import("./lib/share.ts"));
const shareTarget = ref<boolean | null>(null);
const shareError = ref<string | null>(null);
const shareName = ref(participantName());
const peers = shallowRef<SharePeer[]>([]);
const contentVersion = ref(0);
const systemDark = ref(window.matchMedia("(prefers-color-scheme: dark)").matches);

const postEditor = ref<InstanceType<typeof PostEditor> | null>(null);
const menuButton = ref<HTMLButtonElement | null>(null);
const focusButton = ref<HTMLButtonElement | null>(null);
const mainRegion = ref<HTMLDivElement | null>(null);
const scrollRegion = ref<HTMLDivElement | null>(null);

/** A change waiting to be written, and the draft it belongs to, which by then need not be the open one. */
let pending: Partial<Draft> = {};
let pendingId: string | null = null;
let writing: Partial<Draft> = {};
let writingId: string | null = null;
let saveTimer: number | undefined;
let parseTimer: number | undefined;
let toastTimer: number | undefined;
let doneTimer: number | undefined;

const current = computed(() => drafts.value.find((draft) => draft.id === currentId.value) ?? null);
const dark = computed(() => settings.value.theme === "dark" || (settings.value.theme === "system" && systemDark.value));
const words = computed(() => (current.value ? countWords(docToPlainText(current.value.doc)) : 0));
const tocOn = computed(() => Boolean(current.value?.meta.toc) && source.value === null && !settings.value.focusMode);
const editorRoot = computed(() => (postEditor.value?.root as HTMLElement | null | undefined) ?? null);
const outline = useOutline(editorRoot, scrollRegion, tocOn, contentVersion);
const displayName = computed(() => shareName.value.trim() || participantName());
const anchor = computed(() => (settings.value.focusMode ? focusButton.value : menuButton.value));

const shareState = computed<ShareState>(() => ({
  sharing: shareTarget.value ?? Boolean(current.value?.shareToken),
  owner: !current.value?.shareToken || Boolean(current.value?.shareOwner),
  link: current.value?.shareToken ? shareLink(current.value.shareToken) : null,
  busy: shareTarget.value !== null,
  error: shareError.value,
  name: shareName.value,
  peers: peers.value,
}));

/** Stores a draft and puts it in the list in place of the one with its id. */
async function storeDraft(next: Draft) {
  await draftStore.put(next);
  drafts.value = drafts.value.map((item) => (item.id === next.id ? next : item));
}

function findDraft(id: string | null): Draft | undefined {
  return drafts.value.find((draft) => draft.id === id);
}

function showToast(message: string, kind: "info" | "error" = "info", href?: string) {
  toast.value = { message, kind, href };
}

/** A menu action that worked ticks its button for a moment; with the menu shut (⌘⇧C), a toast says so instead. */
function finished(action: DoneAction, message: string) {
  window.clearTimeout(doneTimer);
  justDone.value = action;
  doneTimer = window.setTimeout(() => (justDone.value = null), DONE_MS);
  if (!menuOpen.value) {
    showToast(message);
  }
}

function errorText(cause: unknown, fallback?: string): string {
  return cause instanceof Error ? cause.message : (fallback ?? String(cause));
}

async function flush() {
  const id = pendingId;
  const patch = pending;
  pending = {};
  pendingId = null;
  if (!id || Object.keys(patch).length === 0) {
    return;
  }
  if (patch.doc !== undefined && id === currentId.value && session.value && shareRoom && !("shareToken" in patch)) {
    patch.shareSeed = shareRoom.sessionSnapshot(session.value);
  }
  const base = findDraft(id);
  if (!base) {
    return;
  }
  const next: Draft = { ...base, ...patch, updatedAt: Date.now() };
  writing = writingId === id ? { ...writing, ...patch } : patch;
  writingId = id;
  try {
    await draftStore.put(next);
  } catch (cause) {
    // A full disk, say: the change stays in the app, waiting for the next save, and kept in case the page is left.
    drafts.value = sortDrafts(drafts.value.map((draft) => (draft.id === id ? next : draft)));
    if (pendingId === null || pendingId === id) {
      pending = { ...patch, ...pending };
      pendingId = id;
    }
    keepSnapshot(id, patch);
    saveState.value = "idle";
    showToast(`Could not save the draft: ${errorText(cause)}`, "error");
    return;
  } finally {
    if (writingId === id) {
      writing = {};
      writingId = null;
    }
  }
  drafts.value = sortDrafts(drafts.value.map((draft) => (draft.id === id ? next : draft)));
  saveState.value = "saved";
}

/** The change still waiting for a draft, if any. */
function pendingFor(id: string | null): Partial<Draft> {
  return id !== null && id === pendingId ? pending : {};
}

/** Queues a change to a draft, the open one unless another is named; one still waiting for another draft is written first. */
function queueSave(patch: Partial<Draft>, id = currentId.value) {
  if (pendingId !== null && pendingId !== id) {
    void flush();
  }
  pendingId = id;
  pending = { ...pending, ...patch };
  saveState.value = "saving";
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
}

function updateSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
  saveSettings(settings.value);
}

/** Everything typed so far, written to the store: the editor's waiting change, or the Markdown source's. */
async function settle() {
  gather();
  await flush();
}

function gather() {
  window.clearTimeout(parseTimer);
  if (source.value !== null) {
    applySource(source.value);
  } else {
    postEditor.value?.flush();
  }
}

/** An edit, sent by the editor of the draft it was made in — after a switch, the one going away. */
function onEditorChange(doc: JSONContent, id: string) {
  contentVersion.value += 1;
  queueSave({ doc }, id);
  if (id === currentId.value && session.value && shareRoom) {
    shareRoom.pushDoc(session.value, doc);
  }
}

/** Puts a draft in front of the editor without it counting as an edit. */
function replaceDoc(doc: JSONContent) {
  postEditor.value?.setDoc(doc);
  contentVersion.value += 1;
  queueSave({ doc });
}

function endedShare() {
  if (!currentId.value) {
    return;
  }
  queueSave({ shareToken: undefined, shareOwner: undefined, shareSeed: undefined });
  void flush();
  showToast("Sharing ended.");
}

// Two sources, each compared on its own: one getter returning a fresh pair fired on every save, and left and rejoined the room.
watch(
  [() => current.value?.shareToken ?? null, currentId],
  ([token], _previous, onCleanup) => {
    if (!token) {
      session.value = null;
      peers.value = [];
      return;
    }
    let stale = false;
    let stop = () => {};
    onCleanup(() => {
      stale = true;
      stop();
    });
    void loadShare().then(({ joinShare, applyParticipantName, onRemoteChange, pushDoc, readPeers, leaveShare }) => {
      if (stale) {
        return;
      }
      const draft = findDraft(currentId.value);
      const joined = joinShare(token, endedShare, draft?.shareToken === token ? draft.shareSeed : undefined);
      applyParticipantName(joined, shareName.value);
      session.value = joined;

      void shareRoomState(token).then((state) => {
        if (!stale && state === "ended") {
          endedShare();
        }
      });

      // A peer on an older version of the app may still send kramdown's forms.
      const stopRemote = onRemoteChange(joined, () => postEditor.value?.takeUnsent() ?? null, (doc) => replaceDoc(currentDoc(doc)));
      const onSync = (synced: boolean) => {
        const local = findDraft(currentId.value)?.doc;
        if (synced && joined.text.length === 0 && local) {
          pushDoc(joined, local);
        }
      };
      joined.provider.on("sync", onSync);

      const awareness = joined.provider.awareness;
      const read = () => {
        const next = readPeers(joined);
        if (!samePeers(peers.value, next)) {
          peers.value = next;
        }
      };
      read();
      awareness.on("change", read);

      stop = () => {
        stopRemote();
        awareness.off("change", read);
        joined.provider.off("sync", onSync);
        leaveShare(joined);
        session.value = null;
        peers.value = [];
      };
    });
  },
  { immediate: true },
);

watch(currentId, () => {
  window.clearTimeout(parseTimer);
  source.value = null;
});

watch(current, (draft) => {
  document.title = draft ? draftLabel(draft) : "write";
});

watch(
  dark,
  (value) => {
    document.documentElement.dataset.theme = value ? "dark" : "light";
  },
  { immediate: true },
);

watch(toast, (value) => {
  window.clearTimeout(toastTimer);
  if (value) {
    toastTimer = window.setTimeout(() => {
      toast.value = null;
    }, TOAST_MS);
  }
});

async function newDraft() {
  await settle();
  const draft = createDraft();
  await draftStore.put(draft);
  drafts.value = sortDrafts([draft, ...drafts.value]);
  currentId.value = draft.id;
  window.setTimeout(() => postEditor.value?.focus(), 40);
}

async function importPost(path: string) {
  try {
    await settle();
    const existing = drafts.value.find((draft) => draft.publishedPath === path);
    const fetched = await fetchPostSource(path, sessionPassword()).catch((cause: unknown) => {
      if (existing) {
        return null;
      }
      throw cause;
    });
    const mine = existing ? await draftPrint(existing) : "";
    // The same as the site's file, read and written by this app: a print stored by an older writer cannot tell.
    const same =
      Boolean(existing && fetched) &&
      (mine === (await printOf(fetched!.markdown)) || mine === (await draftPrint(await sitePost(path, fetched!.markdown))));
    if (existing && (!fetched || !existing.publishedSha || fetched.sha === existing.publishedSha || same)) {
      if (same && fetched!.sha !== existing.publishedSha) {
        const known = { ...existing, publishedSha: fetched!.sha, publishedPrint: mine };
        await storeDraft(known);
      }
      currentId.value = existing.id;
      showToast(`Opened your local draft of ${path}.`);
      return;
    }
    if (existing && mine !== existing.publishedPrint) {
      currentId.value = existing.id;
      showToast(
        `${path} changed on the site since you opened it, and this draft has edits that are not published, so it was kept. The site will refuse it: copy your edits, delete this draft and open the post again.`,
        "error",
      );
      return;
    }
    const post = await sitePost(path, fetched!.markdown);
    const now = Date.now();
    const draft: Draft = {
      id: crypto.randomUUID(),
      title: post.title ?? slugFromPath(path),
      slug: slugFromPath(path),
      doc: post.doc,
      meta: post.meta,
      createdAt: now,
      updatedAt: now,
      publishedPath: path,
      publishedSha: fetched!.sha,
    };
    draft.sourceText = rememberSource(fetched!.markdown, draft.meta, draft.doc);
    draft.publishedPrint = await draftPrint(draft);
    await draftStore.put(draft);
    if (existing) {
      await draftStore.remove(existing.id);
    }
    drafts.value = sortDrafts([draft, ...drafts.value.filter((item) => item.id !== existing?.id)]);
    currentId.value = draft.id;
    showToast(existing ? `${path} changed on the site; opened the new version.` : `Opened ${path}.`);
  } catch (cause) {
    showToast(errorText(cause), "error");
  }
}

/**
 * A pin written from the site's list follows into a local draft of that post that was in step with the site, so its
 * next publish is not refused as stale; a draft with no unpublished edits stays one.
 */
async function onPinned(written: PinWritten[]) {
  await settle();
  for (const { path, pin, was, sha } of written) {
    const draft = drafts.value.find((item) => item.publishedPath === path && item.publishedSha === was);
    if (!draft) {
      continue;
    }
    const clean = draft.publishedPrint === (await draftPrint(draft));
    const next: Draft = { ...draft, meta: { ...draft.meta, pin }, publishedSha: sha };
    if (clean) {
      next.publishedPrint = await draftPrint(next);
    }
    await storeDraft(next);
  }
}

/** A post on the site as the app opens it: its body, and its fields with the date its file is named by. */
async function sitePost(path: string, markdown: string): Promise<{ title?: string; meta: PostMeta; doc: JSONContent }> {
  const { parsePost } = await loadReader();
  const parsed = parsePost(markdown);
  return { title: parsed.meta.title, meta: { ...newPostMeta(), ...dateOf(path), ...parsed.meta }, doc: parsed.doc };
}

function dateOf(path: string): { date?: string } {
  const date = fileDate(path);
  return date ? { date } : {};
}

function openRequested() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("edit");
  const token = params.get("share");
  if (!requested && !token) {
    return;
  }
  window.history.replaceState({}, "", window.location.pathname);
  if (requested) {
    const path = postPathFromLink(requested);
    if (path) {
      void importPost(path);
    } else {
      showToast(`Not a post path: ${requested}`, "error");
    }
  }
  if (token) {
    void joinRequested(token);
  }
}

async function joinRequested(token: string) {
  if (!SHARE_TOKEN.test(token)) {
    showToast("Not a share link.", "error");
    return;
  }
  const existing = drafts.value.find((draft) => draft.shareToken === token);
  if (existing) {
    currentId.value = existing.id;
    return;
  }
  const state = await shareRoomState(token);
  if (state === "ended") {
    showToast("That share has ended.", "error");
    return;
  }
  if (state === "unknown") {
    showToast("Could not reach the share — open the link again.", "error");
    return;
  }
  const draft: Draft = { ...createDraft(), shareToken: token };
  await draftStore.put(draft);
  drafts.value = sortDrafts([draft, ...drafts.value]);
  currentId.value = draft.id;
  showToast(`Joined as “${participantName()}” — tap your name below to change it.`);
}

/** The post as one Markdown file, front matter included, shown as it was last typed or opened while it reads the same. */
async function editSource() {
  try {
    await loadReader();
  } catch (cause) {
    showToast(errorText(cause, "Could not load the Markdown reader."), "error");
    return;
  }
  await settle();
  const draft = findDraft(currentId.value);
  source.value = draft ? sourceFor(draft.meta, draft.doc, draft.sourceText) : "";
}

async function editRich() {
  if (source.value !== null) {
    window.clearTimeout(parseTimer);
    applySource(source.value);
    await flush();
  }
  source.value = null;
}

/** The source view's text read back into the draft: its body, the fields in its front matter, and the text as typed. */
function applySource(text: string) {
  const draft = findDraft(currentId.value);
  if (!draft) {
    return;
  }
  const was = { ...draft.meta, ...pendingFor(draft.id).meta };
  const { meta, doc } = readSource(text, was);
  queueSave({ doc, sourceText: rememberSource(text, meta, doc) });
  if (!sameMeta(meta, was)) {
    updateMeta(meta);
  }
}

function changeSource(text: string) {
  source.value = text;
  window.clearTimeout(parseTimer);
  parseTimer = window.setTimeout(() => applySource(text), PARSE_DEBOUNCE_MS);
}

/** A field changed in the menu while the source view is open is written into its front matter; the body stays as typed. */
watch(
  () => current.value?.meta,
  (meta) => {
    const draft = findDraft(currentId.value);
    const kept = pendingFor(currentId.value).sourceText ?? (writingId === currentId.value ? writing.sourceText : undefined) ?? draft?.sourceText;
    if (source.value === null || !meta || !draft || keptFront(kept, meta)) {
      return;
    }
    // The text shows the field at once; reading it back, with any body edit still waiting, waits on the same debounce.
    changeSource(withFront(source.value, meta));
  },
);

async function selectDraft(id: string) {
  await settle();
  currentId.value = id;
}

async function deleteDraft(id: string) {
  const draft = findDraft(id);
  if (!draft || !window.confirm(`Delete "${draftLabel(draft)}"? This cannot be undone.`)) {
    return;
  }
  if (pendingId === id) {
    pending = {};
    pendingId = null;
  }
  if (draft.shareToken && draft.shareOwner) {
    void endShareRoom(draft.shareToken, draft.shareOwner).catch(() => undefined);
  }
  await draftStore.remove(id);
  const remaining = drafts.value.filter((item) => item.id !== id);
  drafts.value = remaining;
  if (remaining.length === 0) {
    const replacement = createDraft();
    await draftStore.put(replacement);
    drafts.value = [replacement];
    currentId.value = replacement.id;
  } else {
    currentId.value = remaining[0].id;
  }
}

function patchCurrent(next: Partial<Draft>) {
  drafts.value = drafts.value.map((item) => (item.id === currentId.value ? { ...item, ...next } : item));
}

function updateMeta(patch: Partial<PostMeta>) {
  const draft = findDraft(currentId.value);
  if (!draft) {
    return;
  }
  const meta = { ...draft.meta, ...pendingFor(draft.id).meta, ...patch };
  const next: Partial<Draft> = { meta };
  if (patch.title !== undefined) {
    next.title = patch.title;
    if (!draft.publishedPath && (!draft.slug || draft.slug === slugify(draft.meta.title))) {
      next.slug = slugify(patch.title);
    }
  }
  queueSave(next);
  patchCurrent(next);
}

/** The slug keeps a separator typed at its end until the next letter arrives, so `my-post` can be typed. */
function setSlug(typed: string) {
  const clean = slugify(typed);
  const slug = clean && /[^\p{L}\p{N}]$/u.test(typed) ? `${clean}-` : clean;
  queueSave({ slug });
  patchCurrent({ slug });
}

async function exportAs(formats: ExportFormat[]) {
  if (!current.value || formats.length === 0) {
    return;
  }
  exporting.value = true;
  try {
    await settle();
    const draft = findDraft(current.value.id) ?? current.value;
    const slug = draftSlug(draft);
    let html: string | null = null;
    const page = async () => (html ??= await buildHtmlDocument(docToHtml(draft.doc), draft.meta));

    const done: ExportFormat[] = [];
    const failed: string[] = [];
    for (const format of formats) {
      try {
        if (format === "markdown" || format === "copy") {
          const markdown = await markdownForExport(draft, settings.value);
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
        failed.push(`${LABELS[format]} — ${errorText(error, "failed")}`);
      }
    }

    if (failed.length) {
      showToast(failed.join("; "), "error");
    } else if (done.length === 1 && done[0] === "copy") {
      finished("copy", "Markdown copied to clipboard.");
    } else {
      finished("export", `Exported ${done.length} file${done.length === 1 ? "" : "s"}.`);
    }
  } catch (error) {
    showToast(errorText(error, "Export failed."), "error");
  } finally {
    exporting.value = false;
  }
}

async function enableShare() {
  shareTarget.value = true;
  shareError.value = null;
  try {
    await settle();
    const draft = findDraft(currentId.value);
    if (!draft) {
      return;
    }
    const update = (await loadShare()).seedUpdate(draft.doc);
    const { token, owner } = await createShareRoom(update);
    if (source.value !== null && currentId.value === draft.id) {
      await editRich();
    }
    queueSave({ shareToken: token, shareOwner: owner, shareSeed: update }, draft.id);
    await flush();
  } catch (cause) {
    shareError.value = errorText(cause);
  } finally {
    shareTarget.value = null;
  }
}

async function disableShare() {
  const draft = findDraft(currentId.value);
  const token = draft?.shareToken;
  if (!token) {
    return;
  }
  shareTarget.value = false;
  shareError.value = null;
  try {
    await endShareRoom(token, draft.shareOwner);
    queueSave({ shareToken: undefined, shareOwner: undefined, shareSeed: undefined }, draft.id);
    await flush();
  } catch (cause) {
    shareError.value = errorText(cause);
  } finally {
    shareTarget.value = null;
  }
}

/** On a copy joined through the link, the switch only leaves: the room stays live for the others. */
async function leaveSharedDraft() {
  shareTarget.value = false;
  shareError.value = null;
  try {
    queueSave({ shareToken: undefined, shareOwner: undefined, shareSeed: undefined });
    await flush();
  } finally {
    shareTarget.value = null;
  }
}

function renameShare(name: string) {
  shareName.value = name;
  saveParticipantName(name);
  if (session.value && shareRoom) {
    shareRoom.applyParticipantName(session.value, name);
  }
}

/**
 * The menu's Share button: turns shared editing on when it is off, and puts the link on the clipboard. The write
 * starts while the tap still counts, with the link to come, since Safari refuses a clipboard write made after the
 * room has been created.
 */
async function shareAndCopy() {
  if (findDraft(currentId.value)?.shareToken) {
    await copyShareLink("share");
    return;
  }
  const link = (async () => {
    await enableShare();
    const token = findDraft(currentId.value)?.shareToken;
    if (!token) {
      throw new Error("Not shared.");
    }
    return shareLink(token);
  })();
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      const text = link.then((value) => new Blob([value], { type: "text/plain" }));
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": text })]);
    } else {
      await navigator.clipboard.writeText(await link);
    }
    finished("share", "Shared — link copied.");
  } catch {
    if (findDraft(currentId.value)?.shareToken) {
      showToast("Shared. Copy the link from the Share section.");
    }
  }
}

async function copyShareLink(action: DoneAction = "link") {
  const token = findDraft(currentId.value)?.shareToken;
  if (!token) {
    return;
  }
  try {
    await navigator.clipboard.writeText(shareLink(token));
    finished(action, "Share link copied.");
  } catch {
    showToast("Could not reach the clipboard.", "error");
  }
}

function openMindmap() {
  const draft = findDraft(currentId.value);
  if (!draft) {
    return;
  }
  try {
    const doc = source.value !== null ? readSource(source.value, draft.meta).doc : (postEditor.value?.flush() ?? draft.doc);
    const meta = { ...draft.meta, ...pendingFor(draft.id).meta };
    window.open(mindmapUrl(doc, meta.title), "_blank", "noopener");
  } catch (cause) {
    showToast(errorText(cause, "Could not open the mindmap."), "error");
  }
}

function fixPhoto(src: string) {
  publishOpen.value = false;
  const image = [...document.querySelectorAll<HTMLImageElement>(".editor-host img")].find(
    (img) => img.dataset.localSrc === src || img.dataset.src === src,
  );
  const figure = image?.closest("figure") ?? image;
  figure?.scrollIntoView({ block: "center" });
  figure?.click();
}

/** Opens the menu with one of its sections in view, once the menu has drawn it. */
function openMenuAt(id: string) {
  menuOpen.value = true;
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "nearest" })),
  );
}

function editPost() {
  publishOpen.value = false;
  openMenuAt("menu-file");
}

/** The title and the description are in the menu: the dialog closes onto the field there. */
function fixField(field: "title" | "description") {
  publishOpen.value = false;
  openMenuAt("menu-file");
  window.setTimeout(() => document.getElementById(`meta-${field}`)?.focus({ preventScroll: true }), 80);
}

async function reopenFromSite(draft: Draft) {
  const path = draft.publishedPath;
  publishOpen.value = false;
  if (!path) {
    return;
  }
  const copy: Draft = { ...draft, publishedPath: undefined, publishedSha: undefined, publishedPrint: undefined, updatedAt: Date.now() };
  await storeDraft(copy);
  await importPost(path);
}

async function openPublish() {
  await settle();
  menuOpen.value = false;
  publishOpen.value = true;
}

/**
 * A publish repoints the draft: every `local:` photo it uploaded is renamed to
 * the address it was published at, so the next publish uploads nothing but
 * the Markdown. The tab that published keeps showing its own copy of each
 * photo until it is reloaded, since the site has not built them yet.
 */
async function onPublished(id: string, result: PublishResult, plan: PublishPlan) {
  const urls = plan.imageUrls;
  await Promise.all(
    [...urls].map(async ([local, url]) => {
      const shown = isLocalSrc(local) ? await resolveLocalSrc(local).catch(() => null) : previewSrc(local);
      if (shown) {
        showPublishedAs(url, shown);
      }
    }),
  );
  const published = {
    publishedPath: plan.markdownPath,
    publishedAt: Date.now(),
    publishedSha: result.shas[plan.markdownPath],
    publishedPrint: await printOf(plan.markdown),
  };

  if (id !== currentId.value) {
    // A change to it still waiting is written first, so it cannot later put back the photos' local addresses.
    await flush();
    const draft = findDraft(id);
    if (draft) {
      const next: Draft = {
        ...draft,
        ...published,
        doc: repointDoc(draft.doc, urls),
        meta: repointCover(draft.meta, urls),
        updatedAt: Date.now(),
      };
      await draftStore.put(next);
      drafts.value = sortDrafts(drafts.value.map((item) => (item.id === id ? next : item)));
    }
    return;
  }

  if (source.value !== null) {
    const text = [...urls].reduce((out, [local, url]) => out.split(local).join(url), source.value);
    if (text !== source.value) {
      changeSource(text);
    }
  } else {
    const doc = postEditor.value?.flush() ?? findDraft(id)?.doc;
    const repointed = doc ? repointDoc(doc, urls) : null;
    if (repointed && doc && JSON.stringify(repointed) !== JSON.stringify(doc)) {
      replaceDoc(repointed);
      if (session.value && shareRoom) {
        shareRoom.pushDoc(session.value, repointed);
      }
    }
  }
  const draft = findDraft(id);
  if (draft) {
    const meta = { ...draft.meta, ...pendingFor(id).meta };
    const repointed = repointCover(meta, urls);
    if (repointed !== meta) {
      updateMeta({ cover: repointed.cover });
    }
  }
  queueSave(published);
  await flush();
}

/** The dock fades while the writer types, and comes back when the mouse moves, a tap or click lands or the text loses focus. */
const dockIdle = ref(false);
/** Where the mouse was when typing began; a hand resting on it should not wake the dock. */
let restingAt: [number, number] | null = null;
const WAKE_PX = 6;

/**
 * Writing fades the dock: typed text, a deletion, a phone keyboard's word, dictation. A tool does not — the blog's
 * blocks are edited by hand and announced with an untrusted `input`, and the browser's own commands send no
 * `beforeinput` at all.
 */
function typing(event: InputEvent) {
  if (event.isTrusted && /^(?:insert|delete)/.test(event.inputType)) {
    dockIdle.value = true;
    restingAt = null;
  }
}

function wakeDock(event: PointerEvent) {
  if (!dockIdle.value) {
    return;
  }
  if (event.type === "pointermove") {
    if (event.pointerType !== "mouse") {
      return;
    }
    if (!restingAt) {
      restingAt = [event.clientX, event.clientY];
      return;
    }
    if (Math.hypot(event.clientX - restingAt[0], event.clientY - restingAt[1]) < WAKE_PX) {
      return;
    }
  }
  dockIdle.value = false;
}

function leftText(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
    dockIdle.value = false;
  }
}

function focusEnd(event: MouseEvent) {
  if (event.target === event.currentTarget) {
    event.preventDefault();
    postEditor.value?.focus();
  }
}

function openShareTab() {
  openMenuAt("menu-share");
}

const onKey = (event: KeyboardEvent) => {
  if (!(event.metaKey || event.ctrlKey)) {
    return;
  }
  if (event.key === "s") {
    event.preventDefault();
    void settle().then(() => showToast("Saved."));
  } else if (event.key === "\\") {
    event.preventDefault();
    menuOpen.value = !menuOpen.value;
  } else if (event.shiftKey && event.key.toLowerCase() === "n") {
    event.preventDefault();
    void newDraft();
  } else if (event.shiftKey && event.key.toLowerCase() === "c") {
    event.preventDefault();
    void exportAs(["copy"]);
  }
};

const scheme = window.matchMedia("(prefers-color-scheme: dark)");
const onScheme = () => {
  systemDark.value = scheme.matches;
};
const onLeave = (event: Event) => {
  if (event.type === "pagehide" || document.visibilityState === "hidden") {
    gather();
    if (writingId && writingId !== pendingId) {
      keepSnapshot(writingId, writing);
    }
    if (pendingId) {
      keepSnapshot(pendingId, { ...(writingId === pendingId ? writing : {}), ...pending });
    }
    void flush();
  }
};
const onNotice = (event: Event) => showToast((event as CustomEvent<string>).detail, "error");

onMounted(() => {
  document.addEventListener("keydown", onKey);
  document.addEventListener("pointermove", wakeDock, { passive: true });
  document.addEventListener("pointerdown", wakeDock, { passive: true });
  document.addEventListener("visibilitychange", onLeave);
  window.addEventListener("pagehide", onLeave);
  window.addEventListener(NOTICE, onNotice);
  scheme.addEventListener("change", onScheme);
  void boot().then(({ drafts: stored, settings: active, config: remote }) => {
    if (remote) {
      config.value = remote;
      settings.value = active;
    }
    setSiteUrl(active.siteUrl);
    drafts.value = stored;
    currentId.value = stored[0].id;
    ready.value = true;
    openRequested();
    preloadReader();
  });
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKey);
  document.removeEventListener("pointermove", wakeDock);
  document.removeEventListener("pointerdown", wakeDock);
  document.removeEventListener("visibilitychange", onLeave);
  window.removeEventListener("pagehide", onLeave);
  window.removeEventListener(NOTICE, onNotice);
  scheme.removeEventListener("change", onScheme);
});

</script>

<template>
  <div v-if="!ready || !current" class="empty">Loading…</div>
  <div v-else class="app" :data-focus="settings.focusMode">
    <DraftRail
      v-if="!settings.focusMode"
      :drafts="drafts"
      :current-id="currentId"
      @select="(id) => void selectDraft(id)"
      @new="() => void newDraft()"
      @rename="(title) => updateMeta({ title })"
      @delete="(id) => void deleteDraft(id)"
    />

    <div ref="mainRegion" class="main">
      <button
        v-if="settings.focusMode && !menuOpen"
        ref="focusButton"
        type="button"
        class="menu-btn"
        title="Menu — ⌘\"
        aria-label="Open menu"
        @click="menuOpen = true"
      >
        <Icon name="command" />
      </button>

      <TocBar
        v-if="tocOn"
        :entries="outline.entries.value"
        :active="outline.active.value"
        :scrolled="outline.scrolled.value"
        :title="current.meta.title"
        @pick="outline.go"
      />
      <div ref="scrollRegion" class="editor-scroll">
        <div :class="['editor-page', { 'has-toc': tocOn }]">
          <div class="editor-card">
            <div class="editor-body" @mousedown="focusEnd" @beforeinput="typing" @focusout="leftText">
              <textarea
                v-if="source !== null"
                class="source-editor"
                spellcheck="false"
                :value="source"
                @input="changeSource(($event.target as HTMLTextAreaElement).value)"
              />
              <PostEditor
                v-else
                :key="currentId ?? ''"
                ref="postEditor"
                :draft-id="currentId ?? ''"
                :doc="current.doc"
                :lang="current.meta.lang || 'en'"
                :dark="dark"
                :toolbar="!settings.focusMode"
                @change="onEditorChange"
              />
            </div>

            <div v-if="!settings.focusMode" :class="['card-dock', { 'is-idle': dockIdle && !menuOpen }]">
              <div v-show="source === null" id="dock-tools" class="dock-tools" />
              <span v-if="source !== null" class="hint source-note">The post as a Markdown file, front matter and all</span>
              <button
                type="button"
                :class="['tool mode-toggle', { 'is-active': source !== null }]"
                :title="
                  session
                    ? 'The Markdown source sits out while the draft is shared'
                    : source === null
                      ? 'Edit the Markdown source'
                      : 'Back to the page view'
                "
                :aria-pressed="source !== null"
                :disabled="Boolean(session)"
                @click="source === null ? void editSource() : void editRich()"
              >
                <span class="tool-text">MD</span>
              </button>
              <button
                v-if="session"
                type="button"
                class="tool share-me"
                title="Shared editing — tap to change your name"
                aria-label="Change your name in the shared draft"
                @click="openShareTab"
              >
                <span class="share-dot" :style="{ background: participantColor(displayName) }" />
                <span class="tool-text share-me-name">{{ displayName }}</span>
              </button>
              <span :class="['status', { 'is-saving': saveState === 'saving' }]">
                {{ saveState === "saving" ? "Saving…" : `${words} words` }}
              </span>
              <span class="tool-sep" />
              <button
                ref="menuButton"
                type="button"
                :class="['tool', { 'is-active': menuOpen }]"
                title="Menu — ⌘\"
                aria-label="Open menu"
                :aria-expanded="menuOpen"
                @click="menuOpen = !menuOpen"
              >
                <Icon name="command" />
              </button>
            </div>
          </div>
          <TocAside v-if="tocOn" :entries="outline.entries.value" :active="outline.active.value" @pick="outline.go" />
        </div>
      </div>
    </div>

    <EditorPopover
      :open="menuOpen"
      :anchor="anchor"
      :region="mainRegion"
      :meta="current.meta"
      :slug="current.slug"
      :settings="settings"
      :share="shareState"
      :exporting="exporting"
      :done="justDone"
      :escape-closes="!publishOpen"
      @close="menuOpen = false"
      @meta="updateMeta"
      @slug="setSlug"
      @settings="updateSettings"
      @share-name="renameShare"
      @share="() => void shareAndCopy()"
      @share-copy="() => void copyShareLink()"
      @share-disable="() => void (current?.shareOwner ? disableShare() : leaveSharedDraft())"
      @publish="() => void openPublish()"
      @site="(path) => ((menuOpen = false), void importPost(path))"
      @pinned="(written) => void onPinned(written)"
      @mindmap="openMindmap"
      @export="(formats) => void exportAs(formats)"
    />

    <PublishDialog
      v-if="publishOpen"
      :draft="current"
      :settings="settings"
      :config="config"
      @settings="updateSettings"
      @close="publishOpen = false"
      @published="(id, result, plan) => void onPublished(id, result, plan)"
      @fix-photo="fixPhoto"
      @edit-post="editPost"
      @fix-field="fixField"
      @reopen="() => void reopenFromSite(current!)"
    />

    <div v-if="toast" :class="['toast', { error: toast.kind === 'error' }]" role="status">
      {{ toast.message }}
      <a v-if="toast.href" :href="toast.href" target="_blank" rel="noreferrer">View →</a>
    </div>
  </div>
</template>
