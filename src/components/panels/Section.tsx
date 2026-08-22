import type { ReactNode } from "react";

/** A titled group inside the menu drawer. */
export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <h3 className="section-title">{title}</h3>
      {hint ? <p className="hint section-hint">{hint}</p> : null}
      {children}
    </section>
  );
}
