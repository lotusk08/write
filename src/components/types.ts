import type { SharePeer } from "../lib/share.ts";

export type ExportFormat = "markdown" | "docx" | "html" | "pdf" | "copy";

export interface ToggleOption<T extends string> {
  id: T;
  label: string;
}

export interface ShareState {
  sharing: boolean;
  owner: boolean;
  link: string | null;
  busy: boolean;
  error: string | null;
  name: string;
  peers: SharePeer[];
}
