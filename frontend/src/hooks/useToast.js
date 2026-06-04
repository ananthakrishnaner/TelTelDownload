import { useEffect, useState, useCallback, useRef } from 'react';

let toastId = 0;
const listeners = new Set();

export function toast(opts) {
  const id = ++toastId;
  const t = {
    id,
    variant: opts.variant || 'info', // 'success' | 'warning' | 'error' | 'info'
    title: opts.title,
    description: opts.description,
    action: opts.action, // { label, onClick }
    duration: opts.duration ?? 4000,
    createdAt: Date.now(),
  };
  listeners.forEach((fn) => fn(t));
  return id;
}
toast.success = (title, opts = {}) => toast({ ...opts, variant: 'success', title });
toast.warning = (title, opts = {}) => toast({ ...opts, variant: 'warning', title });
toast.error = (title, opts = {}) => toast({ ...opts, variant: 'error', title });
toast.info = (title, opts = {}) => toast({ ...opts, variant: 'info', title });

export function useToastStore() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  useEffect(() => {
    const onToast = (t) => {
      setToasts((prev) => {
        const next = [...prev, t];
        return next.slice(-3); // cap at 3 visible
      });
      const handle = setTimeout(() => dismiss(t.id), t.duration);
      timers.current.set(t.id, handle);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, [dismiss]);

  return { toasts, dismiss };
}
