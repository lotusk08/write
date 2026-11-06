import { describe, expect, it } from "vitest";
import { withoutLocation } from "./images.ts";

describe("withoutLocation", () => {
  const text = (value: string) => [...value].map((char) => char.charCodeAt(0));
  const u16 = (value: number) => [value >> 8, value & 0xff];
  const u32 = (value: number) => [...u16(value >>> 16), ...u16(value & 0xffff)];
  const segment = (marker: number, body: number[]) => [0xff, marker, ...u16(body.length + 2), ...body];
  const latitude = [0, 0, 0, 21, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 0, 1];

  function exif(): number[] {
    const ifd0 = [...u16(2), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(6), 0, 0, ...u16(0x8825), ...u16(4), ...u32(1), ...u32(38), ...u32(0)];
    const gps = [...u16(2), ...u16(1), ...u16(2), ...u32(2), ...text("N"), 0, 0, 0, ...u16(2), ...u16(5), ...u32(3), ...u32(68), ...u32(0)];
    return [...text("Exif\0\0"), ...text("MM"), ...u16(42), ...u32(8), ...ifd0, ...gps, ...latitude];
  }

  const bytesOf = async (blob: Blob) => [...new Uint8Array(await blob.arrayBuffer())];
  const has = (haystack: number[], needle: number[]) => haystack.some((_, at) => needle.every((byte, index) => haystack[at + index] === byte));

  it("blanks a JPEG's GPS directory and drops its XMP, keeping its orientation and pixels", async () => {
    const pixels = [0xff, 0xda, 0, 4, 1, 2, 9, 9, 9, 0xff, 0xd9];
    const jpeg = [0xff, 0xd8, ...segment(0xe1, exif()), ...segment(0xe1, text("http://ns.adobe.com/xap/1.0/\0<exif:GPSLatitude>21,2N</exif:GPSLatitude>")), ...pixels];
    const out = await bytesOf(await withoutLocation(new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" })));
    expect(has(out, latitude)).toBe(false);
    expect(has(out, text("GPSLatitude"))).toBe(false);
    expect(has(out, [...u16(0x0112), ...u16(3), ...u32(1), ...u16(6)])).toBe(true);
    expect(out.slice(-pixels.length)).toEqual(pixels);
    expect(out.length).toBe(jpeg.length - segment(0xe1, text("http://ns.adobe.com/xap/1.0/\0<exif:GPSLatitude>21,2N</exif:GPSLatitude>")).length);
  });

  it("drops a PNG's Exif and text chunks and a WebP's EXIF and XMP, its header to match", async () => {
    const chunk = (type: string, body: number[]) => [...u32(body.length), ...text(type), ...body, 0, 0, 0, 0];
    const png = [0x89, ...text("PNG\r\n\x1a\n"), ...chunk("IHDR", [1, 2, 3]), ...chunk("eXIf", exif().slice(6)), ...chunk("iTXt", text("XML:com.adobe.xmp GPS")), ...chunk("IEND", [])];
    const cleanPng = await bytesOf(await withoutLocation(new Blob([new Uint8Array(png)], { type: "image/png" })));
    expect(cleanPng).toEqual([0x89, ...text("PNG\r\n\x1a\n"), ...chunk("IHDR", [1, 2, 3]), ...chunk("IEND", [])]);

    const le32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24];
    const riff = (type: string, body: number[]) => [...text(type), ...le32(body.length), ...body, ...(body.length % 2 ? [0] : [])];
    const body = [...riff("VP8X", [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ...riff("VP8 ", [1, 2, 3]), ...riff("EXIF", latitude), ...riff("XMP ", text("GPS"))];
    const webp = [...text("RIFF"), ...le32(4 + body.length), ...text("WEBP"), ...body];
    const cleanWebp = await bytesOf(await withoutLocation(new Blob([new Uint8Array(webp)], { type: "image/webp" })));
    const kept = [...riff("VP8X", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ...riff("VP8 ", [1, 2, 3])];
    expect(cleanWebp).toEqual([...text("RIFF"), ...le32(4 + kept.length), ...text("WEBP"), ...kept]);
  });
});
