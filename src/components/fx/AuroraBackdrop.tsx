import { cn } from '@/lib/cn';

/**
 * Aurora iza sadržaja: 2–3 velika radijalna gradijenta u boji izmaglice (`--haze`) i
 * akcenta, sporo plutaju (samo transform, 66–92 s petlja). Fiksirana, ne hvata pokazivač,
 * dekorativna (aria-hidden). U tamnoj temi dodaje tihe zvezde. Boju i jačinu nasleđuje
 * od najbližeg `haze-scope` elementa; uz smanjeno kretanje stoji (globalni CSS blok).
 */
export function AuroraBackdrop({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('aurora', className)}>
      <div className="aurora__stars" />
      <div className="aurora__blob aurora__blob--a" />
      <div className="aurora__blob aurora__blob--b" />
      <div className="aurora__blob aurora__blob--c" />
    </div>
  );
}
