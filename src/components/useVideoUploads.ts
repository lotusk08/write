import { reactive, ref, watch } from "vue";
import { type Embed, embedExtra, embedTag } from "../editor/blog.ts";
import { fetchAppConfig, fetchDropboxVideo, HttpError, PasswordRejected } from "../lib/api.ts";
import { slugify } from "../lib/text.ts";
import { type PreparedVideo, prepareVideo, type UploadedVideo, uploadVideo } from "../lib/video.ts";
import { useSignIn } from "./useSignIn.ts";

export type VideoSource = File | { dropbox: string };

export interface VideoJob {
  id: number;
  name: string;
  stage: "fetching" | "preparing" | "signing-in" | "uploading" | "done" | "failed";
  fraction: number;
  note: string;
  tag: string;
  draft?: string;
  stop: () => void;
}

const DONE_MS = 5000;

const jobs = ref<VideoJob[]>([]);
let counter = 0;
let waiting: (() => void)[] = [];
const { asking, credential, accepted, forget } = useSignIn();

function dismiss(job: VideoJob): void {
  jobs.value = jobs.value.filter((entry) => entry.id !== job.id);
}

export function resume(): void {
  waiting.shift()?.();
}

function resumeAll(): void {
  const ready = waiting;
  waiting = [];
  for (const go of ready) {
    go();
  }
}

watch(asking, (now) => {
  if (!now) {
    resumeAll();
  }
});

function signedIn(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const go = () => {
      signal.removeEventListener("abort", stop);
      resolve();
    };
    const stop = () => {
      waiting = waiting.filter((entry) => entry !== go);
      reject(signal.reason);
    };
    waiting.push(go);
    signal.addEventListener("abort", stop, { once: true });
  });
}

async function signed<T>(
  job: VideoJob,
  stage: VideoJob["stage"],
  signal: AbortSignal,
  step: (password: string, authorized: () => void) => Promise<T>,
): Promise<T> {
  for (;;) {
    if (asking.value) {
      job.stage = "signing-in";
      await signedIn(signal);
    }
    job.stage = stage;
    let trying = asking.value;
    const authorized = () => {
      if (trying) {
        trying = false;
        accepted();
      }
    };
    try {
      const done = await step(credential(), authorized);
      authorized();
      return done;
    } catch (cause) {
      const locked = cause instanceof HttpError && cause.status === 429;
      if (cause instanceof PasswordRejected || locked) {
        job.note = locked ? cause.message : job.note;
        forget();
        continue;
      }
      if (trying) {
        resume();
      }
      throw cause;
    }
  }
}

function send(job: VideoJob, video: PreparedVideo, name: string, signal: AbortSignal): Promise<UploadedVideo> {
  return signed(job, "uploading", signal, (password, authorized) =>
    uploadVideo(video, name, password, signal, (fraction) => (job.fraction = fraction), authorized),
  );
}

async function run(job: VideoJob, source: VideoSource, place: (embed: Embed, sent: boolean) => boolean, signal: AbortSignal): Promise<void> {
  try {
    const config = await fetchAppConfig();
    signal.throwIfAborted();
    if (!config?.media) {
      throw new Error("Video uploads are not set up here: the Worker needs an R2 bucket bound as MEDIA, and MEDIA_URL set to where it is served from.");
    }
    let file: File;
    if (source instanceof File) {
      file = source;
    } else {
      job.note = "Fetching it from Dropbox…";
      file = await signed(job, "fetching", signal, (password, authorized) =>
        fetchDropboxVideo(source.dropbox, password, signal, (fraction) => (job.fraction = fraction), authorized),
      );
      job.stage = "preparing";
      job.fraction = 0;
    }
    job.note = "Making it an MP4 every browser plays…";
    const video = await prepareVideo(file, signal, (fraction) => (job.fraction = fraction));
    job.note = video.note;
    job.fraction = 0;
    const uploaded = await send(job, video, slugify(file.name.replace(/\.[^.]*$/, "")), signal);
    signal.throwIfAborted();
    const embed: Embed = {
      platform: "video",
      id: uploaded.url,
      extra: embedExtra({ poster: uploaded.poster, width: video.width || null, height: video.height || null }),
    };
    job.stage = "done";
    job.fraction = 1;
    if (place(embed, uploaded.sent)) {
      job.note = `${video.note} It is in the post.`;
      window.setTimeout(() => dismiss(job), DONE_MS);
    } else {
      job.tag = embedTag(embed.platform, embed.id, embed.extra);
      job.note = "Uploaded, but its draft is not open in the editor now, or the player it was replacing is gone: copy its tag and paste it where it goes.";
    }
  } catch (cause) {
    if (signal.aborted) {
      dismiss(job);
      return;
    }
    job.stage = "failed";
    job.note = cause instanceof Error ? cause.message : String(cause);
  }
}

function add(source: VideoSource, place: (embed: Embed, sent: boolean) => boolean, draft?: string): void {
  const controller = new AbortController();
  const job = reactive<VideoJob>({
    id: ++counter,
    name: source instanceof File ? source.name : decodeURIComponent(new URL(source.dropbox).pathname.split("/").pop() || "Dropbox video"),
    stage: source instanceof File ? "preparing" : "fetching",
    fraction: 0,
    note: "",
    tag: "",
    draft,
    stop: () => controller.abort(),
  });
  jobs.value = [...jobs.value, job];
  void run(job, source, place, controller.signal);
}

export function useVideoUploads() {
  return { jobs, add, dismiss };
}
