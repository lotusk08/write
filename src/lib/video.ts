import { MAX_VIDEO_BYTES, type MediaPart, PART_BYTES, VIDEO_TYPES } from "../../shared/media.ts";
import { abortMedia, completeMedia, HttpError, PasswordRejected, sendMediaPart, startMedia, uploadPoster } from "./api.ts";

const MAX_EDGE = 1920;
const COPY_BITRATE = 10_000_000;
const POSTER_EDGE = 1280;
const POSTER_QUALITY = 0.82;
const STILL_WAIT_MS = 15_000;
const SAMPLE_BYTES = 8 * 1024 * 1024;
const PARALLEL_PARTS = 3;
const PART_TRIES = 3;
const PLAYABLE = new Set(["avc", "vp8", "vp9", "av1"]);

export interface PreparedVideo {
  blob: Blob;
  source: Blob;
  type: string;
  width: number;
  height: number;
  poster: Blob | null;
  note: string;
}

export interface UploadedVideo {
  url: string;
  poster: string | null;
  sent: boolean;
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

async function convert(
  file: File,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<{ blob: Blob | null; codec: string | null; copied: boolean }> {
  const { BlobSource, BufferTarget, canEncodeAudio, canEncodeVideo, Conversion, Input, MATROSKA, MP4, Mp4OutputFormat, Output, QTFF, QUALITY_HIGH, WEBM } =
    await import("mediabunny");
  const input = new Input({ source: new BlobSource(file), formats: [MP4, QTFF, WEBM, MATROSKA] });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) {
      throw new Error(`${file.name} has no video in it.`);
    }
    const [codec, width, height, bitrate] = await Promise.all([
      track.getCodec(),
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.getAverageBitrate().catch(() => null),
    ]);
    if (typeof VideoEncoder === "undefined") {
      return { blob: null, codec, copied: false };
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const fits = codec === "avc" && scale === 1 && bitrate !== null && bitrate <= COPY_BITRATE;
    const size = scale < 1 ? (width >= height ? { width: Math.round(width * scale) } : { height: Math.round(height * scale) }) : {};
    if (!fits && !(await canEncodeVideo("avc", { width: Math.round(width * scale), height: Math.round(height * scale) }))) {
      return { blob: null, codec, copied: false };
    }
    const aac = await canEncodeAudio("aac");
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      video: fits ? {} : { ...size, fit: "contain", codec: "avc", quality: QUALITY_HIGH },
      audio: async (audio) => ((await audio.getCodec()) === "aac" || !aac ? {} : { codec: "aac", quality: QUALITY_HIGH }),
    });
    if (!conversion.isValid || !conversion.utilizedTracks.some((used) => used.isVideoTrack())) {
      return { blob: null, codec, copied: false };
    }
    conversion.onProgress = onProgress;
    signal.throwIfAborted();
    const stop = () => void conversion.cancel();
    signal.addEventListener("abort", stop, { once: true });
    try {
      await conversion.execute();
    } finally {
      signal.removeEventListener("abort", stop);
    }
    signal.throwIfAborted();
    const buffer = output.target.buffer;
    return { blob: buffer ? new Blob([buffer], { type: "video/mp4" }) : null, codec, copied: fits };
  } finally {
    input.dispose();
  }
}

function settled(video: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("The video did not load.")), STILL_WAIT_MS);
    const done = (fail: boolean) => () => {
      window.clearTimeout(timer);
      video.removeEventListener(event, ok);
      video.removeEventListener("error", bad);
      if (fail) {
        reject(new Error("The video could not be read."));
      } else {
        resolve();
      }
    };
    const ok = done(false);
    const bad = done(true);
    video.addEventListener(event, ok, { once: true });
    video.addEventListener("error", bad, { once: true });
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, POSTER_QUALITY));
}

async function still(blob: Blob): Promise<{ width: number; height: number; poster: Blob | null }> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    const loaded = settled(video, "loadeddata");
    video.src = url;
    await loaded;
    const { videoWidth: width, videoHeight: height } = video;
    const sought = settled(video, "seeked");
    video.currentTime = Math.min((video.duration || 0) / 4, 2);
    await sought;
    const scale = Math.min(1, POSTER_EDGE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const webp = await canvasBlob(canvas, "image/webp");
    const poster = webp?.type === "image/webp" ? webp : await canvasBlob(canvas, "image/jpeg");
    return { width, height, poster };
  } catch {
    return { width: 0, height: 0, poster: null };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function prepareVideo(file: File, signal: AbortSignal, onProgress: (fraction: number) => void): Promise<PreparedVideo> {
  let made: Awaited<ReturnType<typeof convert>> = { blob: null, codec: null, copied: false };
  try {
    made = await convert(file, signal, onProgress);
  } catch (cause) {
    signal.throwIfAborted();
    if (cause instanceof Error && /has no video/.test(cause.message)) {
      throw cause;
    }
    console.warn("Could not convert the video here; sending it as it is if the blog can play it.", cause);
  }
  const playable = Boolean(VIDEO_TYPES[file.type]) && (made.codec === null || PLAYABLE.has(made.codec));
  const smaller = made.blob && (!playable || made.copied || made.blob.size < file.size) ? made.blob : null;
  const blob = smaller ?? (VIDEO_TYPES[file.type] ? file : null);
  if (!blob) {
    throw new Error(
      made.codec === "hevc"
        ? `${file.name} is HEVC, which this browser cannot decode, so it cannot make an MP4 of it here. Safari can, and Chrome or Edge on a Mac or a Windows PC; or export it from the phone as "Most Compatible".`
        : `This browser cannot turn ${file.name} into an MP4, and the blog cannot play it as it is. Open it in Chrome, Edge or Safari, or export it as MP4 first.`,
    );
  }
  if (blob.size > MAX_VIDEO_BYTES) {
    throw new Error(`${file.name} is ${megabytes(blob.size)}; a video can be ${megabytes(MAX_VIDEO_BYTES)} at most.`);
  }
  const { width, height, poster } = await still(blob);
  signal.throwIfAborted();
  const note = smaller
    ? made.copied
      ? `Repacked to start playing at once, ${megabytes(blob.size)}.`
      : `Made smaller, ${megabytes(file.size)} → ${megabytes(blob.size)}.`
    : playable
      ? `Sent as it came, ${megabytes(blob.size)}.`
      : `Sent as it came, ${megabytes(blob.size)}: its ${made.codec ?? "codec"} may not play in every browser.`;
  return { blob, source: file, type: smaller ? "video/mp4" : file.type, width, height, poster, note };
}

async function fingerprint(blob: Blob, made: boolean): Promise<string> {
  const ends = blob.size <= 2 * SAMPLE_BYTES ? [blob] : [blob.slice(0, SAMPLE_BYTES), blob.slice(blob.size - SAMPLE_BYTES)];
  const sample = new Blob([made ? "made:" : "as-is:", String(blob.size), ...ends]);
  const digest = await crypto.subtle.digest("SHA-256", await sample.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const retryable = (cause: unknown) =>
  !(cause instanceof HttpError && cause.status < 500) && !(cause instanceof PasswordRejected) && !(cause instanceof DOMException && cause.name === "AbortError");

async function sendParts(
  blob: Blob,
  key: string,
  upload: string,
  password: string,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<MediaPart[]> {
  signal.throwIfAborted();
  const count = Math.ceil(blob.size / PART_BYTES);
  const sent = new Array<number>(count).fill(0);
  const parts: MediaPart[] = [];
  const report = () => onProgress(sent.reduce((sum, bytes) => sum + bytes, 0) / blob.size);
  const lanes = new AbortController();
  const stop = () => lanes.abort(signal.reason);
  signal.addEventListener("abort", stop, { once: true });
  let next = 0;
  const lane = async () => {
    while (next < count && !lanes.signal.aborted) {
      const index = next++;
      const body = blob.slice(index * PART_BYTES, (index + 1) * PART_BYTES);
      for (let attempt = 1; ; attempt++) {
        try {
          parts.push(
            await sendMediaPart(key, upload, index + 1, body, password, lanes.signal, (bytes) => {
              sent[index] = bytes;
              report();
            }),
          );
          sent[index] = body.size;
          report();
          break;
        } catch (cause) {
          sent[index] = 0;
          if (attempt >= PART_TRIES || !retryable(cause) || lanes.signal.aborted) {
            lanes.abort(cause);
            throw cause;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 1000 * 2 ** attempt));
        }
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, count) }, lane));
  } finally {
    signal.removeEventListener("abort", stop);
  }
  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

export async function uploadVideo(
  video: PreparedVideo,
  name: string,
  password: string,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
  onAuthorized: () => void = () => {},
): Promise<UploadedVideo> {
  const print = await fingerprint(video.source, video.blob !== video.source);
  signal.throwIfAborted();
  const started = await startMedia({ name, fingerprint: print, size: video.blob.size, type: video.type }, password, signal);
  onAuthorized();
  if (started.upload) {
    try {
      const parts = await sendParts(video.blob, started.key, started.upload, password, signal, onProgress);
      await completeMedia(started.key, started.upload, parts, password, signal);
    } catch (cause) {
      void abortMedia(started.key, started.upload, password).catch(() => undefined);
      throw cause;
    }
  }
  onProgress(1);
  const poster = video.poster ? await uploadPoster(started.key, video.poster, password, signal).catch(() => null) : null;
  signal.throwIfAborted();
  return { url: started.url, poster: poster?.url ?? null, sent: Boolean(started.upload) };
}
