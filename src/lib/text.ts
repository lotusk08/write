export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/['"’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatPostDate(date: Date, offsetMinutes?: number): string {
  const offset = offsetMinutes ?? -date.getTimezoneOffset();
  const shifted = new Date(date.getTime() + offset * 60_000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ` +
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())} ` +
    `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
  );
}

export function datePrefix(postDate: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(postDate.trim());
  return match ? match[1] : new Date().toISOString().slice(0, 10);
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function tidyField(input: string): string {
  return input.replace(/\s*\n\s*/g, " ").trim();
}

export function rememberValue(element: HTMLInputElement | HTMLTextAreaElement): void {
  element.dataset.before = element.value;
}

export function tidyEdited(element: HTMLInputElement | HTMLTextAreaElement): string | null {
  if (element.value === element.dataset.before) {
    return null;
  }
  const tidy = tidyField(element.value);
  return tidy === element.value ? null : tidy;
}
