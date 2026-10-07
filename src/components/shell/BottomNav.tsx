import { useAtmosfera } from '@/hooks/useAtmosfera';
import { cn } from '@/lib/cn';

import { NAV_ITEMS, SYNC_HEALTH } from './navigation';
import { SyncHealthDot } from './Sidebar';
import { useNavBadges } from './useNavBadges';

/**
 * Donja traka sa 5 stranica (telefon, < 1024 px): ikonica + kratak natpis, poštuje
 * `env(safe-area-inset-bottom)` i bočne sigurne zone. Sadržaj ima donji razmak (`pb-safe-nav`),
 * pa je ne pokriva. Na položenom telefonu (`short`) traka je zbijena (≈ 48 px).
 * Naziv dugmeta počinje vidljivim natpisom („Sinhr. (sinhronizacija), status: …“).
 */
export function BottomNav({ className }: { className?: string }) {
  const { view, navigate } = useAtmosfera();
  const badges = useNavBadges();
  return (
    <nav
      aria-label="Stranice"
      className={cn('shell-bar vt-bottomnav fixed inset-x-0 bottom-0 z-40 border-t border-border pb-[env(safe-area-inset-bottom)]', className)}
    >
      <ul className="mx-auto grid h-16 max-w-xl grid-cols-5 pl-[max(4px,env(safe-area-inset-left))] pr-[max(4px,env(safe-area-inset-right))] short:h-12">
        {NAV_ITEMS.map((item) => {
          const active = item.name === view;
          const Icon = item.icon;
          const badge = badges[item.name];
          const health = badge.health ? SYNC_HEALTH[badge.health] : null;
          return (
            <li key={item.name} className="flex">
              <button
                type="button"
                onClick={() => navigate(item.name)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex flex-1 flex-col items-center justify-center gap-1 rounded-ctl text-[11px] font-medium transition-colors short:gap-0.5 short:text-[10px]',
                  active ? 'text-ink' : 'text-muted hover:text-ink',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'relative grid h-7 w-12 place-items-center rounded-full transition-[background-color,box-shadow] duration-200 short:h-6',
                    active && 'bg-[color-mix(in_oklab,var(--ink)_9%,transparent)] shadow-[0_8px_20px_-10px_var(--haze-glow)]',
                  )}
                >
                  <Icon className={cn('size-[19px] short:size-4', active ? 'text-accent' : 'text-muted')} />
                  {badge.health ? <SyncHealthDot health={badge.health} className="absolute right-2 top-0.5" /> : null}
                </span>
                <span className="leading-none">
                  {item.short}
                  {item.short !== item.title ? <span className="sr-only"> ({item.title.toLowerCase()})</span> : null}
                  {health ? <span className="sr-only">, status: {health.text}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
