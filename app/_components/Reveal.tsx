'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';

type State = 'static' | 'waiting' | 'entering' | 'shown';

/**
 * Fades its children up the first time they scroll into view. Content is
 * visible by default and only hidden once the observer is confirmed to work,
 * so a script failure never leaves a blank section. The stagger delay applies
 * to the entrance only; once settled it is dropped so hover effects on the
 * same element respond immediately.
 */
export function Reveal({
  children, delay = 0, className = '', as: Tag = 'div',
}: { children: ReactNode; delay?: number; className?: string; as?: 'div' | 'section' | 'li' }) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<State>('static');

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    setState('waiting');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      setState('entering');
      timer = setTimeout(() => setState('shown'), delay + 800);
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    io.observe(el);
    return () => { io.disconnect(); clearTimeout(timer); };
  }, [delay]);

  const cls = state === 'entering' ? 'shown' : state;
  return (
    <Tag
      ref={ref as never}
      className={`reveal ${cls} ${className}`}
      style={state === 'entering' ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
