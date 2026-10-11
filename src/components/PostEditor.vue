<script setup lang="ts">
import { Editor, type EditorInstance } from "@erag/text-editor-vue";
import "@erag/text-editor-vue/style.css";
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { docToHtml, htmlToDoc } from "../editor/bridge.ts";
import {
  askLink,
  editCaption,
  insertImages,
  leaveGallery,
  moveGalleryPhoto,
  notify,
  removeGalleryPhoto,
  selectFigure,
  setImageText,
  toggleSection,
  toggleTask,
} from "../editor/commands.ts";
import { editorInit } from "../editor/config.ts";
import { decorate, Previews, releasePhotos } from "../editor/decorate.ts";
import type { JSONContent } from "../editor/doc.ts";
import { handleInput, handleKeydown } from "../editor/keys.ts";
import { pasteClipboard } from "../editor/paste.ts";
import { emptyTools, readTools, type ToolState } from "../editor/tools.ts";
import SelectionBubble from "./SelectionBubble.vue";
import Toolbar from "./Toolbar.vue";

const props = defineProps<{ doc: JSONContent; lang: string; dark: boolean; toolbar: boolean }>();
const emit = defineEmits<{ change: [doc: JSONContent] }>();

const EMIT_DEBOUNCE_MS = 150;
/** The width of the margin a task's box is drawn in, left of its text. */
const TASK_BOX_PX = 24;

const editor = ref<EditorInstance | null>(null);
const root = shallowRef<HTMLElement | null>(null);
const html = ref(docToHtml(props.doc));
const tools = ref<ToolState>(emptyTools());
const previews = new Previews();

let epoch = 0;
let timer: number | undefined;
let frame = 0;
let pending: string | null = null;
let toolsFrame = 0;

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

/** The draft as the editor holds it now; also sends any change still waiting on the debounce. */
function flush(): JSONContent {
  window.clearTimeout(timer);
  const doc = currentDoc();
  if (pending !== null) {
    pending = null;
    emit("change", doc);
  }
  return doc;
}

/** The draft, if it holds an edit not yet sent out; the edit then counts as sent. */
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

/** Replaces the content without it counting as an edit: a repointed photo, a change from the shared room. */
function setDoc(doc: JSONContent): void {
  epoch += 1;
  pending = null;
  window.clearTimeout(timer);
  html.value = docToHtml(doc);
  void nextTick(redecorate);
}

function onReady(element: HTMLElement): void {
  root.value = element;
  document.execCommand("defaultParagraphSeparator", false, "p");
  element.setAttribute("lang", props.lang);
  element.addEventListener("paste", onPaste, true);
  element.addEventListener("drop", onDrop, true);
  element.addEventListener("mousedown", onMousedown);
  element.addEventListener("keydown", onShortcut, true);
  decorate(element, previews, props.dark);
}

/**
 * ⌘K is the app's link prompt. ⌘F and ⌘⇧P would open the editor's own find and preview dialogs, which the app does
 * not use: they are kept from it, so ⌘F reaches the browser's find.
 */
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

/**
 * A selected gallery photo holds the focus, so its keys are its own: Delete removes it, ⌥← and ⌥→ move it, and a
 * character or Enter leaves the gallery for the paragraph after it, the character typed there.
 */
function onKeydown(event: KeyboardEvent): void {
  const element = root.value;
  if (!element) {
    return;
  }
  const target = event.target as Element;
  const photo = target.matches(".is-selected[data-image]") && target.closest("[data-gallery]");
  const step = event.altKey ? ({ ArrowLeft: -1, ArrowRight: 1 } as const)[event.key as "ArrowLeft"] : undefined;
  if (photo && (event.key === "Backspace" || event.key === "Delete" || step)) {
    event.preventDefault();
    editPhoto(step ?? 0);
    return;
  }
  if (photo && (event.key.length === 1 || event.key === "Enter") && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    run(leaveGallery);
    if (event.key !== "Enter") {
      document.execCommand("insertText", false, event.key);
    }
    return;
  }
  handleKeydown(element, event);
}

/** Moves the selected gallery photo back (-1) or on (1), or removes it (0). */
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
  if (figure?.closest("[data-gallery]")) {
    figure.focus({ preventScroll: true });
  }
  refreshTools();
}

/** A gallery photo's caption is the alt text its card shows; any other photo's is the line written under it. */
function photoTool(element: HTMLElement, button: Element): void {
  const figure = button.closest<HTMLElement>("figure[data-image]");
  const img = figure?.querySelector("img");
  if (!figure || !img) {
    return;
  }
  const gallery = figure.closest("[data-gallery]");
  if (button.classList.contains("editor-image-edit")) {
    selectFigure(element, figure);
    editPhoto(button.textContent === "←" ? -1 : button.textContent === "→" ? 1 : 0);
  } else if (!button.classList.contains("editor-image-caption") || gallery) {
    const value = window.prompt(
      gallery ? "Caption, shown on the card" : "Alt text (describes the image)",
      (gallery && img.getAttribute("title")) || (img.getAttribute("alt") ?? ""),
    );
    if (value !== null) {
      setImageText(element, figure, value);
    }
  } else {
    editCaption(element, figure);
  }
  decorate(element, previews, props.dark);
}

/** The controls drawn inside the text — a section's toggle, a photo's tools, a task's box — must not move the caret. */
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
  const task = target.closest<HTMLElement>("li[data-checked]");
  if (task && task === target && event.clientX - task.getBoundingClientRect().left < TASK_BOX_PX) {
    event.preventDefault();
    toggleTask(element, task);
  }
}

function imageFiles(list: FileList | DataTransferItemList | null | undefined): File[] {
  const files: File[] = [];
  for (const entry of Array.from((list ?? []) as ArrayLike<File | DataTransferItem>)) {
    const file = "getAsFile" in entry ? entry.getAsFile() : entry;
    if (file?.type.startsWith("image/")) {
      files.push(file);
    }
  }
  return files;
}

function addImages(files: File[]): void {
  const element = root.value;
  if (!element || !files.length) {
    return;
  }
  const mine = epoch;
  void insertImages(element, files, () => mine === epoch && element.isConnected).catch((error: unknown) => {
    window.alert(
      `Could not store the image${files.length === 1 ? "" : "s"}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}

function onPaste(event: ClipboardEvent): void {
  const files = imageFiles(event.clipboardData?.items);
  if (files.length) {
    event.preventDefault();
    event.stopImmediatePropagation();
    addImages(files);
  } else {
    pasteClipboard(event);
  }
}

function onDrop(event: DragEvent): void {
  const files = imageFiles(event.dataTransfer?.files);
  if (!files.length) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  const element = root.value;
  const target = event.target as Element;
  const photo =
    target.closest<HTMLElement>("[data-gallery] figure[data-image]") ??
    target.closest("[data-gallery]")?.querySelector<HTMLElement>("figure[data-image]:last-child");
  if (element) {
    selectFigure(element, photo ?? null);
  }
  const caret = !photo && document.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (caret) {
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(caret);
  }
  addImages(files);
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

onMounted(() => document.addEventListener("selectionchange", refreshTools));
onBeforeUnmount(() => {
  document.removeEventListener("selectionchange", refreshTools);
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
    <Toolbar :tools="tools" :run="run" @images="addImages" />
  </Teleport>
</template>
