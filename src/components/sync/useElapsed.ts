import { useEffect, useState } from 'react';

/** Proteklo vreme od `since` u ms, osvežava se svake sekunde dok je `since` postavljen. */
export function useElapsed(since: Date | null): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since ? Math.max(0, nowMs - since.getTime()) : 0;
}

/** `0:42`, `2:05` – proteklo vreme posla (mono cifre). */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
