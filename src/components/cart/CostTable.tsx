// Coût par part et par recette (DA « Plan de travail », tableau du placard et des coûts) : part de base,
// ce qui est réellement consommé, en paquets entiers, et ce qui est jeté. Une ligne = un lien vers la fiche.
import Link from "next/link";
import { Pill, RecipeTile } from "@/components/ui";
import type { RecipeCost } from "@/lib/costs";
import { recipeColor } from "@/lib/ui";
import { eur } from "./format";

export function CostTable({ costs }: { costs: RecipeCost[] }) {
  return (
    <div className="k-noscroll overflow-x-auto rounded-[14px] border border-line bg-surface">
      <table className="w-full min-w-[480px] border-collapse text-[14px] tabular-nums">
        <thead>
          <tr className="border-b border-line text-left text-[12px] font-bold uppercase tracking-[0.08em] text-faint">
            <th className="px-3.5 py-2.5 font-bold">Recette · par part</th>
            <th className="px-2 py-2.5 text-right font-bold">Consommé</th>
            <th className="px-2 py-2.5 text-right font-bold">Payé</th>
            <th className="px-3.5 py-2.5 text-right font-bold">Jeté</th>
          </tr>
        </thead>
        <tbody>
          {costs.map((c) => {
            const wastePct = c.batch && c.batch.practical > 0 ? Math.round(((c.waste ?? 0) / c.batch.practical) * 100) : 0;
            return (
              <tr key={c.recipeId} className="border-b border-line last:border-b-0 hover:bg-surface-2">
                <td className="px-3.5 py-2.5">
                  <Link href={`/recettes/${c.slug}#cout`} className="flex min-w-0 items-center gap-2.5 font-semibold">
                    <RecipeTile color={recipeColor(c.slug)} name={c.name} size="sm" />
                    <span className="grid min-w-0">
                      <span className="leading-tight">{c.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 whitespace-nowrap text-[12px] font-normal text-ink-2">
                        {c.kind === "real" ? (
                          <Pill tone="ok" className="!h-5 !text-[12px]">
                            réel · {c.cooks}
                          </Pill>
                        ) : (
                          <Pill tone="idle" icon="clock" className="!h-5 !text-[12px]">
                            estimé
                          </Pill>
                        )}
                        {c.parts.slice(1).map((p) => (
                          <span key={p.personId}>
                            {p.name} {eur(p.cost.practical)}
                          </span>
                        ))}
                        {c.coverage < 1 && <span className="text-warn-ink">{Math.round(c.coverage * 100)} % des prix connus</span>}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="num whitespace-nowrap px-2 py-2.5 text-right font-display">{eur(c.partLead?.theoretical)}</td>
                <td className="num whitespace-nowrap px-2 py-2.5 text-right font-display text-[16px] font-bold">{eur(c.partLead?.practical)}</td>
                <td className={`num whitespace-nowrap px-3.5 py-2.5 text-right font-display ${wastePct > 0 ? "text-ko" : "text-faint"}`}>
                  {eur(c.waste)}
                  {wastePct > 0 && <span className="block text-[12px] font-normal">{wastePct} %</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
