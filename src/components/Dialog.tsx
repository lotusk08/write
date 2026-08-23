import { useEffect, type ReactNode } from "react";

interface DialogProps {
  title: string;
  subtitle?: string;
  /** Narrow, for a dialog that asks one thing. */
  compact?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Dialog({ title, subtitle, compact, onClose, children, footer }: DialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={compact ? "dialog is-compact" : "dialog"}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2>{title}</h2>
        {subtitle ? <p className="hint" style={{ marginTop: 0 }}>{subtitle}</p> : null}
        {children}
        {footer ? <div className="dialog-actions">{footer}</div> : null}
      </div>
    </div>
  );
}
