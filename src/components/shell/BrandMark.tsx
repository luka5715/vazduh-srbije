import { cn } from '@/lib/cn';

/**
 * Znak aplikacije: tri linije vetra na pločici u boji akcenta, sa spoljnim sjajem u boji
 * izmaglice. Dekorativan (naziv aplikacije stoji pored kao tekst).
 */
export function BrandMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-[10px] bg-accent text-accent-ink', className)}
      style={{
        width: size,
        height: size,
        boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.3), 0 0 0 1px var(--haze-soft), 0 8px 24px -8px var(--haze-glow)',
      }}
    >
      <svg viewBox="0 0 24 24" style={{ width: size * 0.56, height: size * 0.56 }} fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round">
        <path d="M4 8h9a2.5 2.5 0 1 0-2.5-2.5" />
        <path d="M4 12.5h13a2.5 2.5 0 1 1-2.5 2.5" />
        <path d="M4 17h7a2 2 0 1 1-2 2" />
      </svg>
    </span>
  );
}
