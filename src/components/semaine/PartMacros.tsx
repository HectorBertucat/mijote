// La part de chacun d'une recette, en gros chiffres colorés selon son repère : cartes de la
// Semaine et du Composer. Avec les mangeurs (src/lib/eaters), la part suit la cible de chacun
// (unités au demi près) ; sans, une part de base, sans repère.
import { Macro, MacroRow } from "@/components/ui";
import { DEFAULT_PORTION_UNITS } from "@/lib/nutrition/compute";
import { portionOf, unitsLabel, type Eater } from "@/lib/eaters/core";

const TEXT = { ok: "text-ok", low: "text-warn", high: "text-ko" } as const;

export function PartMacros({
  kcalUnit,
  proteinUnit,
  eaters,
  size = "md",
  className = "",
}: {
  kcalUnit: number | null;
  proteinUnit: number | null;
  eaters?: Pick<Eater, "id" | "name" | "baseUnits" | "ref">[];
  size?: "md" | "sm";
  className?: string;
}) {
  if (kcalUnit == null) return <p className={`text-small text-ink-3 ${className}`}>nutrition inconnue</p>;
  if (eaters?.length) {
    const parts = eaters.map((e) => ({ e, p: portionOf(e, { kcalUnit, proteinUnit }) }));
    return (
      <div className={`grid gap-1 text-small tabular-nums ${className}`} aria-label="Part de chacun">
        {parts.map(({ e, p }) => (
          <span key={e.id} className="flex flex-wrap items-baseline gap-x-2">
            <b className="min-w-18 font-semibold text-ink">
              {e.name} <span className="font-normal text-ink-2">{unitsLabel(p.units)}</span>
            </b>
            <b className={`font-display ${size === "sm" ? "text-body" : "text-h3"} num-tight ${p.verdict ? TEXT[p.verdict.kcal] : "text-ink"}`}>{p.kcal}&nbsp;kcal</b>
            <b className={`font-display ${size === "sm" ? "text-body" : "text-h3"} num-tight ${p.verdict ? TEXT[p.verdict.protein] : "text-ink"}`}>{p.protein}&nbsp;g</b>
            {!e.ref && <span className="text-ink-3">sans repère</span>}
            {p.verdict?.protein === "low" && <span className="text-warn">peu de protéines pour {e.name}</span>}
            {p.capped && <span className="text-ink-2">part bornée</span>}
          </span>
        ))}
      </div>
    );
  }
  const kcal = kcalUnit * DEFAULT_PORTION_UNITS;
  const prot = (proteinUnit ?? 0) * DEFAULT_PORTION_UNITS;
  if (size === "sm")
    return (
      <span className={`inline-flex items-baseline gap-2 text-small tabular-nums ${className}`}>
        <b className="num-tight text-body text-ink">{Math.round(kcal)}&nbsp;kcal</b>
        <b className="num-tight text-body text-ink">{Math.round(prot)}&nbsp;g</b>
        <span className="text-ink-2">une part</span>
      </span>
    );
  return (
    <MacroRow className={className}>
      <Macro value={Math.round(kcal)} unit="kcal" sub="une part" />
      <Macro value={Math.round(prot)} unit="g" sub="protéines" />
    </MacroRow>
  );
}
