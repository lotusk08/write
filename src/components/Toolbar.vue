<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { embedFromUrl } from "../editor/blog.ts";
import {
  askLink,
  format,
  insertEmbed,
  insertFootnote,
  insertRule,
  insertTable,
  setAllCollapsibles,
  setCollapsible,
  setGallery,
  setNote,
  toggleCodeBlock,
  toggleFilepath,
  toggleHeading,
  toggleInline,
  toggleList,
  togglePlainQuote,
  unsetCollapsible,
  unsetGallery,
} from "../editor/commands.ts";
import type { ToolState } from "../editor/tools.ts";
import NoteMenu from "./NoteMenu.vue";
import ToolButton from "./ToolButton.vue";

const props = defineProps<{ tools: ToolState; run: (command: (root: HTMLElement) => unknown) => void }>();
const emit = defineEmits<{ images: [files: File[]] }>();

const EDGE_SLACK = 2;

const row = ref<HTMLDivElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

/** Fades whichever end of the row has tools scrolled out of sight. */
const sync = () => {
  const element = row.value;
  if (!element) {
    return;
  }
  const hidden = element.scrollWidth - element.clientWidth;
  const start = element.scrollLeft > EDGE_SLACK;
  const end = element.scrollLeft < hidden - EDGE_SLACK;
  element.dataset.more = start && end ? "both" : start ? "start" : end ? "end" : "none";
};
let observer: ResizeObserver | null = null;
onMounted(() => {
  sync();
  row.value?.addEventListener("scroll", sync, { passive: true });
  observer = new ResizeObserver(sync);
  if (row.value) {
    observer.observe(row.value);
  }
});
onBeforeUnmount(() => {
  row.value?.removeEventListener("scroll", sync);
  observer?.disconnect();
});

const embed = () => {
  const url = window.prompt(
    "Video, post or song URL (YouTube, X, Spotify)",
    "https://www.youtube.com/watch?v=",
  );
  if (!url) {
    return;
  }
  const found = embedFromUrl(url);
  if (!found) {
    window.alert(`Could not find a video id in: ${url}`);
    return;
  }
  props.run((root) => insertEmbed(root, found));
};

const pickFiles = (event: Event) => {
  const input = event.target as HTMLInputElement;
  emit("images", Array.from(input.files ?? []));
  input.value = "";
};
</script>

<template>
  <div ref="row" class="toolbar" role="toolbar" aria-label="Formatting">
    <div class="tool-group">
      <ToolButton
        v-for="level in [2, 3, 4]"
        :key="level"
        :label="`H${level}`"
        :title="`Heading ${level}`"
        :active="tools.heading === level"
        @press="run((root) => toggleHeading(root, level))"
      />
    </div>

    <span class="tool-sep" />

    <div class="tool-group">
      <ToolButton icon="bold" title="Bold — ⌘B" :active="tools.bold" @press="run((root) => format(root, 'bold'))" />
      <ToolButton icon="italic" title="Italic — ⌘I" :active="tools.italic" @press="run((root) => format(root, 'italic'))" />
      <ToolButton icon="strike" title="Strikethrough" :active="tools.strike" @press="run((root) => format(root, 'strikeThrough'))" />
      <ToolButton icon="highlight" title="Highlight" :active="tools.highlight" @press="run((root) => toggleInline(root, 'mark'))" />
      <ToolButton
        icon="superscript"
        title="Superscript — m²"
        :active="tools.superscript"
        @press="run((root) => format(root, 'superscript'))"
      />
      <ToolButton icon="subscript" title="Subscript — H₂O" :active="tools.subscript" @press="run((root) => format(root, 'subscript'))" />
      <ToolButton
        icon="code"
        title="Inline code"
        :active="tools.code && !tools.filepath"
        @press="run((root) => toggleInline(root, 'code'))"
      />
      <ToolButton icon="file" title="File path — the blog's {: .filepath}" :active="tools.filepath" @press="run(toggleFilepath)" />
      <ToolButton icon="link" title="Link" :active="tools.link" @press="run(askLink)" />
      <ToolButton icon="footnote" title="Footnote — marker here, note at the end" @press="run(insertFootnote)" />
    </div>

    <span class="tool-sep" />

    <div class="tool-group">
      <ToolButton icon="bulletList" title="Bullet list" :active="tools.list === 'bullet'" @press="run((root) => toggleList(root, 'bullet'))" />
      <ToolButton
        icon="orderedList"
        title="Numbered list"
        :active="tools.list === 'ordered'"
        @press="run((root) => toggleList(root, 'ordered'))"
      />
      <ToolButton icon="taskList" title="Task list" :active="tools.list === 'task'" @press="run((root) => toggleList(root, 'task'))" />
      <ToolButton icon="quote" title="Quote — ⌘⇧B, or type >" :active="tools.quote && !tools.note" @press="run(togglePlainQuote)" />
      <NoteMenu :note="tools.note" @note="(note) => run((root) => setNote(root, note))" />
      <ToolButton icon="codeBlock" title="Code block" :active="tools.codeBlock" @press="run(toggleCodeBlock)" />
    </div>

    <span class="tool-sep" />

    <div class="tool-group">
      <ToolButton
        icon="section"
        title="Collapsible section — ⌘⇧D, or type >>>"
        :active="tools.collapsible"
        @press="run((root) => (tools.collapsible ? unsetCollapsible(root) : setCollapsible(root)))"
      />
      <ToolButton icon="collapseAll" title="Collapse every section" @press="run((root) => setAllCollapsibles(root, false))" />
      <ToolButton icon="expandAll" title="Expand every section" @press="run((root) => setAllCollapsibles(root, true))" />
    </div>

    <span class="tool-sep" />

    <div class="tool-group">
      <ToolButton icon="image" title="Insert image" @press="fileInput?.click()" />
      <ToolButton
        icon="gallery"
        title="Gallery — several photos in one frame"
        :active="tools.gallery"
        :disabled="!tools.canGallery"
        @press="run(tools.gallery ? unsetGallery : setGallery)"
      />
      <ToolButton icon="video" title="Embed a video — YouTube, X, Spotify…" @press="embed" />
      <ToolButton icon="table" title="Insert table" @press="run((root) => insertTable(root))" />
      <ToolButton icon="rule" title="Divider" @press="run(insertRule)" />
    </div>

    <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="pickFiles" />
  </div>
</template>
