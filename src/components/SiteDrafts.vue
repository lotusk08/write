<script setup lang="ts">
import { ref } from "vue";
import { fetchSiteDrafts, PasswordRejected, type SiteDraft } from "../lib/api.ts";
import { rememberPassword, sessionPassword } from "../lib/password.ts";
import Icon from "./Icon.vue";
import { useFloatingMenu } from "./useFloatingMenu.ts";

const emit = defineEmits<{ open: [path: string] }>();

const open = ref(false);
const anchor = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);
const drafts = ref<SiteDraft[] | null>(null);
const problem = ref("");
const asking = ref(false);
const password = ref("");

useFloatingMenu(open, anchor, list);

const load = async () => {
  problem.value = "";
  drafts.value = null;
  try {
    drafts.value = await fetchSiteDrafts(asking.value ? password.value : sessionPassword());
    if (asking.value) {
      rememberPassword(password.value);
      asking.value = false;
    }
  } catch (cause) {
    asking.value = cause instanceof PasswordRejected;
    problem.value = cause instanceof Error ? cause.message : "Could not read the site's drafts.";
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
</script>

<template>
  <button
    ref="anchor"
    type="button"
    class="btn icon ghost"
    title="Open a draft from the site"
    aria-label="Open a draft from the site"
    aria-haspopup="menu"
    :aria-expanded="open"
    @click="toggle"
  >
    <Icon name="download" />
  </button>
  <Teleport to="body">
    <div v-if="open" ref="list" class="menu floating draft-list" role="menu" aria-label="Drafts on the site">
      <form v-if="asking" class="menu-row" @submit.prevent="load">
        <input v-model="password" type="password" autocomplete="current-password" placeholder="Publish password" aria-label="Publish password" />
        <button type="submit" class="btn">Open</button>
      </form>
      <p v-if="problem" class="notice warn">{{ problem }}</p>
      <p v-else-if="!drafts" class="notice">Reading the site's drafts…</p>
      <p v-else-if="!drafts.length" class="notice">The site has no drafts.</p>
      <button v-for="draft in drafts ?? []" :key="draft.path" type="button" role="menuitem" :title="draft.path" @click="pick(draft.path)">
        <span class="draft-list-title">{{ draft.title || draft.path.split("/").pop() }}</span>
        <span class="mono">{{ draft.date }}</span>
      </button>
    </div>
  </Teleport>
</template>
