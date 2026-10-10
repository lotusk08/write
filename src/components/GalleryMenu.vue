<script setup lang="ts">
import { ref } from "vue";
import { GALLERY_KINDS, GALLERY_LABELS, type GalleryKind } from "../editor/blog.ts";
import Icon from "./Icon.vue";
import { useFloatingMenu } from "./useFloatingMenu.ts";

defineProps<{ kind: GalleryKind | null; enabled: boolean }>();
const emit = defineEmits<{ kind: [kind: GalleryKind]; separate: [] }>();

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
    :class="['tool', { 'is-active': kind }]"
    :title="kind ? `Gallery — ${GALLERY_LABELS[kind]}` : 'Gallery — several photos in one frame'"
    aria-label="Gallery"
    :aria-pressed="Boolean(kind)"
    :aria-expanded="open"
    :disabled="!enabled"
    @mousedown.prevent
    @click="open = !open"
  >
    <Icon name="gallery" />
  </button>
  <Teleport to="body">
    <div v-if="open" ref="menu" class="menu floating" role="menu" @mousedown.prevent>
      <button v-for="option in GALLERY_KINDS" :key="option" type="button" @click="choose(() => emit('kind', option))">
        <span>{{ GALLERY_LABELS[option] }}</span>
        <span v-if="kind === option" class="check">✓</span>
      </button>
      <button v-if="kind" type="button" @click="choose(() => emit('separate'))">
        <span>Separate images</span>
      </button>
    </div>
  </Teleport>
</template>
