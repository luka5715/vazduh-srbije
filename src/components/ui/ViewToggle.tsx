import { ChartColumn, Table2 } from 'lucide-react';

import { cn } from '@/lib/cn';

export type View = 'chart' | 'table';

/** Prekidač grafikon/tabela – svaki grafikon ima tabelarnog blizanca. */
export function ViewToggle({ value, onChange, label }: { value: View; onChange: (view: View) => void; label: string }) {
  const options: Array<{ key: View; text: string; icon: typeof ChartColumn }> = [
    { key: 'chart', text: 'Grafikon', icon: ChartColumn },
    { key: 'table', text: 'Tabela', icon: Table2 },
  ];
  return (
    <div role="group" aria-label={label} className="inline-flex h-8 rounded-ctl border border-border bg-card-2 p-0.5 shadow-[var(--shadow-inset)]">
      {options.map(({ key, text, icon: Icon }) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cn(
            // `touch-target-y`: na dodirnim ekranima segment se dodiruje u visini od 44 px
            // (susedni segment je tik uz njega, pa se ne širi vodoravno).
            'touch-target-y inline-flex items-center gap-1.5 rounded-[8px] px-2.5 text-xs font-medium transition-colors',
            value === key ? 'bg-panel-solid text-ink shadow-[0_1px_3px_rgb(0_0_0/0.18)]' : 'text-muted hover:text-ink',
          )}
        >
          <Icon aria-hidden className="size-3.5" />
          {text}
        </button>
      ))}
    </div>
  );
}
