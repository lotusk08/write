import type { Topic } from "../../shared/types.ts";

export const SUGGESTION_LIMIT = 8;

export function topicSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

export function existingSpelling(name: string, topics: Topic[]): string {
  const slug = topicSlug(name);
  return topics.find((topic) => topic.slug === slug)?.title ?? name;
}

export function suggestTopics(
  topics: Topic[],
  typed: string,
  taken: string[],
  limit = SUGGESTION_LIMIT,
): Topic[] {
  const used = new Set(taken.map(topicSlug));
  const open = topics.filter(
    (topic) => !used.has(topic.slug) && !used.has(topicSlug(topic.title)),
  );
  const byCount = (a: Topic, b: Topic) => b.count - a.count || a.title.localeCompare(b.title);

  const query = fold(typed.trim());
  if (!query) {
    return [...open].sort(byCount).slice(0, limit);
  }

  const dashed = fold(topicSlug(typed));
  const ranked: { topic: Topic; rank: number }[] = [];
  for (const topic of open) {
    const keys = [fold(topic.title), fold(topic.slug)];
    if (keys.some((key) => key.startsWith(query) || (dashed && key.startsWith(dashed)))) {
      ranked.push({ topic, rank: 0 });
    } else if (keys.some((key) => key.includes(query) || (dashed && key.includes(dashed)))) {
      ranked.push({ topic, rank: 1 });
    }
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || byCount(a.topic, b.topic))
    .map(({ topic }) => topic)
    .slice(0, limit);
}
