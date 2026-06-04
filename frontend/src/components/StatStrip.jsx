import useCountUp from '../hooks/useCountUp';

export default function StatStrip({ label, value, delta, accent, isCurrency = false, suffix = '' }) {
  const display = useCountUp(typeof value === 'number' ? value : 0, { duration: 700 });
  const formatted = isCurrency
    ? display.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    : Math.round(display).toLocaleString();

  return (
    <div className="flex-1 min-w-0 px-6 py-5 first:pl-0 last:pr-0 border-l border-[var(--color-hairline)] first:border-l-0">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-2">{label}</p>
      <div className="flex items-baseline gap-3">
        <span
          className={`font-display text-4xl md:text-5xl font-light tracking-tight tnum ${
            accent ? 'text-transparent bg-clip-text bg-gradient-to-br from-white to-slate-400' : 'text-slate-100'
          }`}
        >
          {formatted}
          {suffix && <span className="text-2xl text-slate-500 ml-0.5">{suffix}</span>}
        </span>
        {delta && (
          <span className={`text-xs font-medium font-mono ${delta.positive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {delta.positive ? '↑' : '↓'} {delta.value}
          </span>
        )}
      </div>
    </div>
  );
}
