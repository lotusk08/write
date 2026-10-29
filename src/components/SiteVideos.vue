<script setup lang="ts">
import { computed, ref } from "vue";
import type { MediaVideo } from "../../shared/media.ts";
import { videoKeysIn } from "../../shared/media.ts";
import { embedExtra, embedTag } from "../editor/blog.ts";
import { deleteMediaVideos, fetchMediaVideos, PasswordRejected } from "../lib/api.ts";
import { draftStore } from "../lib/db.ts";
import { draftLabel } from "../lib/draft.ts";
import { slugFromPath } from "../lib/paths.ts";
import Icon from "./Icon.vue";
import SignIn from "./SignIn.vue";
import { useFloatingMenu } from "./useFloatingMenu.ts";
import { useSignIn } from "./useSignIn.ts";

const FRESH_MS = 24 * 60 * 60 * 1000;
const BATCH = 50;

const open = ref(false);
const anchor = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);
const videos = ref<MediaVideo[] | null>(null);
const local = ref<Map<string, string[]> | null>(new Map());
const problem = ref("");
const notice = ref("");
const busy = ref(false);
const copied = ref("");
const { password, asking, credential, accepted, signedIn, forget } = useSignIn();

useFloatingMenu(open, anchor, list);

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
const day = (time: number) => new Date(time).toISOString().slice(0, 10);
const nameOf = (key: string) => key.replace(/^video\//, "").replace(/-[0-9a-f]{12}\.\w+$/, "");
const usesOf = (video: MediaVideo) => [...video.used.map(slugFromPath), ...(local.value?.get(video.key) ?? []).map((title) => `${title} (on this device)`)];
const unused = (video: MediaVideo) => local.value !== null && usesOf(video).length === 0;
const fresh = (video: MediaVideo) => Date.now() - video.uploaded < FRESH_MS;
const sweepable = computed(() => (videos.value ?? []).filter((video) => unused(video) && !fresh(video)));
const total = computed(() => (videos.value ?? []).reduce((sum, video) => sum + video.size, 0));

async function localUses(): Promise<Map<string, string[]>> {
  const uses = new Map<string, string[]>();
  for (const draft of await draftStore.all()) {
    for (const key of videoKeysIn(JSON.stringify(draft.doc))) {
      uses.set(key, [...(uses.get(key) ?? []), draftLabel(draft)]);
    }
  }
  return uses;
}

const load = async () => {
  problem.value = "";
  videos.value = null;
  if (asking.value && !password.value) {
    return;
  }
  try {
    const [found, uses] = await Promise.all([fetchMediaVideos(credential()), localUses().catch(() => null)]);
    accepted();
    local.value = uses;
    videos.value = found;
  } catch (cause) {
    if (cause instanceof PasswordRejected) {
      forget();
    }
    problem.value = cause instanceof Error ? cause.message : "Could not read the videos.";
  }
};

const toggle = () => {
  open.value = !open.value;
  notice.value = "";
  if (open.value) {
    void load();
  }
};

const remove = async (chosen: MediaVideo[]) => {
  const size = megabytes(chosen.reduce((sum, video) => sum + video.size, 0));
  const what = chosen.length === 1 ? nameOf(chosen[0].key) : `${chosen.length} videos`;
  if (!window.confirm(`Delete ${what} (${size}) from the media bucket? This cannot be undone.`)) {
    return;
  }
  busy.value = true;
  try {
    const deleted: string[] = [];
    const kept: { key: string; used: string[] }[] = [];
    for (let at = 0; at < chosen.length; at += BATCH) {
      const done = await deleteMediaVideos(chosen.slice(at, at + BATCH).map((video) => video.key), credential());
      deleted.push(...done.deleted);
      kept.push(...done.kept);
    }
    notice.value = [
      deleted.length ? `Deleted ${deleted.length === 1 ? nameOf(deleted[0]) : `${deleted.length} videos`}.` : "",
      kept.length ? `Kept ${kept.length}: a file on the site uses ${kept.length === 1 ? "it" : "them"}.` : "",
    ].filter(Boolean).join(" ");
    await load();
  } catch (cause) {
    if (cause instanceof PasswordRejected) {
      forget();
    }
    problem.value = cause instanceof Error ? cause.message : "Could not delete the videos.";
  } finally {
    busy.value = false;
  }
};

const copy = async (video: MediaVideo) => {
  const tag = embedTag("video", video.url, embedExtra({ poster: video.poster }));
  try {
    await navigator.clipboard.writeText(tag);
    copied.value = video.key;
  } catch {
    problem.value = "The clipboard would not take the tag.";
  }
};
</script>

<template>
  <button
    ref="anchor"
    type="button"
    class="btn icon ghost"
    title="Videos in the media bucket"
    aria-label="Videos"
    aria-haspopup="dialog"
    :aria-expanded="open"
    @click="toggle"
  >
    <Icon name="video" />
  </button>
  <Teleport to="body">
    <div v-if="open" ref="list" class="menu file-list site-list video-list" role="dialog" aria-label="Videos in the media bucket" tabindex="-1">
      <p v-if="problem" class="notice warn">
        {{ problem }}
        <button v-if="!asking" type="button" class="btn tiny" @click="load">Read again</button>
      </p>
      <SignIn
        v-if="asking"
        id="videos-password"
        v-model="password"
        @submit="load"
        @session="(token) => (signedIn(token), load())"
        @error="(message) => (problem = message)"
      />
      <template v-if="!asking && !problem">
        <p v-if="!videos" class="notice">Reading the bucket…</p>
        <p v-else-if="!videos.length" class="notice">No videos uploaded yet.</p>
        <div v-else class="video-list-head">
          <span>{{ videos.length }} video(s), {{ megabytes(total) }}</span>
          <button v-if="sweepable.length" type="button" class="btn tiny danger" :disabled="busy" @click="remove(sweepable)">
            Delete {{ sweepable.length }} unused
          </button>
        </div>
      </template>
      <p v-if="videos && !local" class="notice warn">This device's drafts could not be read, so no video is offered for deletion.</p>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <div v-for="video in videos ?? []" :key="video.key" :class="['video-row', { 'is-unused': unused(video) }]">
        <img v-if="video.poster" class="video-row-still" :src="video.poster" alt="" loading="lazy" />
        <span v-else class="video-row-still"><Icon name="video" :size="16" /></span>
        <div class="video-row-text">
          <a class="file-list-title" :href="video.url" target="_blank" rel="noreferrer" :title="video.key">{{ nameOf(video.key) }}</a>
          <span class="video-row-meta">{{ megabytes(video.size) }} · {{ day(video.uploaded) }}</span>
          <span class="video-row-uses" :title="usesOf(video).join('\n')">
            {{ unused(video) ? (fresh(video) ? "Not used yet — uploaded today" : "Not used") : usesOf(video).length ? `In ${usesOf(video).join(", ")}` : "Not used on the site" }}
          </span>
        </div>
        <div class="video-row-actions">
          <button type="button" class="btn tiny" :title="'Copy its tag, to put it in a post'" @click="copy(video)">
            {{ copied === video.key ? "Copied" : "Tag" }}
          </button>
          <button v-if="unused(video)" type="button" class="btn tiny danger" :disabled="busy" @click="remove([video])">Delete</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
