import type { ReactNode } from "react";

/**
 * A small stroke icon set drawn on a 24px grid. Inline SVG rather than emoji so
 * the toolbar looks the same on every platform.
 */
const PATHS = {
  bold: (
    <>
      <path d="M7 5h6.5a3.5 3.5 0 0 1 0 7H7z" />
      <path d="M7 12h7.5a3.5 3.5 0 0 1 0 7H7z" />
    </>
  ),
  italic: (
    <>
      <path d="M14 5h-4M14 19h-4M15 5l-6 14" />
    </>
  ),
  strike: (
    <>
      <path d="M4 12h16" />
      <path d="M16 7.5C16 6 14.2 5 12 5S8 6 8 7.5s1.8 2.3 4 2.8" />
      <path d="M8 16.5C8 18 9.8 19 12 19s4-1 4-2.5" />
    </>
  ),
  code: (
    <>
      <path d="m9 7-5 5 5 5M15 7l5 5-5 5" />
    </>
  ),
  highlight: (
    <>
      <path d="m15 5 4 4-8.5 8.5H6v-4.5z" />
      <path d="M4 21h16" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a4 4 0 0 0 5.7.3l3-3a4 4 0 1 0-5.7-5.7L11.5 6" />
      <path d="M14 11a4 4 0 0 0-5.7-.3l-3 3a4 4 0 1 0 5.7 5.7l1.4-1.4" />
    </>
  ),
  bulletList: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1.1" />
      <circle cx="4.5" cy="12" r="1.1" />
      <circle cx="4.5" cy="18" r="1.1" />
    </>
  ),
  orderedList: (
    <>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="M4 4.5h1.2V9M3.4 9h2.6" />
      <path d="M3.5 15.2c0-.9 2.3-1 2.3.2s-2.3 1.6-2.3 3h2.5" />
    </>
  ),
  taskList: (
    <>
      <path d="M11 6h9M11 12h9M11 18h9" />
      <path d="m3 6 1.6 1.6L7.6 4.6" />
      <path d="m3 12.5 1.6 1.6 3-3" />
      <path d="m3 18.5 1.6 1.6 3-3" />
    </>
  ),
  quote: (
    <>
      <path d="M9.5 7c-2.4 0-4 1.7-4 3.9 0 2 1.5 3.4 3.4 3.4.3 0 .6 0 .9-.1-.4 1.5-1.7 2.5-3.3 2.8" />
      <path d="M19 7c-2.4 0-4 1.7-4 3.9 0 2 1.5 3.4 3.4 3.4.3 0 .6 0 .9-.1-.4 1.5-1.7 2.5-3.3 2.8" />
    </>
  ),
  codeBlock: (
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="m9 9.5-2.5 2.5L9 14.5M15 9.5l2.5 2.5-2.5 2.5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.4" />
      <path d="m21 16-5-5L5 20" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M9 10v10" />
    </>
  ),
  rule: (
    <>
      <path d="M3 12h4M10 12h4M17 12h4" />
    </>
  ),
  section: (
    <>
      <path d="m8 10 4 4 4-4" />
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
    </>
  ),
  collapseAll: (
    <>
      <path d="m7 13 5-5 5 5M7 19l5-5 5 5" />
    </>
  ),
  expandAll: (
    <>
      <path d="m7 5 5 5 5-5M7 11l5 5 5-5" />
    </>
  ),
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9.5 4v16" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  chevronDown: (
    <>
      <path d="m6 9 6 6 6-6" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: (
    <>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.3 6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V2a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.1 1z" />
    </>
  ),
  focus: (
    <>
      <path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15a2 2 0 0 1-1-1.7V6a2 2 0 0 1 2-2h7.3A2 2 0 0 1 15 5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M10 4h4M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  /* The macOS command key: four loops on a closed square. */
  command: (
    <>
      <path d="M9 9V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10 9.5v5l4.5-2.5z" />
    </>
  ),
  center: (
    <>
      <path d="M4 6h16M7 12h10M4 18h16" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12M18 6 6 18" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
