<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Icon from "./Icon.vue";
import SignIn from "./SignIn.vue";
import { useSignIn } from "./useSignIn.ts";
import { resume, type VideoJob, useVideoUploads } from "./useVideoUploads.ts";

const { jobs, dismiss } = useVideoUploads();
const { password, signedIn } = useSignIn();
const problem = ref("");
const copied = ref(0);

const STAGES: Record<VideoJob["stage"], string> = {
  fetching: "Fetching",
  preparing: "Preparing",
  "signing-in": "Waiting for the password",
  uploading: "Uploading",
  done: "Uploaded",
  failed: "Not uploaded",
};

const finished = (job: VideoJob) => job.stage === "done" || job.stage === "failed";
const moving = (job: VideoJob) => job.stage === "fetching" || job.stage === "preparing" || job.stage === "uploading";
const asking = computed(() => jobs.value.some((job) => job.stage === "signing-in"));
const busy = computed(() => jobs.value.some((job) => !finished(job)));

const copy = async (job: VideoJob) => {
  try {
    await navigator.clipboard.writeText(job.tag);
    copied.value = job.id;
  } catch {
    problem.value = "The clipboard would not take it; select the tag and copy it.";
  }
};

const guard = (event: BeforeUnloadEvent) => {
  if (busy.value) {
    event.preventDefault();
  }
};
onMounted(() => window.addEventListener("beforeunload", guard));
onBeforeUnmount(() => window.removeEventListener("beforeunload", guard));
</script>

<template>
  <section v-if="jobs.length" class="video-uploads" aria-label="Video uploads">
    <article v-for="job in jobs" :key="job.id" :class="['video-job', `is-${job.stage}`]">
      <div class="video-job-head">
        <Icon name="videoUpload" :size="14" />
        <strong class="video-job-name" :title="job.name">{{ job.name }}</strong>
        <button type="button" class="btn tiny" @click="finished(job) ? dismiss(job) : job.stop()">
          {{ finished(job) ? "Close" : "Stop" }}
        </button>
      </div>
      <progress v-if="moving(job)" :value="job.fraction" max="1" :aria-label="`${STAGES[job.stage]} ${job.name}`"></progress>
      <p class="video-job-note" role="status">
        <span class="video-job-stage">{{ STAGES[job.stage] }}<template v-if="moving(job)"> · {{ Math.round(job.fraction * 100) }}%</template></span>
        {{ job.note }}
      </p>
      <template v-if="job.tag">
        <code class="video-job-tag">{{ job.tag }}</code>
        <button type="button" class="btn tiny" @click="copy(job)">{{ copied === job.id ? "Copied" : "Copy tag" }}</button>
      </template>
    </article>
    <SignIn
      v-if="asking"
      id="video-password"
      v-model="password"
      @submit="resume"
      @session="(token) => (signedIn(token), resume())"
      @error="(message) => (problem = message)"
    />
    <p v-if="problem" class="notice warn">{{ problem }}</p>
  </section>
</template>
