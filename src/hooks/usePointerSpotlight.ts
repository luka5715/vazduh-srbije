import { useEffect, type RefObject } from 'react';

/**
 * Reflektor koji prati pokazivač: postavlja `--mx`/`--my` (px u odnosu na element) i
 * `data-spot="on"` dok je pokazivač iznad elementa. CSS (`.glass::after`) crta sjaj.
 * Radi samo na uređajima sa hover-om (`(hover: hover)`); dodir ga ne uključuje.
 * Ažuriranje je ograničeno na jedan put po kadru (requestAnimationFrame).
 */
export function usePointerSpotlight<T extends HTMLElement>(ref: RefObject<T | null>, enabled = true): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    if (typeof window.matchMedia !== 'function' || !window.matchMedia('(hover: hover)').matches) return;

    let frame = 0;
    let x = 0;
    let y = 0;
    const apply = () => {
      frame = 0;
      element.style.setProperty('--mx', `${x}px`);
      element.style.setProperty('--my', `${y}px`);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const rect = element.getBoundingClientRect();
      x = Math.round(event.clientX - rect.left);
      y = Math.round(event.clientY - rect.top);
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      element.dataset.spot = 'on';
      onMove(event);
    };
    const onLeave = () => {
      delete element.dataset.spot;
    };
    element.addEventListener('pointerenter', onEnter);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerleave', onLeave);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      element.removeEventListener('pointerenter', onEnter);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerleave', onLeave);
      delete element.dataset.spot;
    };
  }, [ref, enabled]);
}
