import { useEffect, useState } from 'react';

import { prefersReducedMotion, REDUCED_MOTION_QUERY } from '@/lib/motion';

/**
 * Prati `prefers-reduced-motion: reduce`. Komponente sa JS animacijom (Canvas, brojači,
 * pokretna traka) na osnovu ovoga crtaju statično stanje.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
