import { GitCommitVertical, Table2 } from 'lucide-react';

import { cn } from '@/lib/cn';

export type RunLogView = 'timeline' | 'table';

/** Prekidač vremenska linija / tabela (isti izgled kao ViewToggle grafikona). */
export function RunLogToggle({ value, onChange }: { value: RunLogView; onChange: (view: RunLogView) => void }) {
  const options = [
    { key: 'timeline' as const, text: 'Linija', icon: GitCommitVertical },
    { key: 'table' as const, text: 'Tabela', icon: Table2 },
  ];
  return (
    <div role="group" aria-label="Prikaz dnevnika" className="inline-flex h-8 rounded-ctl border border-border bg-card-2 p-0.5 shadow-[var(--shadow-inset)]">
      {options.map(({ key, text, icon: Icon }) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[8px] px-2.5 text-xs font-medium transition-colors',
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
