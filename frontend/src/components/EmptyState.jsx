export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6">
      {Icon && (
        <div className="w-16 h-16 rounded-full border border-[var(--color-hairline-strong)] flex items-center justify-center text-slate-600 mb-5">
          <Icon size={28} strokeWidth={1.25} />
        </div>
      )}
      <h3 className="font-display text-2xl font-light text-slate-200 mb-2 tracking-tight">{title}</h3>
      {description && (
        <p className="text-sm text-slate-500 max-w-md leading-relaxed mb-6">{description}</p>
      )}
      {action}
    </div>
  );
}
