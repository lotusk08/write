<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Icon from "./Icon.vue";
import TocList from "./TocList.vue";
import type { OutlineEntry } from "./useOutline.ts";

const props = defineProps<{ entries: OutlineEntry[]; active: number | null; scrolled: boolean; title: string }>();
const emit = defineEmits<{ pick: [entry: OutlineEntry] }>();

const dialog = ref<HTMLDialogElement | null>(null);
const open = ref(false);

const label = computed(
  () => props.entries.find((entry) => entry.key === props.active)?.text || props.title || "Contents",
);

watch(open, (value) => {
  const element = dialog.value;
  if (!element) {
    return;
  }
  if (value && !element.open) {
    element.showModal();
  } else if (!value && element.open) {
    element.close();
  }
});

const pick = (entry: OutlineEntry) => {
  emit("pick", entry);
  open.value = false;
};
</script>

<template>
  <template v-if="entries.length">
    <div :class="['toc-bar', { 'is-visible': scrolled }]">
      <span class="toc-label">{{ label }}</span>
      <button type="button" class="tool" title="Contents" aria-label="Open the table of contents" @click="open = true">
        <Icon name="bulletList" />
      </button>
    </div>
    <dialog ref="dialog" class="toc-popup" @close="open = false">
      <div class="toc-popup-head">
        <span class="toc-label">{{ title || "Contents" }}</span>
        <button
          type="button"
          class="tool"
          title="Close"
          aria-label="Close the table of contents"
          @click="open = false"
        >
          <Icon name="close" />
        </button>
      </div>
      <div class="toc-popup-body">
        <TocList :entries="entries" :active="active" @pick="pick" />
      </div>
    </dialog>
  </template>
</template>
