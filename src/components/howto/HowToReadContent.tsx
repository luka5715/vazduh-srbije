import { ExternalLink, X } from 'lucide-react';
import { useEffect, type ReactNode, type RefObject } from 'react';

import { CATEGORIES, PARAMETER_LABELS, PARAMETER_NAMES, PARAMETERS, THRESHOLDS_1H, UNIT } from '@shared/aqi';

import { CategoryChip, CategoryDot } from '@/components/ui/Category';
import { formatInt } from '@/lib/format';
import { LIVE_HOURS, STALE_HOURS } from '@/lib/stations';

/** Starost vrednosti polutanta (od najnovijeg sata stanice) do koje ulazi u kategoriju stanice. */
const POLLUTANT_WINDOW_HOURS = 3;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="font-heading text-[15px] font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Sadržaj dijaloga „Kako čitati“ (učitava se tek pri prvom otvaranju – nije u glavnom paketu).
 * Pragovi i saveti dolaze iz `@shared/aqi`, konstante svežine iz `@/lib/stations`.
 */
export default function HowToReadContent({ titleId, closeRef, onClose }: { titleId: string; closeRef: RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  // Pri prvom otvaranju sadržaj stiže posle `showModal()` – fokus se tada prebacuje na „Zatvori“.
  useEffect(() => {
    if (closeRef.current && !closeRef.current.contains(document.activeElement)) closeRef.current.focus();
  }, [closeRef]);
  return (
    <div className="flex max-h-[min(88dvh,820px)] flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-6 sm:py-4">
        <div>
          <p className="eyebrow">Vodič</p>
          <h2 id={titleId} className="text-lg font-semibold text-ink">
            Kako čitati podatke
          </h2>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Zatvori"
          className="grid size-9 shrink-0 place-items-center rounded-ctl text-muted hover:bg-card-2 hover:text-ink"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>

      <div className="flex flex-col gap-6 overflow-y-auto px-4 py-4 text-[14px] leading-6 text-muted sm:px-6 sm:py-5">
        <Section title="Kategorije i saveti">
          <ul className="flex flex-col gap-2">
            {CATEGORIES.map((category) => (
              <li key={category.rank} className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[132px_minmax(0,1fr)]">
                <CategoryChip category={category} size="sm" className="justify-self-start" />
                <span className="text-[13.5px] leading-5 text-ink">{category.advice}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs leading-5 text-faint">Nazivi kategorija su iz SEPA indeksa; saveti su kratka formulacija ove aplikacije, nisu zvanični tekst SEPA.</p>
        </Section>

        <Section title={`Satni pragovi (${UNIT}, prosek jednog sata)`}>
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[300px] border-collapse text-[12.5px] leading-5">
              <caption className="sr-only">
                Gornje granice kategorija po polutantu, {UNIT}. Vrednost jednaka granici pripada nižoj kategoriji.
              </caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="py-1.5 pr-2 font-mono text-[11px] font-medium uppercase tracking-wider text-muted">
                    Kategorija
                  </th>
                  {PARAMETERS.map((parameter) => (
                    <th key={parameter} scope="col" className="px-1 py-1.5 text-right font-mono text-[11px] font-medium text-muted">
                      <abbr title={PARAMETER_NAMES[parameter]} className="no-underline">
                        {PARAMETER_LABELS[parameter]}
                      </abbr>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map((category) => (
                  <tr key={category.rank} className="border-b border-border/60 last:border-b-0">
                    <th scope="row" className="py-1.5 pr-2 text-left font-normal text-ink">
                      <span className="flex items-center gap-1.5">
                        <CategoryDot rank={category.rank} size={8} />
                        {category.label}
                      </span>
                    </th>
                    {PARAMETERS.map((parameter) => {
                      const limits: readonly number[] = THRESHOLDS_1H[parameter];
                      const text = category.rank < limits.length ? `≤ ${formatInt(limits[category.rank])}` : `> ${formatInt(limits[limits.length - 1])}`;
                      return (
                        <td key={parameter} className="tnum whitespace-nowrap px-1 py-1.5 text-right text-ink">
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs leading-5 text-faint">
            Vrednost do granice (uključivo) pripada kategoriji u tom redu, a iznad nje sledećoj. Vrednosti se prikazuju sa jednom decimalom ispod 100 i
            kao ceo broj od 100 naviše.
          </p>
        </Section>

        <Section title="Kategorija stanice: najlošiji polutant">
          <p>
            Svaki polutant dobija kategoriju po svom pragu. Stanica dobija <strong className="font-semibold text-ink">najlošiju</strong> od tih kategorija, a
            polutant koji je određuje je „dominantni“; pri istoj kategoriji odlučuje polutant bliži sledećem pragu. Uzimaju se vrednosti ne starije od{' '}
            {POLLUTANT_WINDOW_HOURS} h od najnovijeg sata stanice. Sočivo polutanta (npr. NO₂) prikazuje kategoriju samo tog polutanta; naslov Pregleda
            uvek opisuje sve polutante.
          </p>
        </Section>

        <Section title="Svežina">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-faint">
            <li>
              SEPA objavljuje satne proseke sa kašnjenjem od 1 do 3 sata. Sat je interval (npr. „16–17 h“), a „pre 2 h“ je starost njegovog početka.
            </li>
            <li>
              „Uživo“ (tačka koja pulsira) znači da se najnoviji sat mreže završio pre najviše {LIVE_HOURS} h. Kad je stariji, piše „poslednji sat“ sa
              starošću, a datum kad nije današnji.
            </li>
            <li>
              Stanica bez merenja u poslednjih {STALE_HOURS} h je „bez svežih podataka“: ne ulazi u stanje mreže, medijane ni rang-liste, a na mapi je
              siva.
            </li>
            <li>Stanice koje je SEPA ugasila (neaktivne) ne broje se u mrežu.</li>
          </ul>
        </Section>

        <Section title="Medijane i okruzi">
          <p>
            Brojevi mreže i okruga su medijane svežih stanica (srednja vrednost po veličini), pa jedna izuzetna stanica ne pomera ceo broj. Sati sa
            premalo stanica nemaju medijanu. Uz okrug stoji broj stanica: medijana jedne stanice je samo njena vrednost, ne slika celog okruga.
          </p>
        </Section>

        <Section title="Preliminarni podaci">
          <p>
            Vrednosti su preliminarni (neverifikovani) satni proseci SEPA i mogu naknadno biti ispravljene ili uklonjene. Aplikacija nije zvanični SEPA
            indeks i nije alat za proveru usklađenosti sa zakonskim graničnim vrednostima. Gustina čestica u pozadini Pregleda prati medijanu PM10
            mreže – ilustracija je, ne merenje.
          </p>
          <p>
            <a
              href="https://vazduh.sepa.gov.rs/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
            >
              vazduh.sepa.gov.rs
              <ExternalLink aria-hidden className="size-3" />
              <span className="sr-only"> (otvara se u novom prozoru)</span>
            </a>
          </p>
        </Section>
      </div>
    </div>
  );
}
