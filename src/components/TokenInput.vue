<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { Topic } from "../../shared/types.ts";
import { uniqueNames } from "../lib/markdown.ts";
import { findTopic, knownTopic, suggestTopics } from "../lib/topics.ts";

const props = withDefaults(
  defineProps<{
    id: string;
    values: string[];
    placeholder?: string;
    suggestions?: Topic[];
    max?: number;
  }>(),
  { placeholder: "", suggestions: () => [], max: Infinity },
);
const emit = defineEmits<{ change: [values: string[]] }>();

const draft = ref("");
const focused = ref(false);
const dismissed = ref(false);
const active = ref(-1);
const box = ref<HTMLDivElement | null>(null);
const list = ref<HTMLDivElement | null>(null);

const full = computed(() => props.values.length >= props.max);
const offered = computed(() =>
  focused.value && !dismissed.value && !full.value ? suggestTopics(props.suggestions, draft.value, props.values) : [],
);
const listId = computed(() => `${props.id}-suggestions`);
const open = computed(() => offered.value.length > 0);

function scroller(element: HTMLElement, overflowing = true): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && (!overflowing || node.scrollHeight > node.clientHeight)) {
      return node;
    }
  }
  return null;
}

function reveal(top: HTMLElement, bottom: HTMLElement) {
  const parent = scroller(top);
  if (!parent) {
    return;
  }
  const frame = parent.getBoundingClientRect();
  const start = top.getBoundingClientRect().top;
  const end = bottom.getBoundingClientRect().bottom;
  if (end - start > frame.height || start < frame.top) {
    parent.scrollTop += start - frame.top - 8;
  } else if (end > frame.bottom) {
    parent.scrollTop += end - frame.bottom + 8;
  }
}

function changed(next: string[]): boolean {
  return next.length !== props.values.length || next.some((value, index) => value !== props.values[index]);
}

watch([draft, () => offered.value.length], () => {
  active.value = -1;
});

watch([open, draft], async () => {
  await nextTick();
  if (open.value && box.value && list.value) {
    reveal(box.value, list.value);
  }
});

let observer: ResizeObserver | null = null;
let frame = 0;
watch(focused, (value) => {
  observer?.disconnect();
  observer = null;
  const parent = value && box.value ? scroller(box.value, false) : null;
  if (!parent) {
    return;
  }
  observer = new ResizeObserver(() => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      if (box.value) {
        reveal(box.value, list.value ?? box.value);
      }
    });
  });
  observer.observe(parent);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.cancelAnimationFrame(frame);
});

const commit = (raw: string) => {
  const next = uniqueNames([
    ...props.values,
    ...raw
      .split(",")
      .map((item) => item.normalize("NFC").trim())
      .filter(Boolean)
      .map((item) => knownTopic(item, props.suggestions)),
  ]).slice(0, Math.max(props.max, props.values.length));
  if (changed(next)) {
    emit("change", next);
  }
  draft.value = "";
};

const pick = (topic: Topic) => {
  const next = uniqueNames([...props.values, topic.slug]).slice(0, Math.max(props.max, props.values.length));
  if (changed(next)) {
    emit("change", next);
  }
  draft.value = "";
  active.value = -1;
};

const onKeydown = (event: KeyboardEvent) => {
  if (event.isComposing || event.keyCode === 229) {
    return;
  }
  if (event.key === "ArrowDown" && open.value) {
    event.preventDefault();
    active.value = Math.min(active.value + 1, offered.value.length - 1);
  } else if (event.key === "ArrowUp" && open.value) {
    event.preventDefault();
    active.value = Math.max(active.value - 1, -1);
  } else if (event.key === "Escape" && open.value) {
    event.preventDefault();
    event.stopPropagation();
    dismissed.value = true;
  } else if (event.key === "Enter" && open.value && offered.value[active.value]) {
    event.preventDefault();
    pick(offered.value[active.value]);
  } else if (event.key === "Enter" || event.key === ",") {
    event.preventDefault();
    commit(draft.value);
  } else if (event.key === "Backspace" && draft.value === "" && props.values.length) {
    emit("change", props.values.slice(0, -1));
  }
};

const onInput = (event: Event) => {
  const typed = (event.target as HTMLInputElement).value;
  const cut = typed.lastIndexOf(",");
  if (cut !== -1 && !(event as InputEvent).isComposing) {
    commit(typed.slice(0, cut));
    draft.value = typed.slice(cut + 1).trimStart();
  } else {
    draft.value = typed;
  }
  dismissed.value = false;
};

const focusField = () => document.getElementById(props.id)?.focus();
</script>

<template>
  <div ref="box" class="tokens" @mousedown.self.prevent="focusField">
    <span
      v-for="value in values"
      :key="value"
      :class="['token', { 'is-new': suggestions.length > 0 && !findTopic(value, suggestions) }]"
      :title="suggestions.length > 0 && !findTopic(value, suggestions) ? 'Not one of the blog\'s topics yet' : undefined"
    >
      {{ findTopic(value, suggestions)?.title ?? value }}
      <button
        type="button"
        :aria-label="`Remove ${findTopic(value, suggestions)?.title ?? value}`"
        @click="emit('change', values.filter((item) => item !== value))"
      >
        ×
      </button>
    </span>
    <input
      :id="id"
      class="token-input"
      :value="draft"
      :placeholder="values.length ? '' : placeholder"
      :aria-label="placeholder"
      :disabled="full"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-activedescendant="open && active >= 0 ? `${listId}-${active}` : undefined"
      autocorrect="off"
      spellcheck="false"
      @input="onInput"
      @keydown="onKeydown"
      @focus="
        focused = true;
        dismissed = false;
      "
      @blur="
        focused = false;
        commit(draft);
      "
    />
  </div>
  <div
    v-if="open"
    :id="listId"
    ref="list"
    class="token-suggestions"
    role="listbox"
    aria-label="Already on the blog"
    @pointerdown.prevent
    @mousedown.prevent
  >
    <button
      v-for="(topic, index) in offered"
      :id="`${listId}-${index}`"
      :key="topic.slug"
      type="button"
      tabindex="-1"
      role="option"
      :aria-selected="index === active"
      :class="['token-suggestion', { 'is-active': index === active }]"
      @click="pick(topic)"
    >
      {{ topic.title }}
      <span class="token-suggestion-count">{{ topic.count }}</span>
    </button>
  </div>
</template>
