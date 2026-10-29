/* eslint-disable @typescript-eslint/no-explicit-any -- attrs are free-form JSON, as Tiptap's were */

export interface DocMark {
  type: string;
  attrs?: Record<string, any>;
}

export interface JSONContent {
  type?: string;
  attrs?: Record<string, any>;
  content?: JSONContent[];
  marks?: DocMark[];
  text?: string;
}

export const emptyDoc: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };
