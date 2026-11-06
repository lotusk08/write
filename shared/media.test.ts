import { describe, expect, it } from "vitest";
import { posterKey, posterKeys } from "./media.ts";

describe("a video's poster beside it", () => {
  it("has the video's path with the extension swapped, as the blog looks for it", () => {
    expect(posterKey("video/clip-0123456789ab.mp4", "webp")).toBe("video/clip-0123456789ab.webp");
    expect(posterKey("video/clip-0123456789ab.mp4", "jpg")).toBe("video/clip-0123456789ab.jpg");
    expect(posterKey("video/clip-0123456789ab.webm", "jpg")).toBe("video/clip-0123456789ab.jpg");
  });

  it("is looked for as WebP first, then JPEG", () => {
    expect(posterKeys("video/clip-0123456789ab.mp4")).toEqual(["video/clip-0123456789ab.webp", "video/clip-0123456789ab.jpg"]);
  });
});
