<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";

defineProps<{ title: string; subtitle?: string }>();
const emit = defineEmits<{ close: [] }>();

const onKey = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    emit("close");
  }
};

onMounted(() => document.addEventListener("keydown", onKey));
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="scrim" role="presentation" @mousedown.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" :aria-label="title">
      <header class="dialog-head">
        <h2>{{ title }}</h2>
        <p v-if="subtitle" class="hint">{{ subtitle }}</p>
      </header>
      <div class="dialog-body"><slot /></div>
      <div v-if="$slots.footer" class="dialog-actions"><slot name="footer" /></div>
    </div>
  </div>
</template>
