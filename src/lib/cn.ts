import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Spaja Tailwind klase uz razrešavanje sukoba (clsx + tailwind-merge). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
