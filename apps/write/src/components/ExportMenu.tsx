import { useEffect, useRef, useState } from "react";

interface ExportMenuProps {
  onExport: (format: "markdown" | "docx" | "html" | "copy") => void;
  busy: boolean;
}

export function ExportMenu({ onExport, busy }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as globalThis.Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (format: "markdown" | "docx" | "html" | "copy") => {
    setOpen(false);
    onExport(format);
  };

  return (
    <div className="menu-wrap" ref={wrap}>
      <button type="button" className="btn" disabled={busy} onClick={() => setOpen((value) => !value)}>
        {busy ? "Exporting…" : "Export"} ▾
      </button>
      {open ? (
        <div className="menu" role="menu">
          <button type="button" onClick={() => pick("markdown")}>
            Markdown <kbd>.md</kbd>
          </button>
          <button type="button" onClick={() => pick("docx")}>
            Word <kbd>.docx</kbd>
          </button>
          <button type="button" onClick={() => pick("html")}>
            HTML <kbd>.html</kbd>
          </button>
          <button type="button" onClick={() => pick("copy")}>
            Copy Markdown <kbd>⌘⇧C</kbd>
          </button>
        </div>
      ) : null}
    </div>
  );
}
