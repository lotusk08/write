// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { History, placeCaretAt, readCaret, type Snapshot } from "./history.ts";

let doc = "";
const take = (): Snapshot => ({ doc, caret: null });
const states: string[] = [];
const apply = (state: Snapshot) => {
  doc = state.doc;
  states.push(state.doc);
};

beforeEach(() => {
  doc = "";
  states.length = 0;
});

function edit(history: History, kind: string, next: string, at: number): void {
  history.before(kind, take, at);
  doc = next;
  history.changed();
}

describe("History", () => {
  it("keeps typing as one step until a pause, and an Enter as its own", () => {
    const history = new History();
    edit(history, "type", "a", 0);
    edit(history, "type", "ab", 100);
    edit(history, "enter", "ab\n", 200);
    edit(history, "type", "ab\nc", 300);
    edit(history, "type", "ab\ncd", 2500);
    expect(history.undo(take, apply)).toBe(true);
    expect(doc).toBe("ab\nc");
    history.undo(take, apply);
    expect(doc).toBe("ab\n");
    history.undo(take, apply);
    expect(doc).toBe("ab");
    history.undo(take, apply);
    expect(doc).toBe("");
    expect(history.undo(take, apply)).toBe(false);
  });

  it("redoes what was undone, and a new edit drops the redo", () => {
    const history = new History();
    edit(history, "command", "quoted", 0);
    edit(history, "command", "noted", 10);
    history.undo(take, apply);
    history.undo(take, apply);
    expect(doc).toBe("");
    history.redo(take, apply);
    expect(doc).toBe("quoted");
    expect(history.canRedo).toBe(true);
    edit(history, "type", "quoted!", 20);
    expect(history.canRedo).toBe(false);
    history.undo(take, apply);
    expect(doc).toBe("quoted");
  });

  it("starts a new step when the caret moves, and skips steps that changed nothing", () => {
    const history = new History();
    edit(history, "type", "a", 0);
    history.seal();
    edit(history, "type", "ab", 50);
    history.before("command", take, 60);
    history.undo(take, apply);
    expect(doc).toBe("a");
    expect(states).toEqual(["a"]);
  });

  it("forgets everything when the draft is replaced from outside", () => {
    const history = new History();
    edit(history, "type", "a", 0);
    history.clear();
    expect(history.canUndo).toBe(false);
  });
});

describe("caret", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div contenteditable="true"></div>';
    root = document.body.firstElementChild as HTMLElement;
  });

  const roundTrip = (html: string, place: (root: HTMLElement) => [Node, number]) => {
    root.innerHTML = html;
    const range = document.createRange();
    range.setStart(...place(root));
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const caret = readCaret(root);
    root.innerHTML = html;
    placeCaretAt(root, caret);
    const back = window.getSelection()!.getRangeAt(0);
    return [back.startContainer, back.startOffset] as const;
  };

  it("comes back inside the same text", () => {
    const [node, offset] = roundTrip("<p>one</p><p>t<b>wo</b></p>", (r) => [r.querySelector("b")!.firstChild!, 1]);
    expect(node.textContent).toBe("wo");
    expect(offset).toBe(1);
  });

  it("comes back to an empty line rather than the end of the one above", () => {
    const [node, offset] = roundTrip("<p>one</p><p><br></p><p>two</p>", (r) => [r.children[1], 0]);
    expect(node).toBe(root.children[1]);
    expect(offset).toBe(0);
  });

  it("skips what cannot be edited, like a photo's tools", () => {
    const [node, offset] = roundTrip(
      '<p>a</p><figure contenteditable="false"><button>Alt</button></figure><p>bc</p>',
      (r) => [r.children[2].firstChild!, 1],
    );
    expect(node.textContent).toBe("bc");
    expect(offset).toBe(1);
  });
});
