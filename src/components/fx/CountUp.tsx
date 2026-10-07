import { useEffect, useRef, useState } from 'react';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { formatNumber } from '@/lib/format';

export interface CountUpProps {
  /** Ciljna vrednost; null prikazuje crticu (bez animacije). */
  value: number | null;
  /** Formatiranje broja (podrazumevano `formatNumber(v, 0)`, sr-Latn). */
  format?: (value: number) => string;
  /** Trajanje u ms (podrazumevano 900, ease-out). */
  duration?: number;
  /** Početna vrednost pri prvom prikazu (podrazumevano 0). */
  from?: number;
  className?: string;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * Broj koji „odbrojava“ do vrednosti (requestAnimationFrame, ~900 ms ease-out).
 * Pri osvežavanju kreće od prethodne vrednosti. Uz smanjeno kretanje odmah prikazuje
 * konačnu vrednost. Čitači ekrana dobijaju samo konačnu vrednost (animirani tekst je aria-hidden).
 * Veliki brojevi koriste proporcionalne cifre (bez `tnum`).
 */
export function CountUp({ value, format = (v) => formatNumber(v, 0), duration = 900, from = 0, className }: CountUpProps) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState<number | null>(() => (value === null ? null : reduced ? value : from));
  const currentRef = useRef<number | null>(display);

  useEffect(() => {
    if (value === null) {
      currentRef.current = null;
      setDisplay(null);
      return;
    }
    const start = currentRef.current ?? from;
    if (reduced || start === value || typeof requestAnimationFrame !== 'function') {
      currentRef.current = value;
      setDisplay(value);
      return;
    }
    let frame = 0;
    const startedAt = performance.now();
    const tick = (time: number) => {
      const progress = Math.min(1, (time - startedAt) / duration);
      const next = progress >= 1 ? value : start + (value - start) * easeOutCubic(progress);
      currentRef.current = next;
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced, duration, from]);

  const finalText = value === null ? '–' : format(value);
  return (
    <span className={className}>
      <span aria-hidden>{display === null ? '–' : format(display)}</span>
      <span className="sr-only">{finalText}</span>
    </span>
  );
}
