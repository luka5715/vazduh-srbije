import { createElement, useCallback, useRef, type HTMLAttributes, type ReactNode, type Ref } from 'react';

import { usePointerSpotlight } from '@/hooks/usePointerSpotlight';
import { cn } from '@/lib/cn';

export type GlassVariant = 'hero' | 'panel' | 'tile';

type GlassElement = 'section' | 'div' | 'article' | 'aside' | 'li' | 'header' | 'figure' | 'button' | 'a';

export interface GlassPanelProps extends HTMLAttributes<HTMLElement> {
  /**
   * - `hero`: veliki panel sa jačim sjajem izmaglice i `backdrop-filter` (samo jedan po stranici);
   * - `panel`: sekcija stranice (radijus 20 px);
   * - `tile`: KPI pločica / manja kartica (radijus 14 px).
   */
  variant?: GlassVariant;
  /** HTML element (podrazumevano `section`). Za klikabilnu pločicu `button` ili `a`. */
  as?: GlassElement;
  /** Podiže se na hover (translateY(-2px) + senka) – samo za interaktivne pločice/redove. */
  interactive?: boolean;
  /** Reflektor koji prati pokazivač (podrazumevano uključen za `hero` i `panel`, i za interaktivne). */
  spotlight?: boolean;
  /** Neprozirna ispuna (`--panel-solid`), npr. za meni ili sadržaj preko drugog stakla. */
  solid?: boolean;
  /** `type` za `as="button"` (podrazumevano `button`). */
  type?: 'button' | 'submit';
  /** `href` za `as="a"`. */
  href?: string;
  disabled?: boolean;
  ref?: Ref<HTMLElement>;
  children?: ReactNode;
}

/**
 * Stakleni panel „Atmosfere“: providna ispuna preko gradijentne linije ivice
 * (padding-box/border-box trik), sjaj izmaglice gore levo i opcioni reflektor koji
 * prati pokazivač. Bez `backdrop-filter` osim za `hero` (budžet performansi).
 * Pseudo-elementi `::before`/`::after` su zauzeti – ne dodavati before:/after: klase.
 */
export function GlassPanel({
  variant = 'panel',
  as = 'section',
  interactive = false,
  spotlight,
  solid = false,
  className,
  children,
  ref,
  type,
  ...rest
}: GlassPanelProps) {
  const localRef = useRef<HTMLElement | null>(null);
  const spotOn = spotlight ?? (variant !== 'tile' || interactive);
  usePointerSpotlight(localRef, spotOn);

  const setRef = useCallback(
    (node: HTMLElement | null) => {
      localRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as { current: HTMLElement | null }).current = node;
    },
    [ref],
  );

  return createElement(
    as,
    {
      ...rest,
      ...(as === 'button' ? { type: type ?? 'button' } : {}),
      ref: setRef,
      className: cn(
        'glass',
        variant === 'hero' && 'glass--hero',
        variant === 'tile' && 'glass--tile',
        solid && 'glass--solid',
        interactive && 'glass--interactive',
        (as === 'button' || as === 'a') && 'block w-full text-left',
        className,
      ),
    },
    children,
  );
}
