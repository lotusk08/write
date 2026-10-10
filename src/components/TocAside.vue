<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import TocList from "./TocList.vue";
import type { OutlineEntry } from "./useOutline.ts";

const props = defineProps<{ entries: OutlineEntry[]; active: number | null }>();
const emit = defineEmits<{ pick: [entry: OutlineEntry] }>();

const ASIDE_GAP_PX = 12;
const aside = ref<HTMLElement | null>(null);

/** Keeps the lit entry in view as the column scrolls on its own. */
watch(
  () => props.active,
  async () => {
    await nextTick();
    const element = aside.value;
    const link = element?.querySelector<HTMLElement>(".toc-link.is-active");
    if (!element || !link) {
      return;
    }
    const top = link.offsetTop - ASIDE_GAP_PX;
    const bottom = link.offsetTop + link.offsetHeight + ASIDE_GAP_PX;
    if (top < element.scrollTop) {
      element.scrollTop = top;
    } else if (bottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = bottom - element.clientHeight;
    }
  },
);
</script>

<template>
  <aside v-if="entries.length" ref="aside" class="toc-wrapper">
    <nav class="toc" aria-label="Contents">
      <TocList :entries="entries" :active="active" @pick="(entry) => emit('pick', entry)" />
    </nav>
  </aside>
</template>
