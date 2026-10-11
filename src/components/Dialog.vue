<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{ title: string; subtitle?: string; locked?: boolean }>();
const emit = defineEmits<{ close: [] }>();

const dialog = ref<HTMLDialogElement | null>(null);

const dismiss = () => {
  if (!props.locked) {
    emit("close");
  }
};

onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => dialog.value?.close());
</script>

<template>
  <dialog
    ref="dialog"
    class="dialog"
    :aria-label="title"
    @cancel.prevent="dismiss"
    @mousedown.self="dismiss"
  >
    <header class="dialog-head">
      <h2>{{ title }}</h2>
      <p v-if="subtitle" class="hint">{{ subtitle }}</p>
    </header>
    <div class="dialog-body"><slot /></div>
    <div v-if="$slots.footer" class="dialog-actions"><slot name="footer" /></div>
  </dialog>
</template>
