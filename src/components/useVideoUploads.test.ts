// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

const calls: string[] = [];
const gates = new Map<string, Promise<void>>();
const fail = new Set<string>();
const noPoster = new Set<string>();
const skipped = new Set<string>();
const stills = new Set<string>();
vi.mock("../lib/api.ts", async (original) => {
  const api = await original<typeof import("../lib/api.ts")>();
  return {
    ...api,
    fetchAppConfig: async () => ({ media: "https://m" }),
    login: async (password: string) => {
      calls.push(`login:${password}`);
      if (password !== "right") {
        throw new api.PasswordRejected("Wrong password.");
      }
      return "session";
    },
  };
});
vi.mock("../lib/video.ts", async () => {
  return {
    prepareVideo: async () => ({
      blob: new Blob(["x"]),
      source: new Blob(["x"]),
      type: "video/mp4",
      width: 1,
      height: 1,
      poster: async () => null,
      note: "",
    }),
    uploadVideo: async (_video: unknown, name: string, signal: AbortSignal) => {
      calls.push(name);
      if (fail.has(name)) {
        throw new Error("The connection dropped.");
      }
      await gates.get(name);
      signal.throwIfAborted();
      return {
        url: `https://m/video/${name}-0123456789ab.mp4`,
        poster: stills.has(name) && !noPoster.has(name) ? `https://m/video/${name}-0123456789ab.webp` : null,
        posterProblem: noPoster.has(name) ? "Its still did not upload: The connection dropped." : "",
        sent: !skipped.has(name),
      };
    },
  };
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(async () => {
  calls.length = 0;
  gates.clear();
  fail.clear();
  noPoster.clear();
  skipped.clear();
  stills.clear();
  const { useSignIn } = await import("./useSignIn.ts");
  useSignIn().forget();
});

async function queue(names: string[]) {
  const { useVideoUploads } = await import("./useVideoUploads.ts");
  const { jobs, add } = useVideoUploads();
  const placed: string[] = [];
  for (const name of names) {
    add(new File(["x"], `${name}.mp4`, { type: "video/mp4" }), (embed) => (placed.push(embed.id), true), "draft");
  }
  await settle();
  return { jobs, placed };
}

it("signs in once for each typed password, then sends every waiting upload with the session alone", async () => {
  const { resume } = await import("./useVideoUploads.ts");
  const { useSignIn } = await import("./useSignIn.ts");
  const { password } = useSignIn();
  const { jobs, placed } = await queue(["a", "b", "c", "d"]);
  expect(jobs.value.filter((job) => ["a.mp4", "b.mp4", "c.mp4", "d.mp4"].includes(job.name)).map((job) => job.stage)).toEqual(["signing-in", "signing-in", "signing-in", "signing-in"]);
  password.value = "typo";
  resume();
  await settle();
  expect(calls).toEqual(["login:typo"]);
  password.value = "right";
  resume();
  await settle();
  expect(calls.slice(1, 2)).toEqual(["login:right"]);
  expect(calls.slice(2).sort()).toEqual(["a", "b", "c", "d"]);
  expect(password.value).toBe("");
  expect(placed).toHaveLength(4);
});

it("starts every waiting upload as soon as a passkey signs in, not after the first upload ends", async () => {
  const { useSignIn } = await import("./useSignIn.ts");
  let open = () => {};
  gates.set("e", new Promise((resolve) => (open = resolve)));
  await queue(["e", "f", "g"]);
  useSignIn().signedIn("session");
  await settle();
  expect(calls.sort()).toEqual(["e", "f", "g"]);
  open();
});

it("keeps the others going when the upload that signed in fails for another reason", async () => {
  const { resume } = await import("./useVideoUploads.ts");
  const { useSignIn } = await import("./useSignIn.ts");
  fail.add("h");
  const { jobs } = await queue(["h", "i"]);
  useSignIn().password.value = "right";
  resume();
  await settle();
  expect(calls).toContain("i");
  expect(jobs.value.find((job) => job.name === "i.mp4")?.stage).toBe("done");
});

it("finishes an upload whose poster did not go, but keeps a note up saying so", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"], shouldAdvanceTime: true });
  try {
    const { resume } = await import("./useVideoUploads.ts");
    const { useSignIn } = await import("./useSignIn.ts");
    noPoster.add("j");
    stills.add("j");
    stills.add("k");
    const { jobs, placed } = await queue(["j", "k"]);
    useSignIn().password.value = "right";
    resume();
    await settle();
    expect(placed).toHaveLength(2);
    const job = (name: string) => jobs.value.find((entry) => entry.name === name);
    expect(job("j.mp4")).toMatchObject({ stage: "done", note: expect.stringContaining("No poster: Its still did not upload: The connection dropped. Use Make poster in Videos") });
    expect(job("k.mp4")?.note).not.toContain("No poster");
    await vi.advanceTimersByTimeAsync(6000);
    expect(job("j.mp4")?.stage).toBe("done");
    expect(job("k.mp4")).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

it("closes an upload this browser took no still of by itself, saying the blog takes one", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"], shouldAdvanceTime: true });
  try {
    const { resume } = await import("./useVideoUploads.ts");
    const { useSignIn } = await import("./useSignIn.ts");
    noPoster.add("m");
    stills.add("m");
    skipped.add("m");
    const { jobs } = await queue(["l", "m"]);
    useSignIn().password.value = "right";
    resume();
    await settle();
    const job = (name: string) => jobs.value.find((entry) => entry.name === name);
    expect(job("l.mp4")?.note).toContain("No still from this browser; the blog takes one at build.");
    expect(job("m.mp4")?.note).toContain("No poster: Its still did not upload");
    expect(job("m.mp4")?.note).not.toContain("Make poster");
    await vi.advanceTimersByTimeAsync(6000);
    expect(job("l.mp4")).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});
