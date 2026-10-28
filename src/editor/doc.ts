/* eslint-disable @typescript-eslint/no-explicit-any -- attrs are free-form JSON, as Tiptap's were */

export interface DocMark {
  type: string;
  attrs?: Record<string, any>;
}

/**
 * A draft's body: the JSON tree the app stored under Tiptap, kept as the model
 * so drafts saved before the editor changed open unchanged. `read.ts` reads
 * Markdown into it as the blog reads Markdown, and `markdown.ts` writes it back,
 * both checked against the blog's posts. The editor itself works on HTML;
 * `bridge.ts` converts between the two.
 */
export interface JSONContent {
  type?: string;
  attrs?: Record<string, any>;
  content?: JSONContent[];
  marks?: DocMark[];
  text?: string;
}

export const emptyDoc: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };
