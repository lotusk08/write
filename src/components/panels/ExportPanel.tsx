export type ExportFormat = "markdown" | "docx" | "html" | "pdf" | "copy";

export interface ExportPanelProps {
  /** What is ticked. The footer's Export button acts on exactly this. */
  chosen: ExportFormat[];
  exporting: boolean;
  onChange: (chosen: ExportFormat[]) => void;
}

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: "markdown", label: "Markdown", hint: "The post exactly as the blog would receive it" },
  { id: "docx", label: "Word", hint: "A .docx, for reading anywhere else" },
  { id: "pdf", label: "PDF", hint: "Through the browser's print dialog — choose Save as PDF" },
  { id: "html", label: "HTML", hint: "One standalone page, images and all" },
  { id: "copy", label: "Copy", hint: "The Markdown, straight to the clipboard" },
];

/**
 * What to take away, ticked rather than pressed. Choosing a format and doing it
 * were the same click before, which meant three files was three trips through
 * the menu — and no way to see, afterwards, what you had already taken.
 */
export function ExportPanel({ chosen, exporting, onChange }: ExportPanelProps) {
  const toggle = (id: ExportFormat) => {
    onChange(chosen.includes(id) ? chosen.filter((one) => one !== id) : [...chosen, id]);
  };

  return (
    <ul className="switch-list">
      {FORMATS.map(({ id, label, hint }) => (
        <li key={id}>
          <label className="switch">
            <input
              type="checkbox"
              checked={chosen.includes(id)}
              disabled={exporting}
              onChange={() => toggle(id)}
            />
            <span>
              {label}
              <em>{hint}</em>
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}
