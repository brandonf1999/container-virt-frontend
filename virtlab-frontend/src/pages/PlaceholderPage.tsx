import type { ReactNode } from "react";

type PlaceholderPageProps = {
  title: string;
  children?: ReactNode;
};

export function PlaceholderPage({ title, children }: PlaceholderPageProps) {
  return (
    <div className="page-stack" data-page="placeholder">
      <header className="page-header">
        <div>
          <h1>{title}</h1>
          <p className="page-header__subtitle">Area under construction.</p>
        </div>
      </header>
      <section className="panel">
        <div className="panel__status">{children ?? "Content coming soon."}</div>
      </section>
    </div>
  );
}
