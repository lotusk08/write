<script setup lang="ts">
import Icon from "../Icon.vue";
import type { IconName } from "../icons.ts";
import type { ExportFormat } from "../types.ts";

const props = defineProps<{ chosen: ExportFormat[]; exporting: boolean }>();
const emit = defineEmits<{ change: [chosen: ExportFormat[]] }>();

const FORMATS: { id: ExportFormat; label: string; icon: IconName; hint: string }[] = [
  { id: "markdown", label: "Markdown", icon: "markdown", hint: "The post exactly as the blog would receive it" },
  { id: "docx", label: "Word", icon: "word", hint: "A .docx, for reading anywhere else" },
  { id: "pdf", label: "PDF", icon: "pdf", hint: "Through the browser's print dialog — choose Save as PDF" },
  { id: "html", label: "HTML", icon: "html", hint: "One standalone page, images and all" },
];

const toggle = (id: ExportFormat) => {
  emit("change", props.chosen.includes(id) ? props.chosen.filter((one) => one !== id) : [...props.chosen, id]);
};
</script>

<template>
  <div class="export-formats" role="group" aria-label="Formats to export">
    <button
      v-for="format in FORMATS"
      :key="format.id"
      type="button"
      :class="['export-format', { 'is-on': chosen.includes(format.id) }]"
      :title="`${format.label} — ${format.hint}`"
      :aria-label="format.label"
      :aria-pressed="chosen.includes(format.id)"
      :disabled="exporting"
      @click="toggle(format.id)"
    >
      <Icon :name="format.icon" :size="22" />
    </button>
  </div>
</template>
