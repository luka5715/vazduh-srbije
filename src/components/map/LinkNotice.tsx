import { Link2Off, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useAtmosfera } from '@/hooks/useAtmosfera';
import { LENS_PARAM, OKRUG_PARAM, STATION_PARAM, useView } from '@/hooks/useView';
import { cn } from '@/lib/cn';
import { isLens } from '@/lib/insights';

import { findLinkIssues, linkIssueKey, linkIssueText, type LinkIssueParam } from './linkIssues';

const URL_PARAM: Record<LinkIssueParam, string> = { station: STATION_PARAM, lens: LENS_PARAM, okrug: OKRUG_PARAM };

interface Notice {
  key: string;
  text: string;
}

/**
 * Obaveštenje o neispravnom linku: kad `?station=`, `?lens=` ili `?okrug=` ne odgovaraju
 * podacima (ugašena stanica, polutant koji se ne prati, okrug bez stanica), parametri se
 * uklanjaju iz URL-a (zamenom, jednim upisom) i ovde piše šta je prikazano umesto njih – nikad
 * tiho druga stanica. Proverava se tek kad su stanice učitane; poruka ostaje dok je korisnik ne
 * zatvori ili ne pređe na drugu stranicu. Kad nema poruke, element je prazan i skriven.
 */
export function LinkNotice({ className }: { className?: string }) {
  const { data, views, okrugs, view, kpis } = useAtmosfera();
  const { stationParam, lensParam, okrugParam, replaceParams } = useView();
  const [notices, setNotices] = useState<Notice[]>([]);

  const ready = data.status === 'ready' && views.length > 0;
  const stationIds = useMemo(() => new Set(views.map((station) => station.id)), [views]);
  const hasWorst = kpis.reporting > 0;

  useEffect(() => {
    if (!ready) return;
    const issues = findLinkIssues({ stationParam, lensParam, okrugParam }, { hasStation: (id) => stationIds.has(id), okrugs, isLens });
    if (issues.length === 0) return;
    setNotices((previous) => {
      const next = [...previous];
      for (const issue of issues) {
        const key = linkIssueKey(issue);
        if (!next.some((notice) => notice.key === key)) next.push({ key, text: linkIssueText(issue, { view, hasWorst }) });
      }
      return next.length === previous.length ? previous : next;
    });
    replaceParams(Object.fromEntries(issues.map((issue) => [URL_PARAM[issue.param], null])));
  }, [ready, stationParam, lensParam, okrugParam, stationIds, okrugs, view, hasWorst, replaceParams]);

  return (
    <div aria-live="polite" className={cn('empty:hidden', className)}>
      {notices.length > 0 ? (
        <div
          data-testid="link-notice"
          className="flex items-start gap-3 rounded-ctl border border-warn/30 bg-warn-soft px-3.5 py-3 text-[13px] leading-5 text-warn-soft-ink"
        >
          <Link2Off aria-hidden className="mt-0.5 size-4 shrink-0" />
          {notices.length === 1 ? (
            <p className="min-w-0 flex-1">{notices[0].text}</p>
          ) : (
            <ul className="min-w-0 flex-1 list-disc space-y-1 pl-4">
              {notices.map((notice) => (
                <li key={notice.key}>{notice.text}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setNotices([])}
            aria-label="Zatvori obaveštenje o linku"
            className="touch-target -my-1 -mr-1.5 grid size-7 shrink-0 place-items-center rounded-full transition-colors hover:bg-[color-mix(in_oklab,var(--warn-soft-ink)_12%,transparent)]"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
