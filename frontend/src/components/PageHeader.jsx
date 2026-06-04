export default function PageHeader({ eyebrow, title, description, actions, accent = 'dashboard' }) {
  const accentClass = {
    dashboard: 'text-[var(--color-route-dashboard)]',
    media: 'text-[var(--color-route-media)]',
    jobs: 'text-[var(--color-route-jobs)]',
    logs: 'text-[var(--color-route-logs)]',
    settings: 'text-[var(--color-route-settings)]',
  }[accent] || 'text-[var(--color-route-dashboard)]';

  return (
    <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 mb-6 border-b border-[var(--color-hairline)]">
      <div className="min-w-0">
        {eyebrow && (
          <p className={`text-[10px] font-mono uppercase tracking-widest mb-2 ${accentClass}`}>
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-4xl md:text-5xl font-light text-slate-100 tracking-tight leading-none">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-slate-400 mt-3 max-w-2xl leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}
