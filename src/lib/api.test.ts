import { afterEach, describe, expect, it, vi } from "vitest";
import { PasswordRejected, uploadPhoto } from "./api.ts";

function answers(...statuses: number[]) {
  const calls = vi.fn(async () => {
    const status = statuses.shift() ?? 500;
    return Response.json(status === 200 ? { sha: "a".repeat(40) } : { error: `failed ${status}` }, { status });
  });
  vi.stubGlobal("fetch", calls);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("uploadPhoto", () => {
  it("tries once more after a server error", async () => {
    const calls = answers(502, 200);
    expect(await uploadPhoto("aGk=", "pw")).toBe("a".repeat(40));
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("does not resend a photo the worker refused, or a wrong password", async () => {
    let calls = answers(400, 200);
    await expect(uploadPhoto("aGk=", "pw")).rejects.toThrow("failed 400");
    expect(calls).toHaveBeenCalledTimes(1);
    calls = answers(401, 200);
    await expect(uploadPhoto("aGk=", "pw")).rejects.toBeInstanceOf(PasswordRejected);
    expect(calls).toHaveBeenCalledTimes(1);
  });
});
