/**
 * Kretanje: poštovanje `prefers-reduced-motion` i omotač za View Transitions API.
 */

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/** Da li korisnik traži smanjeno kretanje (bezbedno i van browsera). */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED_QUERY).matches;
}

export const REDUCED_MOTION_QUERY = REDUCED_QUERY;

/** Minimalni oblik `ViewTransition` objekta koji koristimo (TS lib.dom ga možda nema). */
interface ViewTransitionLike {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
}

type StartViewTransition = (callback: () => void | Promise<void>) => ViewTransitionLike;

/** Da li browser podržava View Transitions i da li je kretanje dozvoljeno. */
export function canViewTransition(): boolean {
  if (typeof document === 'undefined') return false;
  const start = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition;
  return typeof start === 'function' && !prefersReducedMotion();
}

/**
 * Izvršava `update` unutar `document.startViewTransition` kad je moguće; inače odmah.
 * `kind` se upisuje u `html[data-vt]` za vreme prelaza, da CSS zna koju animaciju da
 * pokrene (`page` = stranica, `theme` = kružno otkrivanje teme). `update` mora sinhrono
 * da primeni promenu DOM-a (npr. kroz `flushSync`).
 */
export function runViewTransition(kind: 'page' | 'theme', update: () => void): ViewTransitionLike | null {
  if (!canViewTransition()) {
    update();
    return null;
  }
  const root = document.documentElement;
  root.dataset.vt = kind;
  const start = (document as Document & { startViewTransition: StartViewTransition }).startViewTransition.bind(document);
  try {
    const transition = start(update);
    const clear = () => {
      if (root.dataset.vt === kind) delete root.dataset.vt;
    };
    transition.finished.then(clear, clear);
    // Odbijeno `ready` (npr. prelaz preskočen) ne sme da završi kao neuhvaćena greška.
    transition.ready.catch(() => undefined);
    transition.updateCallbackDone.catch(() => undefined);
    return transition;
  } catch {
    delete root.dataset.vt;
    update();
    return null;
  }
}
