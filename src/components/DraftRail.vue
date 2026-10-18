<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { Draft } from "../lib/db.ts";
import { draftLabel } from "../lib/draft.ts";
import { useMediaQuery } from "../lib/viewport.ts";
import Icon from "./Icon.vue";
import { useFloatingMenu } from "./useFloatingMenu.ts";

const props = defineProps<{ drafts: Draft[]; currentId: string | null }>();
const emit = defineEmits<{
  select: [id: string];
  new: [];
  rename: [title: string];
  delete: [id: string];
}>();

const editing = ref<string | null>(null);
const field = ref<HTMLInputElement | null>(null);
const touch = useMediaQuery("(pointer: coarse)");
const listing = ref(false);
const anchor = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);

useFloatingMenu(listing, anchor, list);

const ordered = computed(() => [...props.drafts].sort((a, b) => a.createdAt - b.createdAt));
const open = computed(() => ordered.value.findIndex((draft) => draft.id === props.currentId));
const openDraft = computed(() => (open.value === -1 ? null : ordered.value[open.value]));
const label = computed(() => (openDraft.value ? draftLabel(openDraft.value) : ""));
const before = computed(() => (open.value === -1 ? ordered.value : ordered.value.slice(0, open.value)));
const after = computed(() => (open.value === -1 ? [] : ordered.value.slice(open.value + 1)));

watch(
  () => props.currentId,
  () => {
    editing.value = null;
    listing.value = false;
  },
);

const startRename = async () => {
  editing.value = label.value;
  await nextTick();
  field.value?.focus();
  field.value?.select();
};

const commit = () => {
  if (editing.value !== null) {
    emit("rename", editing.value.trim());
    editing.value = null;
  }
};

const onCancel = (event: KeyboardEvent) => {
  event.stopPropagation();
  editing.value = null;
};

/** On a phone a deck of more than one sheet is one target, opening a list of every draft by title. */
const listed = (sheets: Draft[]) => touch.value && sheets.length > 1;

const pickSheet = (event: MouseEvent, sheets: Draft[], draft: Draft) => {
  if (listed(sheets)) {
    anchor.value = event.currentTarget as HTMLElement;
    listing.value = !listing.value;
  } else {
    emit("select", draft.id);
  }
};

const pickFromList = (draft: Draft) => {
  listing.value = false;
  if (draft.id !== props.currentId) {
    emit("select", draft.id);
  }
};
</script>

<template>
  <nav class="rail" aria-label="Drafts">
    <button type="button" class="btn icon ghost" title="New draft — ⌘⇧N" aria-label="New draft" @click="emit('new')">
      <Icon name="plus" />
    </button>

    <div class="rail-tabs">
      <div class="rail-deck">
        <button
          v-for="draft in before"
          :key="draft.id"
          type="button"
          class="rail-tab is-layer"
          :style="{ '--z': ordered.length - ordered.indexOf(draft) }"
          :title="draftLabel(draft)"
          :aria-label="listed(before) ? 'All drafts' : draftLabel(draft)"
          :aria-haspopup="listed(before) ? 'menu' : undefined"
          @click="pickSheet($event, before, draft)"
        >
          <Icon name="file" :size="13" />
          <span v-if="draft.publishedPath" class="dot" :title="`Published to ${draft.publishedPath}`" />
        </button>
      </div>

      <div v-if="openDraft" class="rail-tab is-open" aria-current="true">
        <Icon name="file" :size="13" />
        <span v-if="editing === null" class="rail-tab-label" :title="`${label} — double-click to rename`" @dblclick="startRename">
          {{ label }}
        </span>
        <input
          v-else
          ref="field"
          v-model="editing"
          class="rail-tab-label rail-tab-field"
          :size="Math.max(8, editing.length + 1)"
          aria-label="Draft title"
          @blur="commit"
          @keydown.enter="commit"
          @keydown.esc="onCancel"
        />
        <span v-if="openDraft.publishedPath" class="dot" :title="`Published to ${openDraft.publishedPath}`" />
        <button
          type="button"
          class="rail-tab-delete"
          title="Delete draft"
          :aria-label="`Delete ${label}`"
          @click="emit('delete', openDraft.id)"
        >
          <Icon name="trash" :size="13" />
        </button>
      </div>

      <div class="rail-deck">
        <button
          v-for="draft in after"
          :key="draft.id"
          type="button"
          class="rail-tab is-layer"
          :style="{ '--z': ordered.length - ordered.indexOf(draft) }"
          :title="draftLabel(draft)"
          :aria-label="listed(after) ? 'All drafts' : draftLabel(draft)"
          :aria-haspopup="listed(after) ? 'menu' : undefined"
          @click="pickSheet($event, after, draft)"
        >
          <Icon name="file" :size="13" />
          <span v-if="draft.publishedPath" class="dot" :title="`Published to ${draft.publishedPath}`" />
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="listing" ref="list" class="menu file-list" role="menu" aria-label="Drafts">
        <button
          v-for="draft in ordered"
          :key="draft.id"
          type="button"
          role="menuitem"
          :aria-current="draft.id === currentId ? 'true' : undefined"
          @click="pickFromList(draft)"
        >
          <span class="file-list-title">{{ draftLabel(draft) }}</span>
          <span v-if="draft.publishedPath" class="dot" :title="`Published to ${draft.publishedPath}`" />
        </button>
      </div>
    </Teleport>
  </nav>
</template>
