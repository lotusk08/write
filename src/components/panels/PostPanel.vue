<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import type { PostMeta, Topics } from "../../../shared/types.ts";
import { fetchTopics } from "../../lib/api.ts";
import { isLocalSrc, resolveLocalSrc, storeImageFile } from "../../lib/db.ts";
import type { Language } from "../../lib/draft.ts";
import { convertedSrc, displaySrc } from "../../lib/site.ts";
import { rememberValue, tidyEdited } from "../../lib/text.ts";
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

const OPTIONS: { key: "toc" | "pin"; label: string }[] = [
  { key: "toc", label: "Table of contents" },
  { key: "pin", label: "Pin to home" },
];

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

const onAltBlur = (event: FocusEvent) => {
  const alt = tidyEdited(event.target as HTMLInputElement);
  if (alt !== null) {
    setAlt(alt);
  }
};
</script>

<template>
  <Section title="Taxonomy">
    <div class="field">
      <label for="meta-tags">Topics</label>
      <TokenInput
        id="meta-tags"
        :values="meta.tags"
        placeholder="coffee, travel"
        :suggestions="topics?.tags"
        :max="MAX_TOPICS"
        @change="(tags) => emit('change', { tags })"
      />
    </div>
    <div class="menu-row">
      <span class="field-label">Language</span>
      <Toggle label="Language" :options="LANGUAGES" :value="meta.lang" @change="(lang) => emit('change', { lang })" />
    </div>
  </Section>

  <Section title="Cover image">
    <div class="field post-cover">
      <figure v-if="coverUrl" class="cover-card">
        <img :src="coverUrl" :alt="meta.cover?.alt ?? ''" @error="onCoverError" />
        <figcaption>
          <button type="button" class="btn tiny" @click="coverInput?.click()">Replace</button>
          <button type="button" class="btn tiny danger" @click="emit('change', { cover: null })">Remove</button>
        </figcaption>
      </figure>
      <button v-else type="button" class="cover-empty" @click="coverInput?.click()">Choose an image</button>
      <input ref="coverInput" type="file" accept="image/*" hidden @change="pickCover" />
      <template v-if="meta.cover">
        <label for="meta-cover-alt">Alt text</label>
        <input
          id="meta-cover-alt"
          class="input"
          placeholder="Describes the image"
          :value="meta.cover.alt"
          @input="setAlt(($event.target as HTMLInputElement).value)"
          @focus="rememberValue($event.target as HTMLInputElement)"
          @blur="onAltBlur"
        />
      </template>
    </div>
  </Section>

  <Section title="Post file">
    <div class="field">
      <label for="meta-slug">Slug</label>
      <input id="meta-slug" class="input" :value="slug" @input="emit('slug', ($event.target as HTMLInputElement).value)" />
    </div>
    <div class="field">
      <label for="meta-date">Date</label>
      <input
        id="meta-date"
        class="input mono"
        :value="meta.date"
        @input="emit('change', { date: ($event.target as HTMLInputElement).value })"
      />
    </div>
  </Section>

  <Section title="Options">
    <ul class="switch-list">
      <li v-for="option in OPTIONS" :key="option.key">
        <label class="switch">
          <input
            type="checkbox"
            :checked="meta[option.key]"
            @change="emit('change', { [option.key]: ($event.target as HTMLInputElement).checked })"
          />
          <span>{{ option.label }}</span>
        </label>
      </li>
    </ul>
  </Section>
</template>
