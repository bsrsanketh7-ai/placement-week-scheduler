'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Treats an environment with no matchMedia (server, jsdom in the tests) as
 * reduced motion, so numbers there always settle on their final value at once.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Tweens from the previous value to the new one. The first render shows the
 * real value immediately, so server output and tests see final numbers and
 * only later changes animate.
 */
export function AnimatedNumber({
  value, decimals = 0, suffix = '', duration = 450,
}: { value: number; decimals?: number; suffix?: string; duration?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value) return;
    if (prefersReducedMotion() || typeof requestAnimationFrame === 'undefined') {
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(start + (value - start) * eased);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <>{shown.toFixed(decimals)}{suffix}</>;
}

/**
 * Counts up from zero the first time it scrolls into view. For the landing
 * page stats, where the number arriving is part of the story.
 */
export function CountUp({
  to, decimals = 0, suffix = '', duration = 1200,
}: { to: number; decimals?: number; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(to);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return;
    setShown(0);
    let raf = 0;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / duration);
        setShown(to * (1 - Math.pow(1 - k, 3)));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to, duration]);

  return <span ref={ref}>{shown.toFixed(decimals)}{suffix}</span>;
}
