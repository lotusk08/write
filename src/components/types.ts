import type { SharePeer } from "../lib/participants.ts";

export type ExportFormat = "markdown" | "docx" | "html" | "pdf" | "copy";

/** A menu action that has just finished, shown as a tick on its button for a moment. */
export type DoneAction = "share" | "link" | "export" | "copy";

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
