import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

/**
 * Dok je nešto izabrano (tooltip prikazan), dodir/klik van `ref` ili Esc ga briše.
 * Hvata se u fazi „capture“, pa radi i kad cilj zaustavi širenje događaja.
 */
export function useDismissOutside(ref: RefObject<HTMLElement | null>, active: boolean, onDismiss: () => void) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      const node = ref.current;
      if (node && event.target instanceof Node && node.contains(event.target)) return;
      dismissRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, active]);
}

/**
 * Pokazivač na grafikonu sa nišanom (satni, dnevni, trend mreže):
 *  - miš: hover kao do sada (izlazak sa grafikona briše izbor);
 *  - dodir: tap bira tačku i tooltip OSTAJE posle podizanja prsta (`pointerleave` dodira stiže
 *    odmah po podizanju i zanemaruje se), vodoravno prevlačenje menja izbor, a kad pregledač
 *    preuzme pokret za vertikalni skrol (`pointercancel`) izbor se briše;
 *  - tap van grafikona ili Esc briše izbor.
 * SVG zadržava `touch-pan-y`, pa vertikalni pokret uvek skroluje stranu.
 */
export function useChartPointer<E extends Element>({
  containerRef,
  active,
  pick,
  clear,
}: {
  containerRef: RefObject<HTMLElement | null>;
  /** Da li je nešto izabrano (uključuje slušanje dodira van grafikona i tastera Esc). */
  active: boolean;
  /** Bira tačku prema položaju pokazivača. */
  pick: (event: ReactPointerEvent<E>) => void;
  clear: () => void;
}) {
  useDismissOutside(containerRef, active, clear);
  return {
    onPointerDown: (event: ReactPointerEvent<E>) => {
      if (event.pointerType === 'touch') pick(event);
    },
    onPointerMove: (event: ReactPointerEvent<E>) => pick(event),
    onPointerLeave: (event: ReactPointerEvent<E>) => {
      if (event.pointerType !== 'touch') clear();
    },
    onPointerCancel: (event: ReactPointerEvent<E>) => {
      if (event.pointerType === 'touch') clear();
    },
  };
}
