import { Pause, Play } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/cn';

export interface MarqueeItem {
  key: string;
  /**
   * Sadržaj stavke. Funkcija dobija `clone` (true u drugoj, samo vizuelnoj kopiji): tamo
   * dugmad/linkovi treba da imaju `tabIndex={-1}` – ostaju klikabilni, ali van redosleda fokusa.
   */
  content: ReactNode | ((clone: boolean) => ReactNode);
}

export interface MarqueeProps {
  items: MarqueeItem[];
  /** Naziv regiona za čitače ekrana, npr. „Uživo po stanicama“. */
  label: string;
  /** Brzina u px/s (podrazumevano 36). */
  speed?: number;
  /** Razmak između stavki u px (podrazumevano 28). */
  gap?: number;
  className?: string;
  itemClassName?: string;
}

/** Posle dodira traka stoji još ovoliko, da stavka ne „pobegne“ ispod prsta. */
const TOUCH_RESUME_MS = 3000;
/** Razmak fokusirane stavke od ivice (ivice trake su prigušene maskom od 6 %). */
const FOCUS_MARGIN_SHARE = 0.06;

/**
 * Pokretna traka („ticker“): sadržaj se ponavlja i klizi ulevo. Pauzira na hover, na dodir
 * (još 3 s posle podizanja prsta) i dugmetom na početku (WCAG 2.2.2, prvo u redosledu fokusa).
 * Dok je fokus tastature u traci, ona postaje običan red koji se skroluje (bez kopije i
 * animacije) i fokusirana stavka je cela vidljiva. Druga kopija je samo vizuelna (aria-hidden):
 * klikabilna je, ali njena dugmad nisu u redosledu fokusa (vidi `MarqueeItem.content`).
 * Uz smanjeno kretanje, ili kad sadržaj staje u širinu, traka je običan red koji se skroluje.
 */
export function Marquee({ items, label, speed = 36, gap = 28, className, itemClassName }: MarqueeProps) {
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const [touchHold, setTouchHold] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLUListElement>(null);
  const focusedRef = useRef<HTMLElement | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [widths, setWidths] = useState({ content: 0, viewport: 0 });

  useEffect(() => {
    const viewport = viewportRef.current;
    const copy = copyRef.current;
    if (!viewport || !copy || typeof ResizeObserver === 'undefined') return;
    const update = () => setWidths({ content: copy.scrollWidth, viewport: viewport.clientWidth });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(copy);
    return () => observer.disconnect();
  }, [items.length]);

  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    [],
  );

  const fits = widths.content > 0 && widths.content <= widths.viewport;
  /** Traka bi se kretala (bez obzira na fokus) – tada postoji i dugme za pauzu. */
  const canAnimate = !reduced && !fits && items.length > 1;
  const animate = canAnimate && !focusInside;
  const duration = Math.max(12, (widths.content + gap) / speed);

  // Fokusirana stavka je cela vidljiva: skrol se računa ručno (bez scrollIntoView, koji bi
  // pomerio i stranicu), posle prelaska u statičan red.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const target = focusedRef.current;
    if (!focusInside || !viewport || !target || !viewport.contains(target)) return;
    const item = target.closest('li') ?? target;
    const view = viewport.getBoundingClientRect();
    const rect = item.getBoundingClientRect();
    const margin = Math.min(view.width * FOCUS_MARGIN_SHARE + 4, Math.max(0, (view.width - rect.width) / 2));
    if (rect.left < view.left + margin) viewport.scrollLeft -= view.left + margin - rect.left;
    else if (rect.right > view.right - margin) viewport.scrollLeft += rect.right - (view.right - margin);
  }, [focusInside, focusTick]);

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // Samo fokus tastature (`:focus-visible`): klik mišem/dodir fokusira dugme na pritisak, a
    // prelazak u statičan red bi tada pomerio stavku ispod pokazivača pre otpuštanja (bez klika).
    let keyboard = true;
    try {
      keyboard = target.matches(':focus-visible');
    } catch {
      keyboard = true;
    }
    if (!keyboard) return;
    focusedRef.current = target;
    setFocusInside(true);
    setFocusTick((tick) => tick + 1);
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    focusedRef.current = null;
    setFocusInside(false);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
    setTouchHold(true);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      resumeTimer.current = null;
      setTouchHold(false);
    }, TOUCH_RESUME_MS);
  };

  const list = (clone: boolean) => (
    <ul ref={clone ? undefined : copyRef} aria-hidden={clone || undefined} className="flex shrink-0 items-center" style={{ gap, paddingRight: gap }}>
      {items.map((item) => (
        <li key={item.key} className={cn('shrink-0', itemClassName)}>
          {typeof item.content === 'function' ? item.content(clone) : item.content}
        </li>
      ))}
    </ul>
  );

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Dugme za pauzu je PRVO u redosledu fokusa – do njega se stiže pre stavki trake. */}
      {canAnimate ? (
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
          aria-label={paused ? 'Pokreni traku' : 'Zaustavi traku'}
          className="touch-target grid size-8 shrink-0 place-items-center rounded-full border border-border text-muted transition-colors hover:border-border-strong hover:text-ink"
        >
          {paused ? <Play aria-hidden className="size-3.5" /> : <Pause aria-hidden className="size-3.5" />}
        </button>
      ) : null}
      <div
        ref={viewportRef}
        role="region"
        aria-label={label}
        tabIndex={canAnimate ? undefined : 0}
        data-paused={paused || touchHold || undefined}
        data-focus={focusInside || undefined}
        onFocus={onFocus}
        onBlur={onBlur}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // Vertikalni razmak (poništen marginom): proširena površina za dodir stavki
        // (`touch-target`) ne seče se na ivici okvira sa `overflow`.
        className={cn('marquee -my-1.5 min-w-0 flex-1 py-1.5', animate ? 'overflow-hidden' : 'scroll-row')}
      >
        <div
          className={cn(animate ? 'marquee__track' : 'flex w-max')}
          style={animate ? ({ '--marquee-duration': `${duration}s` } as CSSProperties) : undefined}
        >
          {list(false)}
          {animate ? list(true) : null}
        </div>
      </div>
    </div>
  );
}
