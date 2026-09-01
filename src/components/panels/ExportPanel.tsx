export type ExportFormat = "markdown" | "docx" | "html" | "pdf" | "copy";

export interface ExportPanelProps {
  chosen: ExportFormat[];
  exporting: boolean;
  onChange: (chosen: ExportFormat[]) => void;
}

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: "markdown", label: "Markdown", hint: "The post exactly as the blog would receive it" },
  { id: "docx", label: "Word", hint: "A .docx, for reading anywhere else" },
  { id: "pdf", label: "PDF", hint: "Through the browser's print dialog — choose Save as PDF" },
  { id: "html", label: "HTML", hint: "One standalone page, images and all" },
];

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
