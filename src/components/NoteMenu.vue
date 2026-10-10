<script setup lang="ts">
import { ref } from "vue";
import { NOTE_LABELS, NOTE_TYPES, type NoteType } from "../editor/blog.ts";
import Icon from "./Icon.vue";
import { useFloatingMenu } from "./useFloatingMenu.ts";

defineProps<{ active: boolean; note: NoteType | null }>();
const emit = defineEmits<{ quote: []; note: [note: NoteType] }>();

const open = ref(false);
const button = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLDivElement | null>(null);

useFloatingMenu(open, button, menu);

const choose = (pick: () => void) => {
  open.value = false;
  pick();
};
</script>

<template>
  <button
    ref="button"
    type="button"
    :class="['tool', { 'is-active': active }]"
    :title="note ? `Callout — ${NOTE_LABELS[note]}` : 'Quote and callouts'"
    aria-label="Quote and callouts"
    :aria-expanded="open"
    @mousedown.prevent
    @click="open = !open"
  >
    <Icon name="quote" />
  </button>
  <Teleport to="body">
    <div v-if="open" ref="menu" class="menu floating" role="menu" @mousedown.prevent>
      <button type="button" @click="choose(() => emit('quote'))">
        <span>Quote</span>
        <span v-if="active && !note" class="check">✓</span>
      </button>
      <button v-for="type in NOTE_TYPES" :key="type" type="button" @click="choose(() => emit('note', type))">
        <span class="swatch-label">
          <span class="swatch" :data-note="type" />
          {{ NOTE_LABELS[type] }}
        </span>
        <span v-if="note === type" class="check">✓</span>
      </button>
    </div>
  </Teleport>
</template>
