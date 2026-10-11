<script setup lang="ts">
import { ref } from "vue";
import { NOTE_LABELS, NOTE_TYPES, type NoteType } from "../editor/blog.ts";
import Icon from "./Icon.vue";
import { useFloatingMenu } from "./useFloatingMenu.ts";

defineProps<{ note: NoteType | null }>();
const emit = defineEmits<{ note: [note: NoteType] }>();

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
    :class="['tool', { 'is-active': note }]"
    :title="note ? `Callout — ${NOTE_LABELS[note]}` : 'Callouts'"
    aria-label="Callouts"
    aria-haspopup="menu"
    :aria-expanded="open"
    @mousedown.prevent
    @click="open = !open"
  >
    <Icon name="note" />
  </button>
  <Teleport to="body">
    <div v-if="open" ref="menu" class="menu floating" role="menu" @mousedown.prevent>
      <button v-for="type in NOTE_TYPES" :key="type" type="button" role="menuitem" @click="choose(() => emit('note', type))">
        <span class="swatch-label">
          <span class="swatch" :data-note="type" />
          {{ NOTE_LABELS[type] }}
        </span>
        <span v-if="note === type" class="check">✓</span>
      </button>
    </div>
  </Teleport>
</template>
