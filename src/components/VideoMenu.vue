<script setup lang="ts">
import { nextTick, ref } from "vue";
import { embedFromUrl } from "../editor/blog.ts";
import { insertEmbed, selectionIn } from "../editor/commands.ts";
import Icon from "./Icon.vue";
import { useFloatingMenu } from "./useFloatingMenu.ts";

const props = defineProps<{ run: (command: (root: HTMLElement) => unknown) => void }>();
const emit = defineEmits<{ videos: [files: File[]] }>();

const open = ref(false);
const button = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLDivElement | null>(null);
const field = ref<HTMLInputElement | null>(null);
const files = ref<HTMLInputElement | null>(null);
const link = ref("");
const problem = ref("");
let caret: Range | null = null;

useFloatingMenu(open, button, menu);

const toggle = () => {
  if (!open.value) {
    props.run((root) => (caret = selectionIn(root)?.cloneRange() ?? null));
    link.value = "";
    problem.value = "";
  }
  open.value = !open.value;
  if (open.value) {
    void nextTick(() => field.value?.focus());
  }
};

const back = () => {
  open.value = false;
  if (caret) {
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(caret);
  }
};

const add = () => {
  const found = embedFromUrl(link.value);
  if (!found) {
    problem.value = "The blog cannot embed this link. It embeds YouTube, X posts, video and audio files, and Dropbox share links.";
    return;
  }
  back();
  props.run((root) => insertEmbed(root, found));
};

const pasted = (event: ClipboardEvent) => {
  const text = event.clipboardData?.getData("text/plain").trim() ?? "";
  if (!embedFromUrl(text)) {
    return;
  }
  event.preventDefault();
  link.value = text;
  add();
};

const pick = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const chosen = Array.from(input.files ?? []);
  input.value = "";
  if (chosen.length) {
    back();
    emit("videos", chosen);
  }
};
</script>

<template>
  <button
    ref="button"
    type="button"
    class="tool"
    title="Add a video — a link, or a file to upload"
    aria-label="Add a video"
    aria-haspopup="dialog"
    :aria-expanded="open"
    @mousedown.prevent
    @click="toggle"
  >
    <Icon name="video" />
  </button>
  <Teleport to="body">
    <div v-if="open" ref="menu" class="menu video-menu" role="dialog" aria-label="Add a video">
      <form class="video-menu-link" @submit.prevent="add">
        <input
          ref="field"
          v-model="link"
          class="input"
          type="text"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          aria-label="Video link"
          placeholder="Paste a link: YouTube, Dropbox, an X post, a video file"
          @paste="pasted"
        />
        <button type="submit" class="btn tiny primary" :disabled="!link.trim()">Add</button>
      </form>
      <p v-if="problem" class="video-menu-problem" role="alert">{{ problem }}</p>
      <button type="button" class="btn tiny video-menu-upload" @click="files?.click()">
        <Icon name="videoUpload" :size="14" />
        Upload a video file
      </button>
      <p class="video-menu-hint">A link or a video file can also be pasted or dropped straight into the post.</p>
      <input ref="files" type="file" accept="video/*" multiple hidden @change="pick" />
    </div>
  </Teleport>
</template>
