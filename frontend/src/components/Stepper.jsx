import { FiCheck } from 'react-icons/fi';

export default function Stepper({ steps, current }) {
  return (
    <ol className="flex items-stretch w-full">
      {steps.map((step, i) => {
        const isComplete = i < current;
        const isCurrent = i === current;

        return (
          <li key={step.label} className="flex-1 flex items-stretch min-w-0">
            <div className="flex flex-col items-center text-center px-2 flex-1">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-mono font-semibold transition-all duration-300 border ${
                  isComplete
                    ? 'bg-[var(--color-route-settings)]/15 border-[var(--color-route-settings)]/40 text-[var(--color-route-settings)]'
                    : isCurrent
                    ? 'bg-[var(--color-route-settings)]/10 border-[var(--color-route-settings)] text-[var(--color-route-settings)] shadow-[0_0_0_4px_rgba(129,140,248,0.10)]'
                    : 'bg-transparent border-white/10 text-slate-500'
                }`}
              >
                {isComplete ? <FiCheck size={14} /> : String(i + 1).padStart(2, '0')}
              </div>
              <p
                className={`mt-2 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                  isCurrent ? 'text-slate-200' : isComplete ? 'text-slate-400' : 'text-slate-600'
                }`}
              >
                {step.label}
              </p>
            </div>
            {i < steps.length - 1 && (
              <div className="flex-1 flex items-center pb-5">
                <div className="h-px w-full bg-white/5 relative">
                  <div
                    className={`absolute inset-y-0 left-0 bg-[var(--color-route-settings)]/40 transition-all duration-500 ${
                      isComplete ? 'w-full' : 'w-0'
                    }`}
                  />
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
