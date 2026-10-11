<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { AppConfig, PublishResult } from "../../shared/types.ts";
import { PasswordRejected } from "../lib/api.ts";
import type { Draft } from "../lib/db.ts";
import { buildPublishPlan, defaultCommitMessage, sendPlan, type PublishPlan } from "../lib/publish.ts";
import type { Settings } from "../lib/settings.ts";
import Dialog from "./Dialog.vue";
import SignIn from "./SignIn.vue";
import Toggle from "./Toggle.vue";
import type { ToggleOption } from "./types.ts";
import { useSignIn } from "./useSignIn.ts";

const props = defineProps<{ draft: Draft; settings: Settings; config: AppConfig | null }>();
const emit = defineEmits<{
  settings: [patch: Partial<Settings>];
  close: [];
  published: [result: PublishResult, plan: PublishPlan];
}>();

const TARGETS: ToggleOption<Settings["publishTarget"]>[] = [
  { id: "posts", label: "Post" },
  { id: "drafts", label: "Draft" },
];

const plan = ref<PublishPlan | null>(null);
const message = ref(defaultCommitMessage(props.draft, Boolean(props.draft.publishedPath)));
const busy = ref(false);
const sent = ref(0);
const error = ref<string | null>(null);
const { password, rejected, asking, credential, accepted, signedIn, forget } = useSignIn();
const signIn = ref<InstanceType<typeof SignIn> | null>(null);

let generation = 0;
watch(
  () => [props.draft, props.settings] as const,
  ([draft, settings]) => {
    const mine = ++generation;
    plan.value = null;
    void buildPublishPlan(draft, settings)
      .then((next) => {
        if (mine === generation) {
          plan.value = next;
        }
      })
      .catch((cause: unknown) => {
        if (mine === generation) {
          error.value = cause instanceof Error ? cause.message : String(cause);
        }
      });
  },
  { immediate: true },
);

watch(rejected, async (count) => {
  if (count) {
    await nextTick();
    signIn.value?.focus();
  }
});

const renamedFrom = computed(() =>
  props.draft.publishedPath && plan.value && plan.value.markdownPath !== props.draft.publishedPath
    ? props.draft.publishedPath
    : null,
);

const blocked = computed(() =>
  props.config === null
    ? "This app's own API did not answer, so it cannot publish. Reload and try again."
    : props.config.ready
      ? null
      : (props.config.problem ?? "This deployment is not configured to publish."),
);

const run = async () => {
  if (!plan.value || blocked.value || (asking.value && !password.value)) {
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    const result = await sendPlan(
      plan.value,
      message.value,
      credential(),
      (done) => (sent.value = done),
    );
    accepted();
    emit("published", result, plan.value);
  } catch (cause) {
    if (cause instanceof PasswordRejected) {
      forget();
    }
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <Dialog title="Publish" :subtitle="`${settings.repo} · ${settings.branch}`" @close="emit('close')">
    <div v-if="blocked" class="notice warn">{{ blocked }}</div>
    <div v-if="renamedFrom && plan?.remove.includes(renamedFrom)" class="notice">
      This moves the draft: <span class="mono">{{ renamedFrom }}</span> is removed from the blog in the same commit.
    </div>
    <div v-else-if="renamedFrom" class="notice warn">
      This writes a new file. The post it was opened from,
      <span class="mono">{{ renamedFrom }}</span>, stays on the blog — delete it there if you meant to rename this one.
    </div>
    <div v-if="error" class="notice warn">{{ error }}</div>

    <div class="menu-row publish-as">
      <span class="field-label">Publish as</span>
      <Toggle
        label="Publish as"
        :options="TARGETS"
        :value="settings.publishTarget"
        @change="(publishTarget) => emit('settings', { publishTarget })"
      />
    </div>

    <SignIn
      v-if="asking"
      id="publish-password"
      ref="signIn"
      v-model="password"
      :disabled="busy || Boolean(blocked)"
      @submit="run"
      @session="(token) => (signedIn(token), (error = null))"
      @error="(message) => (error = message)"
    />

    <div class="field">
      <label for="publish-message">Commit message</label>
      <input id="publish-message" v-model="message" class="input" />
    </div>

    <div class="field">
      <span class="field-label">Files</span>
      <ul v-if="plan" class="file-list">
        <li v-for="path in plan.paths" :key="path">{{ path }}</li>
      </ul>
      <p v-else class="hint">Preparing…</p>
      <p v-if="plan?.skippedImages.length" class="hint" style="color: var(--danger)">
        {{ plan.skippedImages.length }} image(s) missing from this browser's storage and will not be uploaded.
      </p>
    </div>

    <div class="field">
      <span class="field-label">Preview</span>
      <pre class="code-preview">{{ plan ? plan.markdown.slice(0, 4000) : "" }}</pre>
    </div>

    <template #footer>
      <button type="button" class="btn" @click="emit('close')">Cancel</button>
      <button
        type="button"
        class="btn primary"
        :disabled="!plan || busy || Boolean(blocked) || (asking && !password)"
        @click="run"
      >
        {{
          !busy
            ? "Commit"
            : plan && sent < plan.photos.length
              ? `Photo ${sent + 1} of ${plan.photos.length}…`
              : "Publishing…"
        }}
      </button>
    </template>
  </Dialog>
</template>
