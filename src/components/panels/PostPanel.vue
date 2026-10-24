<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import type { PostMeta, Topics } from "../../../shared/types.ts";
import { fetchTopics } from "../../lib/api.ts";
import { isLocalSrc, resolveLocalSrc, storeImageFile } from "../../lib/db.ts";
import type { Language } from "../../lib/draft.ts";
import { choiceOf, PIN_CHOICES, pinOf } from "../../lib/home.ts";
import { convertedSrc, displaySrc } from "../../lib/site.ts";
import { rememberValue, tidyEdited } from "../../lib/text.ts";
import Icon from "../Icon.vue";
import Toggle from "../Toggle.vue";
import TokenInput from "../TokenInput.vue";
import type { ToggleOption } from "../types.ts";
import Section from "./Section.vue";

const props = defineProps<{ meta: PostMeta; slug: string }>();
const emit = defineEmits<{ change: [patch: Partial<PostMeta>]; slug: [slug: string] }>();

const LANGUAGES: ToggleOption<Language>[] = [
  { id: "vi", label: "Tiếng Việt" },
  { id: "en", label: "English" },
];

const MAX_TOPICS = 8;

const coverUrl = ref<string | null>(null);
const coverInput = ref<HTMLInputElement | null>(null);
const topics = ref<Topics | null>(null);

onMounted(() => {
  void fetchTopics().then((found) => {
    topics.value = found;
  });
});

watch(
  () => props.meta.cover?.path,
  (path) => {
    if (!path) {
      coverUrl.value = null;
    } else if (isLocalSrc(path)) {
      void resolveLocalSrc(path).then((url) => {
        coverUrl.value = url;
      });
    } else {
      coverUrl.value = displaySrc(path);
    }
  },
  { immediate: true },
);

const onCoverError = () => {
  const url = coverUrl.value;
  if (url && !isLocalSrc(props.meta.cover?.path) && convertedSrc(url) !== url) {
    coverUrl.value = convertedSrc(url);
  }
};

const pickCover = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) {
    return;
  }
  const stored = await storeImageFile(file);
  emit("change", { cover: { path: `local:${stored.id}`, alt: props.meta.cover?.alt ?? "" } });
};

const setAlt = (alt: string) => {
  emit("change", { cover: { ...props.meta.cover, path: props.meta.cover?.path ?? "", alt } });
};

/** The description grows with its text, as it did on the page. */
const description = ref<HTMLTextAreaElement | null>(null);
const fitDescription = () => {
  const field = description.value;
  if (field) {
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }
};
watch(() => props.meta.description, () => void nextTick(fitDescription));
onMounted(fitDescription);

/** A field is tidied on blur only if it was edited while focused, so one read from a post keeps its spaces. */
const onTitleBlur = (event: FocusEvent) => {
  const title = tidyEdited(event.target as HTMLInputElement);
  if (title !== null) {
    emit("change", { title });
  }
};

const onDescriptionBlur = (event: FocusEvent) => {
  const value = tidyEdited(event.target as HTMLTextAreaElement);
  if (value !== null) {
    emit("change", { description: value });
  }
};

const onAltBlur = (event: FocusEvent) => {
  const alt = tidyEdited(event.target as HTMLInputElement);
  if (alt !== null) {
    setAlt(alt);
  }
};
</script>

<template>
  <Section>
    <div class="field">
      <figure v-if="coverUrl" class="cover-card">
        <img :src="coverUrl" :alt="meta.cover?.alt ?? ''" @error="onCoverError" />
        <figcaption>
          <button type="button" class="btn tiny" @click="coverInput?.click()">Replace</button>
          <button type="button" class="btn tiny danger" @click="emit('change', { cover: null })">Remove</button>
        </figcaption>
      </figure>
      <button v-else type="button" class="cover-empty" @click="coverInput?.click()">
        <Icon name="image" />
        Cover image
      </button>
      <input ref="coverInput" type="file" accept="image/*" hidden @change="pickCover" />
      <input
        v-if="meta.cover"
        id="meta-cover-alt"
        class="input"
        placeholder="Cover alt text"
        aria-label="Cover alt text"
        :value="meta.cover.alt"
        @input="setAlt(($event.target as HTMLInputElement).value)"
        @focus="rememberValue($event.target as HTMLInputElement)"
        @blur="onAltBlur"
      />
    </div>
  </Section>

  <Section id="menu-file">
    <div class="field field-row">
      <input
        id="meta-title"
        class="input meta-title"
        placeholder="Title"
        aria-label="Title"
        :value="meta.title"
        @input="emit('change', { title: ($event.target as HTMLInputElement).value })"
        @focus="rememberValue($event.target as HTMLInputElement)"
        @blur="onTitleBlur"
      />
      <input
        id="meta-slug"
        class="input meta-slug"
        placeholder="Slug"
        aria-label="Slug"
        title="The post's address"
        :value="slug"
        @input="emit('slug', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <div class="field">
      <textarea
        id="meta-description"
        ref="description"
        class="input meta-description"
        placeholder="Description"
        aria-label="Description"
        rows="1"
        :value="meta.description"
        @input="emit('change', { description: ($event.target as HTMLTextAreaElement).value })"
        @focus="rememberValue($event.target as HTMLTextAreaElement)"
        @blur="onDescriptionBlur"
      />
    </div>
    <div class="field">
      <input
        id="meta-date"
        class="input numeric"
        placeholder="Date"
        aria-label="Date"
        :value="meta.date"
        @input="emit('change', { date: ($event.target as HTMLInputElement).value })"
      />
    </div>
  </Section>

  <Section>
    <div class="field">
      <TokenInput
        id="meta-tags"
        :values="meta.tags"
        placeholder="Topics"
        :suggestions="topics?.tags"
        :max="MAX_TOPICS"
        @change="(tags) => emit('change', { tags })"
      />
    </div>
    <Toggle
      label="Language"
      :options="LANGUAGES"
      :value="meta.lang"
      @change="(lang) => emit('change', { lang })"
    />
  </Section>

  <Section>
    <Toggle
      label="Pin to home"
      :options="PIN_CHOICES"
      :value="choiceOf(meta.pin)"
      @change="(choice) => emit('change', { pin: pinOf(choice) })"
    />
    <div class="post-options" role="group" aria-label="Post options">
      <button
        type="button"
        :class="['post-option', { 'is-on': meta.toc }]"
        :aria-pressed="meta.toc"
        title="Table of contents — the blog lists the post's headings beside it"
        @click="emit('change', { toc: !meta.toc })"
      >
        <Icon name="bulletList" :size="16" />
        <span>Contents</span>
      </button>
      <button
        type="button"
        :class="['post-option', { 'is-on': meta.moments !== false }]"
        :aria-pressed="meta.moments !== false"
        title="Moments — off keeps the post's photos off the blog's Moments wall (moments: false)"
        @click="emit('change', { moments: meta.moments === false ? undefined : false })"
      >
        <Icon name="gallery" :size="16" />
        <span>Moments</span>
      </button>
    </div>
  </Section>
</template>
