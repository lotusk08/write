<script setup lang="ts">
import type { ExportFormat } from "../types.ts";

const props = defineProps<{ chosen: ExportFormat[]; exporting: boolean }>();
const emit = defineEmits<{ change: [chosen: ExportFormat[]] }>();

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: "markdown", label: "Markdown", hint: "The post exactly as the blog would receive it" },
  { id: "docx", label: "Word", hint: "A .docx, for reading anywhere else" },
  { id: "pdf", label: "PDF", hint: "Through the browser's print dialog — choose Save as PDF" },
  { id: "html", label: "HTML", hint: "One standalone page, images and all" },
];

const toggle = (id: ExportFormat) => {
  emit("change", props.chosen.includes(id) ? props.chosen.filter((one) => one !== id) : [...props.chosen, id]);
};
</script>

<template>
  <ul class="switch-list">
    <li v-for="format in FORMATS" :key="format.id">
      <label class="switch">
        <input
          type="checkbox"
          :checked="chosen.includes(format.id)"
          :disabled="exporting"
          @change="toggle(format.id)"
        />
        <span>
          {{ format.label }}
          <em>{{ format.hint }}</em>
        </span>
      </label>
    </li>
  </ul>
</template>
