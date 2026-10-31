// Mot-symbole « mijote » : le « o » est une cocotte (corps cocotte, couvercle tomate) d’où monte un filet de vapeur.
// Archivo large 125, graisse 800. Sans état ; la vapeur ne bouge qu’au survol du lien parent (classe group), et monte
// à l’écran de lancement (classe k-wm-steam, src/components/tour/tour.css).

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline font-display text-[22px] leading-none font-extrabold tracking-[-0.045em] text-ink [font-stretch:125%] ${className}`} aria-label="mijote">
      <span aria-hidden>mij</span>
      <svg aria-hidden viewBox="0 0 24 24" className="mx-[0.02em] h-[0.9em] w-[0.9em] translate-y-[0.06em] overflow-visible">
        <path
          className="k-wm-steam origin-bottom transition-[opacity,transform] duration-[var(--dur-2)] ease-[var(--ease-out)] group-hover:-translate-y-0.5 group-hover:opacity-100 motion-reduce:transition-none"
          d="M12 1.5c-1.4 1.3 1.4 2.3 0 3.6"
          fill="none"
          stroke="var(--c-ink-3)"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.55"
        />
        <rect x="4.5" y="6.6" width="15" height="2.6" rx="1.3" fill="var(--c-hot)" />
        <rect x="10.4" y="5" width="3.2" height="2" rx="0.8" fill="var(--c-hot)" />
        <path d="M3.2 10.4h17.6v5.6a6 6 0 0 1-6 6H9.2a6 6 0 0 1-6-6z" fill="var(--c-accent)" />
        <path d="M1 12.2h2.2M20.8 12.2H23" stroke="var(--c-accent)" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <span aria-hidden>te</span>
    </span>
  );
}
