// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

const calls: string[] = [];
const gates = new Map<string, Promise<void>>();
const fail = new Set<string>();
vi.mock("../lib/api.ts", async (original) => ({ ...(await original<typeof import("../lib/api.ts")>()), fetchAppConfig: async () => ({ media: "https://m" }) }));
vi.mock("../lib/video.ts", async () => {
  const { PasswordRejected } = await import("../lib/api.ts");
  return {
    prepareVideo: async () => ({ blob: new Blob(["x"]), source: new Blob(["x"]), type: "video/mp4", width: 1, height: 1, poster: null, note: "" }),
    uploadVideo: async (_video: unknown, name: string, password: string, signal: AbortSignal, _progress: unknown, authorized: () => void) => {
      calls.push(`${name}:${password}`);
      if (password !== "right") {
        throw new PasswordRejected("Wrong password.");
      }
      if (fail.has(name)) {
        throw new Error("The connection dropped.");
      }
      authorized();
      await gates.get(name);
      signal.throwIfAborted();
      return { url: `https://m/video/${name}-0123456789ab.mp4`, poster: null, sent: true };
    },
  };
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(async () => {
  calls.length = 0;
  gates.clear();
  fail.clear();
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

it("tries each typed password once, then lets every waiting upload go once one is accepted, from any panel", async () => {
  const { resume } = await import("./useVideoUploads.ts");
  const { useSignIn } = await import("./useSignIn.ts");
  const { password, accepted } = useSignIn();
  const { jobs, placed } = await queue(["a", "b", "c", "d"]);
  expect(jobs.value.filter((job) => ["a.mp4", "b.mp4", "c.mp4", "d.mp4"].includes(job.name)).map((job) => job.stage)).toEqual(["signing-in", "signing-in", "signing-in", "signing-in"]);
  password.value = "typo";
  resume();
  await settle();
  expect(calls).toEqual(["a:typo"]);
  password.value = "right";
  accepted();
  await settle();
  expect(calls.slice(1).sort()).toEqual(["a:right", "b:right", "c:right", "d:right"]);
  expect(placed).toHaveLength(4);
});

it("starts every waiting upload as soon as the password is accepted, not after the first upload ends", async () => {
  const { resume } = await import("./useVideoUploads.ts");
  const { useSignIn } = await import("./useSignIn.ts");
  let open = () => {};
  gates.set("e", new Promise((resolve) => (open = resolve)));
  await queue(["e", "f", "g"]);
  useSignIn().password.value = "right";
  resume();
  await settle();
  expect(calls.sort()).toEqual(["e:right", "f:right", "g:right"]);
  open();
});

it("passes a typed password on to the next upload when the one trying it fails for another reason", async () => {
  const { resume } = await import("./useVideoUploads.ts");
  const { useSignIn } = await import("./useSignIn.ts");
  fail.add("h");
  const { jobs } = await queue(["h", "i"]);
  useSignIn().password.value = "right";
  resume();
  await settle();
  expect(calls).toContain("i:right");
  expect(jobs.value.find((job) => job.name === "i.mp4")?.stage).toBe("done");
});
