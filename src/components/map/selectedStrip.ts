import { useEffect, useState, type RefObject } from 'react';

/**
 * Traka izabrane stanice na Mapi (ispod xl, kad su detalji ispod mape): kada se prikazuje i gde.
 *
 *  - < lg (telefon, donja navigacija): lebdi iznad donje navigacije dok je panel detalja
 *    ISPOD donje ivice ekrana – dodir na tačku se tako uvek vidi; nestaje kad detalji uđu u
 *    ekran (ili kad ih je korisnik već prošao – tada bi samo pokrivala sadržaj);
 *  - lg–xl (bez donje navigacije): u toku ispod okvira mape, lepljiva uz dno ekrana dok je
 *    okvir viši od vidljivog dela;
 *  - ≥ xl: nema je (detalji su pored mape).
 */

/** Medijski upit praga `lg` (bočna traka umesto donje navigacije) – isti kao u AppShell/BottomNav. */
export const WIDE_QUERY = '(min-width: 1024px)';

/**
 * Donja ivica posmatranog okvira se podiže za 120 px: detalji se smatraju „na ekranu“ tek kad
 * im se vidi bar toliko (ne samo gornja ivica), pa traka ne nestaje prerano.
 */
export const DETAIL_ROOT_MARGIN = '0px 0px -120px 0px';

/**
 * Da li je panel detalja ispod ekrana (traka ima smisla): ne preseca posmatrani okvir, a gornja
 * ivica mu je ispod gornje ivice ekrana (inače je iznad – korisnik ga je već prošao).
 */
export function detailBelowViewport(entry: Pick<IntersectionObserverEntry, 'isIntersecting' | 'boundingClientRect'>): boolean {
  return !entry.isIntersecting && entry.boundingClientRect.top > 0;
}

/**
 * Prati da li je element (panel detalja) ispod ekrana. Bez IntersectionObserver-a (jsdom) ili
 * kad nije `enabled` vraća false – traka se tada ne prikazuje (umesto da pokriva sadržaj).
 */
export function useDetailBelow(ref: RefObject<Element | null>, enabled: boolean): boolean {
  const [below, setBelow] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof IntersectionObserver === 'undefined') {
      setBelow(false);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setBelow(detailBelowViewport(entry));
      },
      { rootMargin: DETAIL_ROOT_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, enabled]);

  return below;
}
