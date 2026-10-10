<script setup lang="ts">
import type { OutlineEntry } from "./useOutline.ts";

defineProps<{ entries: OutlineEntry[]; active: number | null }>();
const emit = defineEmits<{ pick: [entry: OutlineEntry] }>();
</script>

<template>
  <ul class="toc-list">
    <li v-for="entry in entries" :key="entry.key">
      <button
        type="button"
        :class="['toc-link', `level-${entry.level}`, { 'is-active': entry.key === active }]"
        @mousedown.prevent
        @click="emit('pick', entry)"
      >
        {{ entry.text || "Heading" }}
      </button>
    </li>
  </ul>
</template>
