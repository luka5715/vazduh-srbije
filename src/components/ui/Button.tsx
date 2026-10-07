import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-ink shadow-[0_8px_24px_-12px_var(--accent),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-110 active:brightness-95 disabled:opacity-50 disabled:shadow-none',
  secondary:
    'bg-panel text-ink border border-border-strong shadow-[var(--shadow-inset)] hover:bg-card-2 hover:border-[color-mix(in_oklab,var(--haze)_40%,var(--border-strong))] active:bg-card-2 disabled:opacity-50 disabled:hover:bg-panel',
  ghost: 'bg-transparent text-ink hover:bg-card-2 active:bg-card-2 disabled:opacity-50 disabled:hover:bg-transparent',
  danger: 'bg-danger text-danger-ink hover:brightness-110 disabled:opacity-50',
};

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-[13px] gap-1.5 [&_svg]:size-3.5',
  md: 'h-9 px-3.5 text-sm gap-2 [&_svg]:size-4',
  lg: 'h-11 px-5 text-[15px] gap-2 [&_svg]:size-[18px]',
};

export function Button({ variant = 'secondary', size = 'md', loading = false, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-ctl font-medium whitespace-nowrap transition-[background-color,border-color,filter,opacity,box-shadow] duration-150 select-none',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {loading ? <LoaderCircle aria-hidden className="spin" /> : icon}
      {children}
    </button>
  );
}
