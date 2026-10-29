<script setup lang="ts">
import { Editor, type EditorInstance } from "@erag/text-editor-vue";
import "@erag/text-editor-vue/style.css";
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { docToHtml, htmlToDoc } from "../editor/bridge.ts";
import { clipboardOf, copiedBlocks, MEDIA, rememberCopy } from "../editor/clipboard.ts";
import {
  askLink,
  captionOf,
  continueAfter,
  type DropSpot,
  embedLater,
  insertDoc,
  insertImages,
  leaveGallery,
  moveBlock,
  moveGalleryPhoto,
  notify,
  placeCaret,
  removeGalleryPhoto,
  replaceEmbed,
  selectedFigure,
  selectFigure,
  selectionIn,
  setImageAlt,
  setImageCaption,
  toggleSection,
  toggleTask,
} from "../editor/commands.ts";
import { dropSpot, markSpot } from "../editor/drag.ts";
import { embedField, mergeExtra } from "../editor/blog.ts";
import { editorInit } from "../editor/config.ts";
import { decorate, Previews, releasePhotos } from "../editor/decorate.ts";
import type { JSONContent } from "../editor/doc.ts";
import { handleInput, handleKeydown } from "../editor/keys.ts";
import { pasteClipboard } from "../editor/paste.ts";
import { emptyTools, readTools, type ToolState } from "../editor/tools.ts";
import SelectionBubble from "./SelectionBubble.vue";
import Toolbar from "./Toolbar.vue";
import { useVideoUploads, type VideoSource } from "./useVideoUploads.ts";

const props = defineProps<{
  doc: JSONContent;
  draftId: string;
  lang: string;
  dark: boolean;
  toolbar: boolean;
  onUploaded?: (url: string, draftId: string) => void;
}>();
const emit = defineEmits<{ change: [doc: JSONContent, draftId: string] }>();

const EMIT_DEBOUNCE_MS = 150;
const TASK_BOX_PX = 24;

const editor = ref<EditorInstance | null>(null);
const root = shallowRef<HTMLElement | null>(null);
const html = ref(docToHtml(props.doc));
const tools = ref<ToolState>(emptyTools());
const previews = new Previews();
const videos = useVideoUploads();

let epoch = 0;
let timer: number | undefined;
let frame = 0;
let pending: string | null = null;
let toolsFrame = 0;
let dragged: HTMLElement | null = null;
const dropMark = document.createElement("div");
dropMark.className = "drop-mark";
dropMark.hidden = true;

function refreshTools(): void {
  window.cancelAnimationFrame(toolsFrame);
  toolsFrame = window.requestAnimationFrame(() => {
    if (root.value) {
      tools.value = readTools(root.value);
    }
  });
}

function redecorate(): void {
  window.cancelAnimationFrame(frame);
  frame = window.requestAnimationFrame(() => {
    if (root.value) {
      decorate(root.value, previews, props.dark);
    }
  });
}

function currentDoc(): JSONContent {
  return htmlToDoc(editor.value?.getHtml() ?? html.value);
}

function flush(): JSONContent {
  window.clearTimeout(timer);
  const doc = currentDoc();
  if (pending !== null) {
    pending = null;
    emit("change", doc, props.draftId);
  }
  return doc;
}

function takeUnsent(): JSONContent | null {
  if (pending === null) {
    return null;
  }
  pending = null;
  window.clearTimeout(timer);
  return currentDoc();
}

function onHtml(value: string): void {
  html.value = value;
  pending = value;
  window.clearTimeout(timer);
  timer = window.setTimeout(flush, EMIT_DEBOUNCE_MS);
  redecorate();
}

function setDoc(doc: JSONContent): void {
  epoch += 1;
  pending = null;
  window.clearTimeout(timer);
  html.value = docToHtml(doc);
  void nextTick(redecorate);
}

function onReady(element: HTMLElement): void {
  root.value = element;
  openEditors.set(props.draftId, element);
  document.execCommand("defaultParagraphSeparator", false, "p");
  element.setAttribute("lang", props.lang);
  element.addEventListener("paste", onPaste, true);
  element.addEventListener("dragstart", onDragStart, true);
  element.addEventListener("dragover", onDragOver, true);
  element.addEventListener("dragleave", onDragLeave, true);
  element.addEventListener("dragend", endDrag, true);
  element.addEventListener("drop", onDrop, true);
  element.addEventListener("mousedown", onMousedown);
  element.addEventListener("keydown", onShortcut, true);
  element.addEventListener("compositionstart", onCompositionStart, true);
  decorate(element, previews, props.dark);
}

function onShortcut(event: KeyboardEvent): void {
  if (!(event.metaKey || event.ctrlKey) || !root.value) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key === "k") {
    event.preventDefault();
    event.stopPropagation();
    run(askLink);
  } else if (key === "f" || (key === "p" && event.shiftKey)) {
    event.stopPropagation();
  }
}

function onKeydown(event: KeyboardEvent): void {
  const element = root.value;
  if (!element) {
    return;
  }
  const target = event.target as Element;
  const selected = target.matches(".is-selected[data-image]") ? (target as HTMLElement) : null;
  const photo = selected?.closest("[data-gallery]");
  const step = event.altKey ? ({ ArrowLeft: -1, ArrowRight: 1 } as const)[event.key as "ArrowLeft"] : undefined;
  if (selected && (event.key === "Backspace" || event.key === "Delete" || (photo && step))) {
    event.preventDefault();
    if (photo) {
      editPhoto(step ?? 0);
    } else {
      removePhoto(element, selected);
    }
    return;
  }
  if (selected && (event.isComposing || event.key === "Unidentified" || event.key === "Process")) {
    leavePhoto(element, selected);
    return;
  }
  if (selected && (event.key.length === 1 || event.key === "Enter") && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    leavePhoto(element, selected);
    if (event.key !== "Enter") {
      document.execCommand("insertText", false, event.key);
    }
    return;
  }
  handleKeydown(element, event);
}

function withCaption(figure: HTMLElement): Element {
  return captionOf(figure) ?? figure;
}

function leavePhoto(element: HTMLElement, figure: HTMLElement): void {
  if (figure.closest("[data-gallery]")) {
    run(leaveGallery);
    return;
  }
  selectFigure(element, null);
  element.focus({ preventScroll: true });
  continueAfter(withCaption(figure), true);
  notify(element);
}

function removePhoto(element: HTMLElement, figure: HTMLElement): void {
  const paragraph = document.createElement("p");
  paragraph.append(document.createElement("br"));
  const caption = withCaption(figure);
  if (caption !== figure) {
    caption.remove();
  }
  figure.replaceWith(paragraph);
  selectFigure(element, null);
  element.focus({ preventScroll: true });
  placeCaret(paragraph);
  notify(element);
}

function onCompositionStart(event: CompositionEvent): void {
  const target = event.target as HTMLElement;
  if (target.matches(".is-selected[data-image]") && root.value) {
    leavePhoto(root.value, target);
  }
}

function editPhoto(step: -1 | 0 | 1): void {
  run((root) => (step ? moveGalleryPhoto(root, step) : removeGalleryPhoto(root)));
}

function onInput(event: InputEvent): void {
  if (root.value) {
    handleInput(root.value, event);
  }
}

function onClick(event: MouseEvent): void {
  const element = root.value;
  if (!element) {
    return;
  }
  const target = event.target as Element;
  if (target.closest(".editor-image-tools")) {
    return;
  }
  const figure = target.closest<HTMLElement>("figure[data-image]");
  selectFigure(element, figure && element.contains(figure) ? figure : null);
  figure?.focus({ preventScroll: true });
  refreshTools();
}

function photoTool(element: HTMLElement, button: Element): void {
  const figure = button.closest<HTMLElement>("figure[data-image]");
  const img = figure?.querySelector("img");
  if (!figure || !img) {
    return;
  }
  if (button.classList.contains("editor-image-edit")) {
    selectFigure(element, figure);
    editPhoto(Number((button as HTMLElement).dataset.step) as -1 | 0 | 1);
  } else if (!button.classList.contains("editor-image-caption")) {
    const value = window.prompt("Alt text — describes the photo and names its file", img.getAttribute("alt") ?? "");
    if (value !== null) {
      setImageAlt(element, figure, value);
    }
  } else {
    const value = window.prompt("Caption, shown under the photo", img.getAttribute("title") ?? "");
    if (value !== null) {
      setImageCaption(element, figure, value);
    }
  }
  redecorate();
}

function onMousedown(event: MouseEvent): void {
  const element = root.value;
  const target = event.target as Element;
  if (!element) {
    return;
  }
  const section = target.closest(".collapsible-toggle")?.closest<HTMLElement>("[data-collapsible]");
  if (section) {
    event.preventDefault();
    toggleSection(section);
    decorate(element, previews, props.dark);
    notify(element);
    return;
  }
  const photoButton = target.closest(".editor-image-tools button");
  if (photoButton) {
    event.preventDefault();
    photoTool(element, photoButton);
    return;
  }
  const tool = target.closest<HTMLElement>(".editor-embed-replace");
  const replace = tool?.closest<HTMLElement>("[data-embed]");
  if (tool && replace) {
    event.preventDefault();
    if (tool.classList.contains("editor-embed-convert")) {
      addVideos([{ dropbox: replace.getAttribute("data-id") ?? "" }], null, replace);
    } else {
      pickVideo((file) => addVideos([file], null, replace));
    }
    return;
  }
  const task = target.closest<HTMLElement>("li[data-checked]");
  if (task && task === target && event.clientX - task.getBoundingClientRect().left < TASK_BOX_PX) {
    event.preventDefault();
    toggleTask(element, task);
  }
}

function filesOf(list: FileList | DataTransferItemList | null | undefined, kind: "image/" | "video/"): File[] {
  const files: File[] = [];
  for (const entry of Array.from((list ?? []) as ArrayLike<File | DataTransferItem>)) {
    const file = "getAsFile" in entry ? entry.getAsFile() : entry;
    if (file?.type.startsWith(kind)) {
      files.push(file);
    }
  }
  return files;
}

function pickVideo(picked: (file: File) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "video/*";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) {
      picked(file);
    }
  };
  input.click();
}

function addVideos(sources: VideoSource[], spot: DropSpot | null = null, replacing: HTMLElement | null = null): void {
  const element = root.value;
  if (!element) {
    return;
  }
  const draft = props.draftId;
  const replaced = replacing?.getAttribute("data-id") ?? "";
  for (const source of sources) {
    const put = embedLater(element, spot);
    videos.add(source, (embed, sent) => {
      if (sent) {
        props.onUploaded?.(embed.id, draft);
      }
      const here = element.isConnected && props.draftId === draft ? element : openEditors.get(draft);
      if (!here) {
        return false;
      }
      const old = here === element ? replacing : here.querySelector<HTMLElement>(`[data-embed][data-id="${CSS.escape(replaced)}"]`);
      if (!replacing) {
        (here === element ? put : embedLater(here))(embed);
        return true;
      }
      if (!old) {
        return false;
      }
      const fields = { ...Object.fromEntries(["poster", "width", "height"].map((name) => [name, embedField(embed.extra, name)])), types: null };
      return replaceEmbed(here, old, { ...embed, extra: mergeExtra(old.getAttribute("data-extra") ?? "", fields) });
    }, draft);
  }
}

function addImages(files: File[], spot: DropSpot | null = null): void {
  const element = root.value;
  if (!element || !files.length) {
    return;
  }
  const mine = epoch;
  void insertImages(element, files, () => mine === epoch && element.isConnected, spot).catch((error: unknown) => {
    window.alert(
      `Could not store the image${files.length === 1 ? "" : "s"}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}

function onPaste(event: ClipboardEvent): void {
  const own = copiedBlocks(event.clipboardData?.getData("text/html") ?? "", event.clipboardData?.getData("text/plain") ?? "");
  if (own) {
    event.preventDefault();
    event.stopImmediatePropagation();
    run((element) => insertDoc(element, own));
    return;
  }
  const files = filesOf(event.clipboardData?.items, "image/");
  const clips = filesOf(event.clipboardData?.items, "video/");
  if (files.length || clips.length) {
    event.preventDefault();
    event.stopImmediatePropagation();
    addImages(files);
    addVideos(clips);
  } else {
    pasteClipboard(event);
  }
}

function holds(range: Range, node: Node): boolean {
  const parent = node.parentNode;
  if (!parent) {
    return false;
  }
  const index = Array.prototype.indexOf.call(parent.childNodes, node) as number;
  return range.comparePoint(parent, index) === 0 && range.comparePoint(parent, index + 1) === 0;
}

function onClipboard(event: ClipboardEvent): void {
  const element = root.value;
  if (!element || !event.clipboardData) {
    return;
  }
  const figure = selectedFigure(element);
  const range = selectionIn(element);
  const photo = figure && document.activeElement === figure ? figure : null;
  const media = !photo && range && !range.collapsed && [...element.querySelectorAll(MEDIA)].some((node) => holds(range, node));
  if (!photo && !media) {
    rememberCopy(document.getSelection()?.toString() ?? "");
    return;
  }
  const caption = photo && captionOf(photo);
  const copied = photo ? (caption ? [photo, caption] : [photo]) : [range!.cloneContents()];
  const { html, text } = clipboardOf(copied);
  event.clipboardData.setData("text/html", html);
  event.clipboardData.setData("text/plain", text);
  event.preventDefault();
  if (event.type !== "cut") {
    return;
  }
  if (photo?.closest("[data-gallery]")) {
    editPhoto(0);
  } else if (photo) {
    removePhoto(element, photo);
  } else {
    document.execCommand("delete");
  }
}

function onDragStart(event: DragEvent): void {
  const element = root.value;
  const target = event.target instanceof Element ? event.target : null;
  const handle = target?.closest<HTMLElement>("figure[data-image], .editor-gallery-label");
  if (!element || !handle || !event.dataTransfer || target?.closest(".editor-image-tools")) {
    return;
  }
  dragged = handle.matches("[data-image]") ? handle : handle.closest<HTMLElement>("[data-gallery]");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", "");
}

function onDragOver(event: DragEvent): void {
  const element = root.value;
  if (!element || !event.dataTransfer || (!dragged && !event.dataTransfer.types.includes("Files"))) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  event.dataTransfer.dropEffect = dragged ? "move" : "copy";
  markSpot(dropMark, dropSpot(element, event.clientX, event.clientY, dragged));
}

function onDragLeave(event: DragEvent): void {
  if (!root.value?.contains(event.relatedTarget as Node | null)) {
    dropMark.hidden = true;
  }
}

function endDrag(): void {
  dragged = null;
  dropMark.hidden = true;
}

function onDrop(event: DragEvent): void {
  const element = root.value;
  if (!element) {
    return;
  }
  const spot = dropSpot(element, event.clientX, event.clientY, dragged);
  const moving = dragged;
  endDrag();
  if (moving) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (spot) {
      run((root) => moveBlock(root, moving, spot));
    }
    return;
  }
  const files = filesOf(event.dataTransfer?.files, "image/");
  const clips = filesOf(event.dataTransfer?.files, "video/");
  if (!files.length && !clips.length) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  selectFigure(element, null);
  addImages(files, spot);
  addVideos(clips, spot);
}

function run(command: (element: HTMLElement) => unknown): void {
  const element = root.value;
  if (!element) {
    return;
  }
  command(element);
  refreshTools();
}

watch(
  () => props.lang,
  (lang) => root.value?.setAttribute("lang", lang),
);
watch(
  () => props.dark,
  () => redecorate(),
);

onMounted(() => {
  document.addEventListener("selectionchange", refreshTools);
  document.addEventListener("copy", onClipboard);
  document.addEventListener("cut", onClipboard);
  document.body.append(dropMark);
});
onBeforeUnmount(() => {
  if (openEditors.get(props.draftId) === root.value) {
    openEditors.delete(props.draftId);
  }
  document.removeEventListener("selectionchange", refreshTools);
  document.removeEventListener("copy", onClipboard);
  document.removeEventListener("cut", onClipboard);
  dropMark.remove();
  window.cancelAnimationFrame(frame);
  window.cancelAnimationFrame(toolsFrame);
  queueMicrotask(releasePhotos);
  if (pending !== null) {
    flush();
  }
  previews.clear();
});

defineExpose({
  root,
  flush,
  takeUnsent,
  setDoc,
  focus: () => editor.value?.focus(),
});
</script>

<script lang="ts">
const openEditors = new Map<string, HTMLElement>();
</script>

<template>
  <div class="editor-host">
    <Editor
      ref="editor"
      :model-value="html"
      :init="editorInit"
      aria-label="Post body"
      @update:model-value="onHtml"
      @ready="onReady"
      @keydown="onKeydown"
      @input="onInput"
      @click="onClick"
    />
  </div>
  <SelectionBubble :root="root" :tools="tools" :run="run" />
  <Teleport v-if="toolbar" defer to="#dock-tools">
    <Toolbar :tools="tools" :run="run" @images="addImages" @videos="addVideos" />
  </Teleport>

</template>
