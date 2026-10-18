import { bytesToBase64 } from "../../shared/base64.ts";
import { splitFront } from "../../shared/front.ts";
import { PLACES, writtenPin, type Pin, type Place } from "../../shared/pin.ts";
import { fetchPostSource, publish } from "./api.ts";
import { parsePost } from "./import.ts";

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
 * The pins to write when `post` is set to `pin`. A post put in a place someone stands at by a pin moves that one to
 * the other place when it is free or being left, and unpins it otherwise, so the two places never hold three pins.
 * The newest post, first whatever its pin, and one the site does not show move nobody.
 */
export function pinChanges<T extends HomePost>(posts: T[], post: T, pin: Pin): Map<string, Pin> {
  const changes = new Map<string, Pin>();
  if (pin === post.pin) {
    return changes;
  }
  changes.set(post.path, pin);
  if (typeof pin === "number" && posts.indexOf(post) > 0) {
    const placed = homePlaces(posts);
    const holder = placed.get(pin);
    const beside = placed.get(other(pin));
    if (holder && holder !== post) {
      changes.set(holder.path, !beside || beside === post ? other(pin) : false);
    }
  }
  return changes;
}

/** The pins that trade the two places: each post standing at one by a pin is written the other. */
export function swapChanges<T extends HomePost>(posts: T[]): Map<string, Pin> {
  const placed = homePlaces(posts);
  return new Map([...placed].map(([place, post]) => [post.path, other(place)]));
}

export function withPins<T extends HomePost>(posts: T[], changes: Map<string, Pin>): T[] {
  return posts.map((post) => (changes.has(post.path) ? { ...post, pin: changes.get(post.path)! } : post));
}

/**
 * A post's file with its pin changed and every other byte as it was: the `pin:` line is rewritten in place, or, with
 * none, written before `toc:` or at the end of the front matter, where the app writes it. Null with no front matter.
 */
export function setPin(markdown: string, pin: Pin): string | null {
  const front = splitFront(markdown);
  if (!front) {
    return null;
  }
  const { open, body, close, rest } = front;
  const eol = open.endsWith("\r\n") ? "\r\n" : "\n";
  const line = `pin: ${writtenPin(pin)}`;
  const lines = body.split(/(?<=\n)/);
  const at = lines.findIndex((each) => /^pin:(?:[ \t]|\r?\n|$)/.test(each));
  if (at !== -1) {
    lines[at] = `${line}${lines[at].endsWith("\r\n") ? "\r\n" : "\n"}`;
  } else {
    const toc = lines.findIndex((each) => /^toc:(?:[ \t]|\r?\n|$)/.test(each));
    lines.splice(toc === -1 ? lines.length : toc, 0, `${line}${eol}`);
  }
  return `${open}${lines.join("")}${close}${rest}`;
}

const PIN_WORDS: Record<PinChoice, string> = { off: "unpinned", on: "pinned", "2": "pinned 2nd", "3": "pinned 3rd" };

export interface PinWritten {
  path: string;
  pin: Pin;
  was: string;
  sha: string;
}

/**
 * Writes `changes` to the site in one commit, each file read again first and only its `pin:` line changed. A file
 * whose pin on the site is no longer the one the list showed stops it, since the change was worked out from the list.
 */
export async function publishPins(
  changes: Map<string, Pin>,
  shown: Map<string, { title: string; pin: Pin }>,
  password: string,
): Promise<{ commitUrl: string; written: PinWritten[] }> {
  const files = await Promise.all(
    [...changes].map(async ([path, pin]) => {
      const source = await fetchPostSource(path, password);
      const listed = shown.get(path);
      const title = listed?.title || path;
      if (!listed || (parsePost(source.markdown).meta.pin ?? false) !== listed.pin) {
        throw new Error(`${title} changed on the site since the list was read.`);
      }
      const markdown = setPin(source.markdown, pin);
      if (markdown === null) {
        throw new Error(`${path} has no front matter to write a pin in.`);
      }
      return { path, pin, markdown, was: source.sha, title };
    }),
  );
  const result = await publish(
    {
      message: `docs(post): ${files.map(({ title, pin }) => `${title} ${PIN_WORDS[choiceOf(pin)]}`).join(", ")}`,
      files: files.map(({ path, markdown }) => ({ path, contentBase64: bytesToBase64(new TextEncoder().encode(markdown)) })),
      expect: files.map(({ path, was }) => ({ path, sha: was })),
    },
    password,
  );
  return {
    commitUrl: result.commitUrl,
    written: files.map(({ path, pin, was }) => ({ path, pin, was, sha: result.shas[path] })),
  };
}
