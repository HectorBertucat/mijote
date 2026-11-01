// Les trois gros chiffres de la bande de tête d’une fiche : temps actif, kcal de la part du profil, prix de la
// part. Chiffres Archivo serrés, filets verticaux entre eux, le repère en étiquette dessous. Sans état.
import type { ReactNode } from "react";

export type Figure = { key: string; value: ReactNode; unit?: ReactNode; label: ReactNode; sub?: ReactNode };

/** « 77 » → 1 h 17, « 45 » → 45 min : les lettres en petit, les chiffres en grand. */
export function BigDuration({ min }: { min: number }) {
  const u = "text-h3 font-[650] [font-stretch:75%] text-ink-2";
  if (min < 60)
    return (
      <>
        {Math.round(min)}
        <span className={`${u} ml-1`}>min</span>
      </>
    );
  const m = Math.round(min % 60);
  return (
    <>
      {Math.floor(min / 60)}
      <span className={`${u} mx-1`}>h</span>
      {m ? String(m).padStart(2, "0") : null}
    </>
  );
}

export function Figures({ items }: { items: Figure[] }) {
  return (
    <dl className="grid grid-cols-3 border-y border-line">
      {items.map((f, i) => (
        <div key={f.key} className={`grid min-w-0 content-start gap-2 py-4 sm:py-6 ${i > 0 ? "border-l border-line pl-3 sm:pl-6" : "pr-3 sm:pr-6"}`}>
          <dt className="label order-2 text-ink-2">{f.label}</dt>
          {/* L’unité passe sous le chiffre plutôt que de déborder sur la colonne voisine (« 1091 kcal » au téléphone). */}
          <dd className="order-1 flex flex-wrap items-baseline gap-x-1">
            <span className="num-tight whitespace-nowrap text-h1 sm:text-num-xl">{f.value}</span>
            {f.unit && <span className="font-display text-h3 font-[650] text-ink-2 [font-stretch:75%]">{f.unit}</span>}
          </dd>
          {f.sub && <dd className="order-3 text-small text-ink-2">{f.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}
