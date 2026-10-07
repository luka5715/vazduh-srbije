import { AppShell } from '@/components/shell/AppShell';
import { AtmosferaProvider } from '@/hooks/useAtmosfera';

/**
 * Glavna strana (ruta „/“): globalno stanje „Atmosfere“ + ljuska sa stranicama iz `?view=`.
 * Orkestracija podataka i sinhronizacije živi u `AtmosferaProvider` (hooks/useAtmosfera.tsx).
 */
export function DashboardPage() {
  return (
    <AtmosferaProvider>
      <AppShell />
    </AtmosferaProvider>
  );
}
