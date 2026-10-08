import { useEffect, useRef, useState } from 'react';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { formatNumber } from '@/lib/format';

/** Najduže trajanje animirane promene vrednosti (pravilo kretanja: ≤ 0,5 s). */
export const COUNT_UP_MAX_MS = 500;

export interface CountUpProps {
  /** Ciljna vrednost; null prikazuje crticu (bez animacije). */
  value: number | null;
  /** Formatiranje broja (podrazumevano `formatNumber(v, 0)`, sr-Latn). */
  format?: (value: number) => string;
  /** Trajanje animirane promene u ms (podrazumevano i najviše `COUNT_UP_MAX_MS`, ease-out). */
  duration?: number;
  /**
   * Izričit opt-in za odbrojavanje pri PRVOM prikazu (npr. brojači napretka na Sinhronizaciji
   * koji kreću od 0). Bez ovoga prvi prikaz je odmah konačna vrednost – brojevi na Pregledu i u
   * KPI pločicama ne „odbrojavaju“ od nule pri svakom povratku na stranicu.
   */
  from?: number;
  className?: string;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * Broj čija se PROMENA animira (requestAnimationFrame, ≤ 0,5 s ease-out, od prethodne ka novoj
 * vrednosti). Prvi prikaz je uvek konačna vrednost – nema odbrojavanja od nule – osim uz izričit
 * `from`. Uz smanjeno kretanje odmah prikazuje konačnu vrednost. Čitači ekrana dobijaju samo
 * konačnu vrednost (animirani tekst je aria-hidden). Veliki brojevi koriste proporcionalne
 * cifre (bez `tnum`).
 */
export function CountUp({ value, format = (v) => formatNumber(v, 0), duration = COUNT_UP_MAX_MS, from, className }: CountUpProps) {
  const reduced = useReducedMotion();
  // Prvi prikaz: konačna vrednost; `from` (opt-in) je početak odbrojavanja, osim uz smanjeno kretanje.
  const [display, setDisplay] = useState<number | null>(() => (value === null ? null : reduced || from === undefined ? value : from));
  const currentRef = useRef<number | null>(display);
  const fromRef = useRef(from);

  useEffect(() => {
    if (value === null) {
      currentRef.current = null;
      setDisplay(null);
      return;
    }
    // Posle crtice (nema podatka → podatak) nema odbrojavanja od nule: skok na vrednost, osim uz `from`.
    const start = currentRef.current ?? fromRef.current ?? value;
    if (reduced || start === value || typeof requestAnimationFrame !== 'function') {
      currentRef.current = value;
      setDisplay(value);
      return;
    }
    const total = Math.max(0, Math.min(COUNT_UP_MAX_MS, duration));
    let frame = 0;
    const startedAt = performance.now();
    const tick = (time: number) => {
      const progress = total > 0 ? Math.min(1, (time - startedAt) / total) : 1;
      const next = progress >= 1 ? value : start + (value - start) * easeOutCubic(progress);
      currentRef.current = next;
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced, duration]);

  const finalText = value === null ? '–' : format(value);
  return (
    <span className={className}>
      <span aria-hidden>{display === null ? '–' : format(display)}</span>
      <span className="sr-only">{finalText}</span>
    </span>
  );
}
