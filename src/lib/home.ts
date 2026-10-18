import { bytesToBase64 } from "../../shared/base64.ts";
import { frontField, frontMatter, splitFront } from "../../shared/front.ts";
import { PLACES, readPin, writtenPin, type Pin, type Place } from "../../shared/pin.ts";
import type { SiteFile } from "../../shared/types.ts";
import { fetchPostSource, fetchSiteFiles, publish } from "./api.ts";

export type PinChoice = "off" | "on" | "2" | "3";

export const PIN_CHOICES: { id: PinChoice; label: string; title: string }[] = [
  { id: "off", label: "Off", title: "Not pinned: it stands where its date puts it" },
  { id: "on", label: "Pin", title: "Pinned after the newest post, in the first place free" },
  { id: "2", label: "2nd", title: "Second on the home page, after the newest post" },
  { id: "3", label: "3rd", title: "Third on the home page" },
];

export function choiceOf(pin: Pin | undefined): PinChoice {
  return typeof pin === "number" ? (String(pin) as PinChoice) : pin ? "on" : "off";
}

export function pinOf(choice: PinChoice): Pin {
  return choice === "off" ? false : choice === "on" ? true : (Number(choice) as Place);
}

const PIN_WORDS: Record<PinChoice, string> = { off: "unpinned", on: "pinned", "2": "pinned 2nd", "3": "pinned 3rd" };

/** What a pin does, in words: `pinned 2nd`, or `unpinned`. */
export function pinWords(pin: Pin | undefined): string {
  return PIN_WORDS[choiceOf(pin)];
}

export interface HomePost {
  path: string;
  pin: Pin;
}

/**
 * Who stands at the home page's second and third places by a pin, as the blog's `homeOrder` decides, for posts the
 * site shows, newest first: the newest one is first whatever its pin, a place goes to the newest post that names it,
 * then `true` pins, newest first, take the places left. A place missing from the map goes to the next post by date.
 */
export function homePlaces<T extends HomePost>(posts: T[]): Map<Place, T> {
  const rest = posts.slice(1);
  const placed = new Map<Place, T>();
  for (const post of rest) {
    if (typeof post.pin === "number" && !placed.has(post.pin)) {
      placed.set(post.pin, post);
    }
  }
  for (const post of rest) {
    const free = PLACES.find((place) => !placed.has(place));
    if (free === undefined) {
      break;
    }
    if (post.pin === true) {
      placed.set(free, post);
    }
  }
  return placed;
}

/** The home page's first three posts: the newest, then each place, by pin or else by date. */
export function homeTop<T extends HomePost>(posts: T[]): T[] {
  const placed = homePlaces(posts);
  const queue = posts.slice(1).filter((post) => ![...placed.values()].includes(post));
  return [posts[0], ...PLACES.map((place) => placed.get(place) ?? queue.shift())].filter((post) => post !== undefined);
}

const other = (place: Place): Place => PLACES.find((each) => each !== place)!;

/**
 * `changes`, with every other post that names one of `places` unpinned: the newer of two posts naming a place takes
 * it, so one left naming it could take it from the post put there, now or once a newer post is published.
 */
function claimed<T extends HomePost>(posts: T[], changes: Map<string, Pin>, places: Place[]): Map<string, Pin> {
  for (const post of posts.slice(1)) {
    if (!changes.has(post.path) && typeof post.pin === "number" && places.includes(post.pin)) {
      changes.set(post.path, false);
    }
  }
  return changes;
}

/**
 * The pins to write when `post` is set to `pin`. A post put in a place someone stands at by a pin moves that one to
 * the other place when it is free or being left, and unpins it otherwise, so the two places never hold three pins;
 * any other post naming a place written gives it up. A post that names a place another holds is put there too. The
 * newest post, first whatever its pin, and one the site does not show move nobody.
 */
export function pinChanges<T extends HomePost>(posts: T[], post: T, pin: Pin): Map<string, Pin> {
  const placed = homePlaces(posts);
  const place = typeof pin === "number" && posts.indexOf(post) > 0 ? pin : null;
  if (pin === post.pin && (place === null || placed.get(place) === post)) {
    return new Map();
  }
  const changes = new Map<string, Pin>([[post.path, pin]]);
  if (place === null) {
    return changes;
  }
  const holder = placed.get(place);
  const beside = placed.get(other(place));
  if (holder && holder !== post) {
    changes.set(holder.path, !beside || beside === post ? other(place) : false);
  }
  return claimed(posts, changes, [place, ...(changes.get(holder?.path ?? "") === other(place) ? [other(place)] : [])]);
}

/** The pins that trade the two places: each post standing at one by a pin is written the other, and nobody else names either. */
export function swapChanges<T extends HomePost>(posts: T[]): Map<string, Pin> {
  const placed = homePlaces(posts);
  return claimed(posts, new Map([...placed].map(([place, post]) => [post.path, other(place)])), placed.size ? [...PLACES] : []);
}

export function withPins<T extends HomePost>(posts: T[], changes: Map<string, Pin>): T[] {
  return posts.map((post) => (changes.has(post.path) ? { ...post, pin: changes.get(post.path)! } : post));
}

const PIN_LINE = /^pin:[ \t]*(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^#\r\n]*?)([ \t]+#[^\r\n]*)?[ \t]*(\r?\n)?$/;

/**
 * A post's file with its pin changed and every other byte as it was: the `pin:` line is rewritten in place, a comment
 * after it kept, or, with none, written before `toc:` or at the end of the front matter, where the app writes it.
 * Null where the editor reads no front matter.
 */
export function setPin(markdown: string, pin: Pin): string | null {
  const front = frontMatter(markdown) && splitFront(markdown);
  if (!front) {
    return null;
  }
  const { open, body, close, rest } = front;
  const eol = open.endsWith("\r\n") ? "\r\n" : "\n";
  const line = `pin: ${writtenPin(pin)}`;
  const lines = body.split(/(?<=\n)/);
  const at = lines.findIndex((each) => /^pin:(?:[ \t]|\r?\n|$)/.test(each));
  if (at !== -1) {
    const [, comment = "", end = ""] = PIN_LINE.exec(lines[at]) ?? [];
    lines[at] = `${line}${comment}${end || (lines[at].endsWith("\r\n") ? "\r\n" : "\n")}`;
  } else {
    const toc = lines.findIndex((each) => /^toc:(?:[ \t]|\r?\n|$)/.test(each));
    lines.splice(toc === -1 ? lines.length : toc, 0, `${line}${eol}`);
  }
  return `${open}${lines.join("")}${close}${rest}`;
}

export interface PinWritten {
  path: string;
  pin: Pin;
  was: string;
  sha: string;
}

const pinsOf = (posts: SiteFile[]) => JSON.stringify(posts.map(({ path, pin, hidden }) => [path, pin, hidden]));

/**
 * Writes `changes` to the site in one commit guarded by the shas it read, only each file's `pin:` line changed. They
 * were worked out from `posts`, the list as it was read, newest first, so the site's list is read again first: a post
 * published or a pin changed since stops it, as does a file whose pin is no longer the list's.
 */
export async function publishPins(
  changes: Map<string, Pin>,
  posts: SiteFile[],
  password: string,
): Promise<{ commitUrl: string; written: PinWritten[] }> {
  if (pinsOf((await fetchSiteFiles(password)).posts) !== pinsOf(posts)) {
    throw new Error("The site changed since the list was read.");
  }
  const files = await Promise.all(
    [...changes].map(async ([path, pin]) => {
      const listed = posts.find((post) => post.path === path);
      const title = listed?.title || path;
      const source = await fetchPostSource(path, password);
      const yaml = frontMatter(source.markdown)?.yaml;
      const field = yaml === undefined ? null : frontField(yaml, "pin");
      if (!listed || (field ? readPin(field.text, field.plain) : false) !== listed.pin) {
        throw new Error(`${title} changed on the site since the list was read.`);
      }
      const markdown = setPin(source.markdown, pin);
      if (markdown === null) {
        throw new Error(`${path} has no front matter to write a pin in.`);
      }
      return { path, pin, markdown, was: source.sha, title, changed: markdown !== source.markdown };
    }),
  );
  const written = files.filter(({ changed }) => changed);
  const result = await publish(
    {
      message: `docs(post): ${files.map(({ title, pin }) => `${title} ${pinWords(pin)}`).join(", ")}`,
      files: written.map(({ path, markdown }) => ({ path, contentBase64: bytesToBase64(new TextEncoder().encode(markdown)) })),
      expect: files.map(({ path, was }) => ({ path, sha: was })),
    },
    password,
  );
  return {
    commitUrl: result.commitUrl,
    written: written.map(({ path, pin, was }) => ({ path, pin, was, sha: result.shas[path] })),
  };
}
