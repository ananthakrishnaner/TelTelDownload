import { useEffect, useState, useRef } from 'react';

/**
 * Animates a number from 0 (or `from`) to `value` over `duration` ms.
 * Returns the current displayed number (rounded to `decimals`).
 */
export default function useCountUp(value, { duration = 700, decimals = 0, from = 0 } = {}) {
  const [display, setDisplay] = useState(from);
  const startTimeRef = useRef(null);
  const fromRef = useRef(from);
  const toRef = useRef(value);
  const rafRef = useRef(null);

  useEffect(() => {
    fromRef.current = display;
    toRef.current = Number(value) || 0;
    startTimeRef.current = null;

    const step = (timestamp) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = fromRef.current + (toRef.current - fromRef.current) * eased;
      setDisplay(Number(current.toFixed(decimals)));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(toRef.current);
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, decimals]);

  return display;
}
