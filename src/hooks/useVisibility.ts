import { useEffect, useState, type RefObject } from 'react';

/**
 * Da li je element stvarno vidljiv: u viewport-u (IntersectionObserver) I kartica je
 * aktivna (`document.visibilityState === 'visible'`). Animacije (Canvas) rade samo tada.
 * Bez IntersectionObserver-a (stari browser, jsdom) element se smatra vidljivim.
 */
export function useVisibility<T extends Element>(ref: RefObject<T | null>, rootMargin = '64px'): boolean {
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setInView(entry.isIntersecting);
    }, { rootMargin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin]);

  useEffect(() => {
    const onChange = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  return inView && pageVisible;
}
