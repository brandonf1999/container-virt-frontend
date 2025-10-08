type StatItem = {
  label: string;
  value: string;
  meta?: string | string[];
};

type StatsBannerProps = {
  stats: StatItem[];
};

export function StatsBanner({ stats }: StatsBannerProps) {
  return (
    <section className="stats-banner" aria-label="System statistics">
      {stats.map((stat) => (
        <article className="stat-card" key={stat.label}>
          <div className="stat-card__label">{stat.label}</div>
          <div className="stat-card__value" aria-live="polite">
            {stat.value}
          </div>
          {stat.meta &&
            (Array.isArray(stat.meta) ? stat.meta : [stat.meta]).map((line) => (
              <div className="stat-card__meta" key={`${stat.label}-${line}`}>
                {line}
              </div>
            ))}
        </article>
      ))}
    </section>
  );
}

export type { StatItem };
