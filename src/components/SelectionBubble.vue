<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { askLink, format, selectionIn, toggleInline } from "../editor/commands.ts";
import type { ToolState } from "../editor/tools.ts";
import { viewportBand } from "../lib/viewport.ts";
import Icon from "./Icon.vue";
import type { IconName } from "./icons.ts";

const props = defineProps<{
  root: HTMLElement | null;
  tools: ToolState;
  run: (command: (root: HTMLElement) => unknown) => void;
}>();

const GAP = 8;
const EDGE = 8;

const bubble = ref<HTMLDivElement | null>(null);
const shown = ref(false);

/** Over selected text only: over a selected photo or gallery there is nothing to format. */
function selectedText(): Range | null {
  const root = props.root;
  const range = root ? selectionIn(root) : null;
  if (!range || range.collapsed || !range.toString().trim()) {
    return null;
  }
  const start = range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement;
  return start?.closest("figure, [data-embed]") ? null : range;
}

async function place() {
  const range = selectedText();
  shown.value = Boolean(range);
  if (!range) {
    return;
  }
  await nextTick();
  const element = bubble.value;
  if (!element) {
    return;
  }
  const rect = range.getBoundingClientRect();
  const band = viewportBand();
  const box = element.getBoundingClientRect();
  const above = rect.top - GAP - box.height;
  const top = above >= band.top + EDGE ? above : Math.min(rect.bottom + GAP, band.bottom - EDGE - box.height);
  const left = Math.max(band.left + EDGE, Math.min(rect.left + rect.width / 2 - box.width / 2, band.right - EDGE - box.width));
  element.style.top = `${Math.round(top)}px`;
  element.style.left = `${Math.round(left)}px`;
}

let frame = 0;
const follow = () => {
  window.cancelAnimationFrame(frame);
  frame = window.requestAnimationFrame(() => void place());
};

onMounted(() => {
  document.addEventListener("selectionchange", follow);
  window.addEventListener("scroll", follow, true);
  window.addEventListener("resize", follow);
});
onBeforeUnmount(() => {
  window.cancelAnimationFrame(frame);
  document.removeEventListener("selectionchange", follow);
  window.removeEventListener("scroll", follow, true);
  window.removeEventListener("resize", follow);
});

const buttons: { icon: IconName; label: string; active: () => boolean; press: () => void }[] = [
  { icon: "bold", label: "Bold", active: () => props.tools.bold, press: () => props.run((root) => format(root, "bold")) },
  { icon: "italic", label: "Italic", active: () => props.tools.italic, press: () => props.run((root) => format(root, "italic")) },
  { icon: "highlight", label: "Highlight", active: () => props.tools.highlight, press: () => props.run((root) => toggleInline(root, "mark")) },
  { icon: "code", label: "Inline code", active: () => props.tools.code, press: () => props.run((root) => toggleInline(root, "code")) },
  { icon: "link", label: "Link", active: () => props.tools.link, press: () => props.run(askLink) },
];
</script>

<template>
  <Teleport to="body">
    <div v-if="shown" ref="bubble" class="bubble floating" role="toolbar" aria-label="Format selection" @mousedown.prevent>
      <button
        v-for="button in buttons"
        :key="button.icon"
        type="button"
        :class="['tool', { 'is-active': button.active() }]"
        :title="button.label"
        :aria-label="button.label"
        @click="button.press"
      >
        <Icon :name="button.icon" />
      </button>
    </div>
  </Teleport>
</template>
