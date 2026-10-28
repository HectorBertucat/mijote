// Bloc coût d'une fiche recette (DA « Plan de travail ») : part de chacun en gros chiffre (paquets entiers),
// ce qui est réellement consommé, la fournée et le gaspillage. « J'ai cuisiné » est en tête de fiche (CookAction).
import Link from "next/link";
import { Card, Macro, MacroRow, Pill } from "@/components/ui";
import type { PlannedUsage, RecipeCost as Cost } from "@/lib/costs";
import { CardTitle } from "./RecipeParts";

const eur = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2).replace(".", ",")} €`);
const num = (v: number) => v.toFixed(2).replace(".", ",");

export function RecipeCostPanel({ cost, plan }: { cost: Cost; plan?: PlannedUsage[]; recipeId?: string; slug?: string }) {
  const fromLots = (plan ?? []).filter((p) => p.source === "lot").length;
  return (
    <Card as="section" pad="md" className="grid gap-3">
      <CardTitle
        aside={
          cost.kind === "real" ? (
            <Pill tone="ok">
              réel · {cost.cooks} cuisson{cost.cooks > 1 ? "s" : ""}
            </Pill>
          ) : cost.kind === "estimate" ? (
            <Pill tone="idle" icon="clock">
              estimé, dernière liste
            </Pill>
          ) : (
            <Pill tone="idle" icon="dash">
              pas encore de liste
            </Pill>
          )
        }
      >
        Coût par part
      </CardTitle>
      {cost.parts.length ? (
        <MacroRow>
          {cost.parts.map((p, i) => (
            <Macro
              key={p.personId}
              value={i === 0 ? num(p.cost.practical) : <span className="text-ink-2">{num(p.cost.practical)}</span>}
              unit="€"
              sub={`${p.name} · ${p.units} u · ${num(p.cost.theoretical)} consommé`}
            />
          ))}
        </MacroRow>
      ) : (
        <p className="text-[15px] text-ink-2">
          Fais une liste de courses avec cette recette (
          <Link href="/composer" className="font-semibold text-accent underline-offset-2 hover:underline">
            Composer
          </Link>
          ) pour voir son coût.
        </p>
      )}
      {cost.batch && (
        <p className="text-[13px] leading-snug text-ink-2 tabular-nums">
          Fournée de {cost.servingsUnits} unités : {eur(cost.batch.practical)} en paquets entiers, {eur(cost.batch.theoretical)} réellement consommés
          {cost.waste != null && cost.waste > 0.005 && <span className="font-semibold text-ko-ink"> · gaspillage {eur(cost.waste)}</span>}.
          {fromLots > 0 && ` ${fromLots} lot${fromLots > 1 ? "s" : ""} au placard pour la prochaine fois.`}
        </p>
      )}
    </Card>
  );
}
