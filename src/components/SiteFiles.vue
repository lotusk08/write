<script setup lang="ts">
import { computed, ref } from "vue";
import type { Pin } from "../../shared/pin.ts";
import type { SiteFile } from "../../shared/types.ts";
import { fetchSiteFiles, PasswordRejected, type SiteFiles } from "../lib/api.ts";
import {
  choiceOf,
  homePlaces,
  homeTop,
  PIN_CHOICES,
  pinChanges,
  pinOf,
  publishPins,
  swapChanges,
  withPins,
  type PinChoice,
  type PinWritten,
} from "../lib/home.ts";
import Icon from "./Icon.vue";
import SignIn from "./SignIn.vue";
import Toggle from "./Toggle.vue";
import type { ToggleOption } from "./types.ts";
import { useFloatingMenu } from "./useFloatingMenu.ts";
import { useSignIn } from "./useSignIn.ts";

type Kind = "posts" | "drafts";

const KINDS: ToggleOption<Kind>[] = [
  { id: "posts", label: "Posts" },
  { id: "drafts", label: "Drafts" },
];

const LABELS = new Map(PIN_CHOICES.map((choice) => [choice.id, choice.label]));

const IDLE = "Pinned, but it holds no place: the newest post is first anyway, or both places are taken";

const emit = defineEmits<{ open: [path: string]; pinned: [written: PinWritten[]] }>();

const open = ref(false);
const anchor = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);
const files = ref<SiteFiles | null>(null);
const kind = ref<Kind>("posts");
const problem = ref("");
const editing = ref<string | null>(null);
const changes = ref(new Map<string, Pin>());
const saving = ref(false);
const saved = ref<string | null>(null);
const { password, asking, credential, accepted, signedIn, forget } = useSignIn();

useFloatingMenu(open, anchor, list);

const posts = computed(() => files.value?.posts ?? []);
const byPath = computed(() => new Map(posts.value.map((post) => [post.path, post])));
const shown = computed(() => posts.value.filter((post) => !post.hidden));
const after = computed(() => withPins(shown.value, changes.value));
const top = computed(() => homeTop(after.value));
const standing = computed(() => new Set([...homePlaces(after.value).values()].map((post) => post.path)));
const swap = computed(() => swapChanges(shown.value));
const rows = computed<SiteFile[]>(() =>
  kind.value === "posts" ? withPins(posts.value, changes.value) : (files.value?.drafts ?? []),
);
const pending = computed(() =>
  [...changes.value].map(([path, pin]) => {
    const post = byPath.value.get(path);
    return `${post ? titleOf(post) : name(path)} → ${badge(pin) || "unpinned"}`;
  }),
);

const name = (path: string) => path.split("/").pop() ?? path;
const titleOf = (file: SiteFile) => file.title || name(file.path);
/** A pinned post's badge, named as the pin switch names its place; none for a post not pinned. */
const badge = (pin: Pin) => (pin === false ? "" : LABELS.get(choiceOf(pin)));
/** Pinned, yet standing at no place on the home page. */
const idle = (file: SiteFile) => file.pin !== false && !standing.value.has(file.path);

const load = async () => {
  problem.value = "";
  saved.value = null;
  files.value = null;
  changes.value = new Map();
  editing.value = null;
  if (asking.value && !password.value) {
    return;
  }
  try {
    files.value = await fetchSiteFiles(credential());
    accepted();
  } catch (cause) {
    if (cause instanceof PasswordRejected) {
      forget();
    }
    problem.value = cause instanceof Error ? cause.message : "Could not read the site's posts and drafts.";
  }
};

const toggle = () => {
  open.value = !open.value;
  if (open.value) {
    void load();
  }
};

const pick = (path: string) => {
  open.value = false;
  emit("open", path);
};

const choose = (path: string, choice: PinChoice) => {
  const post = byPath.value.get(path);
  if (post) {
    saved.value = null;
    changes.value = pinChanges(shown.value.includes(post) ? shown.value : [post], post, pinOf(choice));
  }
};

const swapPlaces = () => {
  saved.value = null;
  editing.value = null;
  changes.value = swap.value;
};

const cancel = () => {
  changes.value = new Map();
  editing.value = null;
};

const save = async () => {
  saving.value = true;
  problem.value = "";
  try {
    const { commitUrl, written } = await publishPins(changes.value, byPath.value, credential());
    accepted();
    files.value = { ...files.value!, posts: withPins(posts.value, changes.value) };
    changes.value = new Map();
    editing.value = null;
    saved.value = commitUrl;
    emit("pinned", written);
  } catch (cause) {
    if (cause instanceof PasswordRejected) {
      forget();
    }
    problem.value = cause instanceof Error ? cause.message : "Could not save the pins.";
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <button
    ref="anchor"
    type="button"
    class="btn ghost site-open"
    aria-haspopup="dialog"
    :aria-expanded="open"
    @click="toggle"
  >
    <Icon name="folder" :size="14" />
    Open from the site
  </button>
  <Teleport to="body">
    <div v-if="open" ref="list" class="menu file-list site-list" role="dialog" aria-label="Posts and drafts on the site">
      <p v-if="problem && !changes.size" class="notice warn">
        {{ problem }}
        <button v-if="files" type="button" class="btn tiny" @click="load">Read again</button>
      </p>
      <SignIn
        v-if="asking"
        id="site-password"
        v-model="password"
        @submit="load"
        @session="(token) => (signedIn(token), load())"
        @error="(message) => (problem = message)"
      />
      <Toggle class="site-kind" label="Show" :options="KINDS" :value="kind" @change="(id) => (kind = id)" />
      <template v-if="!asking && !problem">
        <p v-if="!files" class="notice">Reading the site…</p>
        <p v-else-if="!rows.length" class="notice">The site has no {{ kind }}.</p>
      </template>
      <div v-if="kind === 'posts' && top.length" class="site-home" role="group" aria-label="Home page">
        <ol title="The home page's first three posts">
          <li v-for="(post, index) in top" :key="post.path" :class="{ 'is-changed': changes.has(post.path) }">
            <span class="site-home-place">{{ index + 1 }}</span>
            <span class="file-list-title">{{ titleOf(post) }}</span>
            <Icon v-if="standing.has(post.path)" name="pin" :size="12" class="site-home-pin" />
          </li>
        </ol>
        <button
          type="button"
          class="btn icon ghost"
          :disabled="!swap.size || saving"
          :title="swap.size ? 'Swap the posts pinned 2nd and 3rd' : 'Pin a post 2nd or 3rd to swap the places'"
          aria-label="Swap 2nd and 3rd"
          @click="swapPlaces"
        >
          <Icon name="swap" :size="16" />
        </button>
      </div>
      <div v-for="file in rows" :key="file.path" :class="['site-row', { 'is-changed': changes.has(file.path) }]">
        <button type="button" :title="file.path" @click="pick(file.path)">
          <span class="file-list-title">{{ titleOf(file) }}</span>
          <span class="mono">{{ file.hidden ? "hidden" : file.date }}</span>
        </button>
        <button
          v-if="kind === 'posts'"
          type="button"
          :class="['btn tiny site-pin', { 'is-on': standing.has(file.path) }]"
          :aria-expanded="editing === file.path"
          :aria-label="`Pin ${titleOf(file)}`"
          :title="idle(file) ? IDLE : 'Pin to the home page'"
          :disabled="saving"
          @click="editing = editing === file.path ? null : file.path"
        >
          <Icon name="pin" :size="12" />
          {{ badge(file.pin) }}
        </button>
        <Toggle
          v-if="editing === file.path"
          class="site-pin-choice"
          label="Pin to home"
          :options="PIN_CHOICES"
          :value="choiceOf(file.pin)"
          @change="(choice) => choose(file.path, choice)"
        />
      </div>
      <div v-if="changes.size" class="site-save">
        <p :class="{ warn: problem }">{{ problem || pending.join(" · ") }}</p>
        <button type="button" class="btn tiny" :disabled="saving" @click="problem ? load() : cancel()">
          {{ problem ? "Read again" : "Cancel" }}
        </button>
        <button type="button" class="btn tiny primary" :disabled="saving" @click="save">
          {{ saving ? "Saving…" : "Save to the site" }}
        </button>
      </div>
      <div v-else-if="saved" class="site-save" role="status">
        <p>Saved to the site. <a :href="saved" target="_blank" rel="noopener">View commit</a></p>
      </div>
    </div>
  </Teleport>
</template>
