<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import type { AppConfig, PublishResult } from "../../shared/types.ts";
import { fetchPostSource, PasswordRejected } from "../lib/api.ts";
import { isLocalSrc, resolveDisplaySrc, type Draft } from "../lib/db.ts";
import { diffLines, type LineDiff } from "../lib/diff.ts";
import { pinWords } from "../lib/home.ts";
import { shrinks } from "../lib/images.ts";
import { buildPublishPlan, defaultCommitMessage, sendPlan, type PublishPlan, type PublishWarning } from "../lib/publish.ts";
import type { Settings } from "../lib/settings.ts";
import { previewSrc } from "../lib/site.ts";
import { datePrefix } from "../lib/text.ts";
import Dialog from "./Dialog.vue";
import SignIn from "./SignIn.vue";
import Toggle from "./Toggle.vue";
import type { ToggleOption } from "./types.ts";
import { useSignIn } from "./useSignIn.ts";

const props = defineProps<{ draft: Draft; settings: Settings; config: AppConfig | null }>();
const emit = defineEmits<{
  settings: [patch: Partial<Settings>];
  close: [];
  published: [draftId: string, result: PublishResult, plan: PublishPlan];
  fixPhoto: [src: string];
  editPost: [];
  fixField: [field: "title" | "description"];
  reopen: [];
}>();

const TARGETS: ToggleOption<Settings["publishTarget"]>[] = [
  { id: "posts", label: "Post" },
  { id: "drafts", label: "Draft" },
];

const plan = ref<PublishPlan | null>(null);
const message = ref(defaultCommitMessage(props.draft, Boolean(props.draft.publishedPath)));
const state = ref<"review" | "sending" | "done">("review");
const sent = ref(0);
const error = ref<string | null>(null);
const refused = ref(false);
const result = ref<PublishResult | null>(null);
const thumbs = reactive(new Map<string, string>());
const widths = reactive(new Map<string, number>());
const changes = ref<LineDiff | null>(null);
const { password, rejected, asking, credential, accepted, signedIn, forget } = useSignIn();
const signIn = ref<InstanceType<typeof SignIn> | null>(null);
const primary = ref<HTMLButtonElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);
const warningList = ref<HTMLUListElement | null>(null);
let controller: AbortController | null = null;

onMounted(() => {
  const opened = props.draft.publishedPath;
  const target = opened?.startsWith(`${props.settings.draftsDir.replace(/^\/+|\/+$/g, "")}/`) ? "drafts" : "posts";
  if (target !== props.settings.publishTarget) {
    emit("settings", { publishTarget: target });
  }
  void nextTick(() => (asking.value ? signIn.value?.focus() : primary.value?.focus()));
});

let generation = 0;
watch(
  () => [props.draft, props.settings] as const,
  ([draft, settings]) => {
    if (state.value !== "review") {
      return;
    }
    const mine = ++generation;
    plan.value = null;
    void buildPublishPlan(draft, settings)
      .then((next) => {
        if (mine === generation) {
          plan.value = next;
          next.photos.forEach((photo) => {
            void thumb(photo.src);
            measure(photo.src, photo.blob);
          });
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

watch(state, async (now) => {
  await nextTick();
  (now === "sending" ? cancelButton.value : primary.value)?.focus();
});

watch(rejected, async () => {
  await nextTick();
  signIn.value?.focus();
});

watch(error, async (text) => {
  await nextTick();
  if (text && state.value === "review" && !signIn.value?.$el.contains(document.activeElement)) {
    (warningList.value?.querySelector("button") ?? primary.value)?.focus();
  }
});

function measure(src: string, blob: Blob) {
  if (widths.has(src)) {
    return;
  }
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = image.onerror = () => {
    widths.set(src, image.naturalWidth);
    URL.revokeObjectURL(url);
  };
  image.src = url;
}

async function thumb(src: string) {
  if (!thumbs.has(src)) {
    const url = isLocalSrc(src) ? await resolveDisplaySrc(src).catch(() => null) : previewSrc(src);
    if (url) {
      thumbs.set(src, url);
    }
  }
}

const cover = computed(() => props.draft.meta.cover?.path ?? "");
watch(cover, (src) => src && void thumb(src), { immediate: true });

const isPost = computed(() => props.settings.publishTarget === "posts");
const updating = computed(() => props.draft.publishedPath === plan.value?.markdownPath);
const action = computed(() => (!isPost.value ? "Save draft" : updating.value ? "Update post" : "Publish post"));
const hidden = computed(() => Boolean(plan.value?.warnings.some((warning) => warning.kind === "hidden")));
const liveUrl = computed(() =>
  props.config?.siteUrl && plan.value && !hidden.value ? `${props.config.siteUrl.replace(/\/+$/, "")}/${plan.value.slug}` : "",
);
const date = computed(() => {
  const day = new Date(`${datePrefix(props.draft.meta.date)}T00:00:00`);
  return Number.isNaN(day.getTime()) ? "" : day.toLocaleDateString(undefined, { dateStyle: "medium" });
});
const pinned = computed(() => (props.draft.meta.pin ? pinWords(props.draft.meta.pin).replace(/^p/, "P") : ""));

const renamedFrom = computed(() =>
  props.draft.publishedPath && plan.value && !updating.value ? props.draft.publishedPath : null,
);

const blocked = computed(() =>
  props.config === null
    ? "This app's own API did not answer, so it cannot publish. Reload and try again."
    : props.config.ready
      ? null
      : (props.config.problem ?? "This deployment is not configured to publish."),
);

const failure = computed<PublishWarning | null>(() => {
  const text = error.value;
  return text && refused.value ? { kind: "missing", text } : text ? { kind: text.includes("changed on the site") ? "stale" : text.includes("already has a post") ? "existing" : "retry", text } : null;
});

const warnings = computed(() => plan.value?.warnings ?? []);
const stops = computed(() => warnings.value.find((warning) => warning.blocks)?.text ?? null);
const reason = computed(() =>
  blocked.value ?? stops.value ?? (!plan.value ? "Preparing…" : asking.value && !password.value ? "Type the password or use a passkey." : null),
);

const megabytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const FIXES: Partial<Record<PublishWarning["kind"], [string, (warning: PublishWarning) => void]>> = {
  date: ["Change the date", () => emit("editPost")],
  alt: ["Add alt text", (warning) => warning.src && emit("fixPhoto", warning.src)],
  title: ["Add a title", () => emit("fixField", "title")],
  description: ["Add", () => emit("fixField", "description")],
  existing: ["Change title or date", () => emit("editPost")],
  unguarded: ["Open the site version", () => emit("reopen")],
  stale: ["Open the site version", () => emit("reopen")],
  retry: ["Try again", () => void retry()],
};

const loadChanges = async (event: Event) => {
  const path = props.draft.publishedPath;
  if (!(event.target as HTMLDetailsElement).open || changes.value || !path || !plan.value) {
    return;
  }
  try {
    changes.value = diffLines((await fetchPostSource(path, credential())).markdown, plan.value.markdown);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
};

const run = async () => {
  if (!plan.value || reason.value || state.value !== "review") {
    return;
  }
  state.value = "sending";
  sent.value = 0;
  error.value = null;
  refused.value = false;
  controller = new AbortController();
  const id = props.draft.id;
  const sending = plan.value;
  try {
    result.value = await sendPlan(sending, message.value, credential(), (done) => (sent.value = done), controller.signal);
    accepted();
    state.value = "done";
    emit("published", id, result.value, sending);
  } catch (cause) {
    state.value = "review";
    if (controller.signal.aborted) {
      return;
    }
    if (cause instanceof PasswordRejected) {
      refused.value = true;
      forget();
    }
    error.value =
      cause instanceof TypeError
        ? "Could not reach the site. Check the connection and try again."
        : cause instanceof Error
          ? cause.message
          : String(cause);
  } finally {
    controller = null;
  }
};

async function retry() {
  error.value = null;
  plan.value = null;
  try {
    plan.value = await buildPublishPlan(props.draft, props.settings);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
    return;
  }
  await run();
}

const cancel = () => (state.value === "sending" ? controller?.abort() : emit("close"));
const committing = computed(() => Boolean(plan.value && sent.value >= plan.value.photos.length));
</script>

<template>
  <Dialog title="Publish" :subtitle="`${settings.repo} · ${settings.branch}`" :locked="state === 'sending'" @close="emit('close')">
    <div v-if="state === 'done' && result" class="publish-done" aria-live="polite">
      <p class="publish-done-title">✓ {{ isPost ? "Published" : "Saved" }} <span class="mono">{{ plan?.slug }}</span> to {{ result.branch }}</p>
      <p class="hint">
        {{ plan?.photos.length ?? 0 }} photo(s) uploaded<template v-if="plan?.moved.length">, {{ plan.moved.length }} renamed</template>.
        <template v-if="isPost && hidden">Hidden, so the site's build leaves it out.</template>
        <template v-else-if="isPost">Live in a few minutes, after the site builds.</template>
      </p>
      <p class="publish-links">
        <a :href="result.commitUrl" target="_blank" rel="noreferrer">View commit ↗</a>
        <a v-if="isPost && liveUrl" :href="liveUrl" target="_blank" rel="noreferrer">Open post ↗</a>
      </p>
    </div>

    <div v-else :inert="state === 'sending'">
      <div v-if="blocked" class="notice warn">{{ blocked }}</div>
      <ul v-if="failure || warnings.length" ref="warningList" class="notice warn publish-warnings" aria-live="polite">
        <li v-for="warning in failure ? [failure, ...warnings] : warnings" :key="warning.text">
          <span>{{ warning.text }}</span>
          <button v-if="FIXES[warning.kind]" type="button" class="btn tiny" @click="FIXES[warning.kind]![1](warning)">
            {{ FIXES[warning.kind]![0] }}
          </button>
        </li>
      </ul>

      <div class="menu-row publish-as">
        <span class="field-label">Publish as</span>
        <Toggle
          label="Publish as"
          :options="TARGETS"
          :value="settings.publishTarget"
          @change="(publishTarget) => emit('settings', { publishTarget })"
        />
      </div>
      <p v-if="plan" class="publish-where">
        <span class="mono">{{ plan.markdownPath }}</span>
        <a v-if="isPost && liveUrl" :href="liveUrl" target="_blank" rel="noreferrer">{{ liveUrl.replace(/^https?:\/\//, "") }} ↗</a>
      </p>
      <p v-if="renamedFrom && plan?.remove.includes(renamedFrom)" class="hint">
        Moves the draft: <span class="mono">{{ renamedFrom }}</span> is removed in the same commit.
      </p>
      <p v-else-if="renamedFrom" class="hint">
        Writes a new file; <span class="mono">{{ renamedFrom }}</span> stays on the blog — delete it there if you meant to rename it.
      </p>

      <div class="publish-card">
        <img v-if="cover && thumbs.get(cover)" :src="thumbs.get(cover)" alt="" class="publish-cover" />
        <div>
          <p class="publish-title">{{ draft.meta.title || "Untitled" }}</p>
          <p class="hint">{{ [date, pinned].filter(Boolean).join(" · ") }}</p>
          <p :class="draft.meta.description ? 'publish-description' : 'hint'">{{ draft.meta.description || "No description" }}</p>
          <p v-if="draft.meta.tags.length" class="publish-tags">
            <span v-for="tag in draft.meta.tags" :key="tag">{{ tag }}</span>
          </p>
        </div>
      </div>

      <div v-if="plan && (plan.photos.length || plan.moved.length)" class="field">
        <span class="field-label">
          Photos · {{ plan.photos.length }} new<template v-if="plan.moved.length"> · {{ plan.moved.length }} renamed</template>
        </span>
        <ul v-if="plan.photos.length" class="publish-photos">
          <li v-for="(photo, index) in plan.photos" :key="photo.path" :class="{ 'is-sent': state === 'sending' && index < sent }">
            <img v-if="thumbs.get(photo.src)" :src="thumbs.get(photo.src)" alt="" />
            <span class="mono" :title="fileName(photo.path)">{{ fileName(photo.path) }}</span>
            <span class="hint">
              {{ megabytes(photo.blob.size) }}<template v-if="shrinks(photo.blob, widths.get(photo.src))"> · reduced</template>
            </span>
          </li>
        </ul>
        <ul v-if="plan.moved.length" class="publish-moves mono">
          <li v-for="[from, to] in plan.moved" :key="from">{{ from }} → {{ to }}</li>
        </ul>
        <p v-if="plan.redirects.length" class="hint">Old addresses redirect to the new ones once the site deploys.</p>
      </div>

      <details v-if="draft.publishedPath && plan" class="publish-details" @toggle="loadChanges">
        <summary>
          Changes since the site version<template v-if="changes"> · +{{ changes.added }} −{{ changes.removed }}</template>
        </summary>
        <div v-if="changes" class="code-preview publish-diff">
          <p v-if="!changes.hunks.length" class="hint">No changes to the text.</p>
          <div v-for="(hunk, index) in changes.hunks" :key="index" class="publish-hunk">
            <span v-for="(line, at) in hunk" :key="at" :class="`diff-${line.kind === '+' ? 'add' : line.kind === '-' ? 'del' : 'same'}`">{{ line.kind }} {{ line.text }}</span>
          </div>
        </div>
        <p v-else class="hint">Reading the site's copy…</p>
      </details>

      <details class="publish-details">
        <summary>Commit message <span class="hint">{{ message }}</span></summary>
        <input id="publish-message" v-model="message" class="input" aria-label="Commit message" />
      </details>

      <SignIn
        v-if="asking"
        id="publish-password"
        ref="signIn"
        v-model="password"
        :disabled="Boolean(blocked)"
        @submit="run"
        @session="(token) => (signedIn(token), (error = null))"
        @error="(text) => (error = text)"
      />
    </div>

    <template #footer>
      <template v-if="state === 'done'">
        <button ref="primary" type="button" class="btn primary" @click="emit('close')">Done</button>
      </template>
      <template v-else>
        <div v-if="state === 'sending'" class="publish-progress" aria-live="polite">
          <progress :value="sent" :max="Math.max(1, plan?.photos.length ?? 1)" />
          <span>{{ committing ? "Committing…" : `Photo ${sent + 1} of ${plan?.photos.length} · ${fileName(plan?.photos[sent]?.path ?? "")}` }}</span>
        </div>
        <span v-else-if="reason" class="hint publish-reason">{{ reason }}</span>
        <button ref="cancelButton" type="button" class="btn" :disabled="state === 'sending' && committing" @click="cancel">Cancel</button>
        <button
          v-if="state === 'review'"
          ref="primary"
          type="button"
          class="btn primary"
          :disabled="Boolean(reason)"
          :title="reason ?? undefined"
          @click="run"
        >
          {{ action }}
        </button>
      </template>
    </template>
  </Dialog>
</template>
