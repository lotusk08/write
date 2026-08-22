/** Small inline icons — emoji glyphs render inconsistently across platforms. */
const base = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function ImageIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m21 16-5-5L5 20" />
    </svg>
  );
}

export function TableIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 10v10" />
    </svg>
  );
}

export function LinkIcon() {
  return (
    <svg {...base}>
      <path d="M10 13a4 4 0 0 0 5.7.3l3-3a4 4 0 1 0-5.7-5.7L11.5 6" />
      <path d="M14 11a4 4 0 0 0-5.7-.3l-3 3a4 4 0 1 0 5.7 5.7l1.4-1.4" />
    </svg>
  );
}
