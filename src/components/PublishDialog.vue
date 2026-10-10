<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { AppConfig, PublishResult } from "../../shared/types.ts";
import { PasswordRejected, publish } from "../lib/api.ts";
import type { Draft } from "../lib/db.ts";
import { addPasskey, passkeysAvailable, signInWithPasskey } from "../lib/passkey.ts";
import { rememberPassword, rememberSession, sessionPassword, sessionToken } from "../lib/password.ts";
import { buildPublishPlan, defaultCommitMessage, type PublishPlan } from "../lib/publish.ts";
import type { Settings } from "../lib/settings.ts";
import Dialog from "./Dialog.vue";
import Toggle from "./Toggle.vue";
import type { ToggleOption } from "./types.ts";

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
const error = ref<string | null>(null);
const password = ref(sessionPassword());
const session = ref(sessionToken());
const rejected = ref(0);
const passwordField = ref<HTMLInputElement | null>(null);
const canPasskey = passkeysAvailable();

const asking = computed(() => (!sessionPassword() && !session.value) || rejected.value > 0);

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
    passwordField.value?.focus();
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

/** A 401: forget the password and any session, and put the caret back in the field. */
const forget = () => {
  rejected.value += 1;
  password.value = "";
  session.value = "";
  rememberPassword("");
  rememberSession("");
};

const withPasskey = async (ceremony: () => Promise<string | null>) => {
  busy.value = true;
  error.value = null;
  try {
    const token = await ceremony();
    if (token) {
      rememberSession(token);
      session.value = token;
      rejected.value = 0;
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
};

const run = async () => {
  if (!plan.value || blocked.value || (asking.value && !password.value)) {
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    const result = await publish(
      { message: message.value, files: plan.value.files },
      asking.value ? password.value : sessionPassword(),
    );
    if (asking.value) {
      rememberPassword(password.value);
    }
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
    <div v-if="renamedFrom" class="notice warn">
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

    <div v-if="asking" class="field">
      <label for="publish-password">Password</label>
      <div class="password-row">
        <input
          id="publish-password"
          ref="passwordField"
          v-model="password"
          class="input"
          type="password"
          autocomplete="current-password"
          :autofocus="!canPasskey"
          placeholder="••••••••"
          @keydown.enter.prevent="run"
        />
        <button
          v-if="canPasskey"
          type="button"
          class="btn"
          :disabled="busy || Boolean(blocked)"
          @click="withPasskey(signInWithPasskey)"
        >
          Passkey
        </button>
      </div>
      <button
        v-if="canPasskey && password"
        type="button"
        class="btn tiny save-passkey"
        :disabled="busy || Boolean(blocked)"
        @click="withPasskey(() => addPasskey(password))"
      >
        Save a passkey on this device
      </button>
    </div>

    <div class="field">
      <label for="publish-message">Commit message</label>
      <input id="publish-message" v-model="message" class="input" />
    </div>

    <div class="field">
      <span class="field-label">Files</span>
      <ul v-if="plan" class="file-list">
        <li v-for="file in plan.files" :key="file.path">{{ file.path }}</li>
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
        {{ busy ? "Publishing…" : "Commit" }}
      </button>
    </template>
  </Dialog>
</template>
