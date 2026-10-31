// Bloc coût d’une fiche recette (DA « Carnet de marché ») : la part de chacun en gros chiffre (paquets entiers),
// d’où vient le prix, le gaspillage s’il y en a ; la fournée et ce qui est consommé passent sous « Comment c’est
// calculé ». « J’ai cuisiné » est en tête de fiche (CookAction). Sans état.
import Link from "next/link";
import type { PlannedUsage, RecipeCost as Cost } from "@/lib/costs";
import { HowCalculated } from "./fiche/Block";

const NB = " ";
const eur = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2).replace(".", ",")}${NB}€`);
const num = (v: number) => v.toFixed(2).replace(".", ",");

/** Un prix connu : au moins une ligne de la recette a un prix. */
export const hasPrice = (cost: Cost | null) => Boolean(cost && cost.kind !== "none" && cost.coverage > 0 && cost.parts.length);

/** D’où vient le chiffre, en quelques mots. */
export function costSource(cost: Cost) {
  return cost.kind === "real" ? `Réel, sur ${cost.cooks} cuisson${cost.cooks > 1 ? "s" : ""}` : cost.kind === "estimate" ? "Estimé sur la dernière liste" : "Pas encore de liste";
}

export function RecipeCostPanel({ cost, plan }: { cost: Cost; plan?: PlannedUsage[]; recipeId?: string; slug?: string }) {
  const fromLots = (plan ?? []).filter((p) => p.source === "lot").length;
  if (!hasPrice(cost))
    return (
      <p className="text-body text-ink-2">
        {cost.kind === "none" ? "Pas encore de prix : fais une liste de courses avec ce plat " : "La dernière liste n’a pas de prix pour ce plat. Une liste avec le catalogue branché "}(
        <Link href="/composer" className="font-semibold text-accent underline-offset-4 hover:underline">
          Composer
        </Link>
        ) et son coût s’affiche ici.
      </p>
    );
  return (
    <div className="grid gap-6">
      <dl className="flex flex-wrap border-y border-line">
        {cost.parts.map((p, i) => (
          <div key={p.personId} className="grid min-w-32 flex-1 content-start gap-2 border-l border-line py-4 pl-6 first:border-l-0 first:pl-0">
            <dt className="label order-2 text-ink-2">
              {p.name} · {p.units}
              {NB}u
            </dt>
            <dd className={`order-1 flex items-baseline ${i === 0 ? "" : "text-ink-2"}`}>
              <span className="num-tight text-h1">{num(p.cost.practical)}</span>
              <span className="ml-1 font-display text-h3 font-[650] text-ink-2 [font-stretch:75%]">€</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-small text-ink-2">
        {costSource(cost)}.
        {cost.waste != null && cost.waste > 0.005 && <span className="font-semibold text-ko-ink"> {eur(cost.waste)} de paquets entamés par fournée.</span>}
      </p>
      {cost.batch && (
        <HowCalculated>
          <p className="num">
            Fournée de {cost.servingsUnits} unités : {eur(cost.batch.practical)} en paquets entiers, {eur(cost.batch.theoretical)} réellement consommés. La part de chacun suit ses unités ; le prix en gros est celui des paquets entiers.
            {fromLots > 0 && ` ${fromLots} lot${fromLots > 1 ? "s" : ""} au placard servira la prochaine fois.`}
          </p>
          {cost.coverage < 1 && <p>{Math.round(cost.coverage * 100)}{NB}% des lignes ont un prix : le chiffre est un plancher.</p>}
        </HowCalculated>
      )}
    </div>
  );
}
