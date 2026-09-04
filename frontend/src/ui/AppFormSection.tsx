import type { ReactNode } from "react";

type AppFormSectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
};

export function AppFormSection({
  title,
  description,
  children,
}: AppFormSectionProps) {
  return (
    <section className="app-form-section">
      <header className="app-form-section-header">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      <div className="app-form-section-body">{children}</div>
    </section>
  );
}
