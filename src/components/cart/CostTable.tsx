// Coût par part et par recette (placard et coûts) : un tableau à filets, chiffres tabulaires alignés à droite.
// Part de base, ce qui est réellement consommé, en paquets entiers, et ce qui est jeté. Une ligne = un lien vers
// la fiche ; la couleur du plat en filet à gauche (son identité, pas un état).
import Link from "next/link";
import { Icon } from "@/components/ui";
import type { RecipeCost } from "@/lib/costs";
import { recipeColor } from "@/lib/ui";
import { eur } from "./format";

/** `compact` : la recette et ce que coûte la part payée, seulement (colonne étroite du placard). */
export function CostTable({ costs, compact = false }: { costs: RecipeCost[]; compact?: boolean }) {
  return (
    <div className="k-noscroll overflow-x-auto">
      <table className={`w-full border-collapse ${compact ? "" : "min-w-[480px]"}`}>
        <thead>
          <tr className="border-b border-line text-left">
            <th className="label pb-3 font-[650] text-ink-2">Recette, par part</th>
            {!compact && <th className="label pb-3 pl-4 text-right font-[650] text-ink-2">Consommé</th>}
            <th className="label pb-3 pl-4 text-right font-[650] text-ink-2">Payé</th>
            {!compact && <th className="label pb-3 pl-4 text-right font-[650] text-ink-2">Jeté</th>}
          </tr>
        </thead>
        <tbody>
          {costs.map((c) => {
            const wastePct = c.batch && c.batch.practical > 0 ? Math.round(((c.waste ?? 0) / c.batch.practical) * 100) : 0;
            return (
              <tr key={c.recipeId} className="group border-b border-line align-baseline">
                <td className="py-4 pl-4" style={{ boxShadow: `inset 3px 0 0 ${recipeColor(c.slug)}` }}>
                  <Link href={`/recettes/${c.slug}#cout`} className="grid min-w-0 gap-1">
                    <span className="font-semibold leading-snug underline decoration-transparent underline-offset-4 group-hover:decoration-line-strong">{c.name}</span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-2">
                      <span className="text-ink-3">{c.kind === "real" ? `réel, cuisiné ${c.cooks === 1 ? "1 fois" : `${c.cooks} fois`}` : "estimé"}</span>
                      {c.parts.slice(1).map((p) => (
                        <span key={p.personId}>
                          {p.name} <span className="num">{eur(p.cost.practical)}</span>
                        </span>
                      ))}
                      {c.coverage < 1 && (
                        <span className="inline-flex items-center gap-1 font-semibold text-warn-ink">
                          <Icon name="alert" size="s" strokeWidth={2.4} />
                          <span className="num">{Math.round(c.coverage * 100)}&nbsp;%</span> des prix connus
                        </span>
                      )}
                    </span>
                  </Link>
                </td>
                {!compact && <td className="num whitespace-nowrap py-4 pl-4 text-right text-ink-2">{eur(c.partLead?.theoretical)}</td>}
                <td className="num whitespace-nowrap py-4 pl-4 text-right text-body font-semibold">{eur(c.partLead?.practical)}</td>
                {!compact && (
                  <td className={`num whitespace-nowrap py-4 pl-4 text-right ${wastePct > 0 ? "" : "text-ink-3"}`}>
                    {eur(c.waste)}
                    {wastePct > 0 && <span className="block text-small text-ink-3">{wastePct}&nbsp;% de la fournée</span>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
