// L'historique des sorties : une ligne par course (jour, type prévu, durée, distance, allure), sa répartition par
// zone en une barre fine, l'effort noté ; chaque ligne mène au détail de la sortie. Rendu serveur.
import Link from "next/link";
import { Icon } from "@/components/ui";
import { fmtDay, NB, VIZ_ZONE } from "@/components/ui/charts/core";
import type { RunItem } from "@/lib/running/page";
import { durText, kmText, paceText, runTitle } from "@/lib/running/view";

/** Le temps de course par zone en une barre (sous les zones et Z1 réunis au plus clair). */
export function ZoneBar({ sec, className = "" }: { sec: number[]; className?: string }) {
  const parts = [sec[0] + sec[1], sec[2], sec[3], sec[4], sec[5]];
  const total = parts.reduce((s, x) => s + x, 0);
  if (!total) return <span aria-hidden className={`block h-1.5 rounded-full bg-surface-2 ${className}`} />;
  return (
    <span aria-hidden className={`flex h-1.5 gap-[2px] overflow-hidden rounded-full ${className}`}>
      {parts.map((x, i) => (x > 0 ? <span key={i} className="block h-full" style={{ flexGrow: x / total, background: VIZ_ZONE[i] }} /> : null))}
    </span>
  );
}

export function RunList({ runs }: { runs: RunItem[] }) {
  return (
    <ul className="grid border-t border-line">
      {runs.map((r) => {
        const facts = [durText(r.movingMin * 60), r.km ? kmText(r.km) : null, r.pace ? `${paceText(r.pace)}/km` : null].filter(Boolean).join(" · ");
        const easy = r.easyShare != null ? `${Math.round(r.easyShare * 100)}${NB}% en facile` : "sans cardio";
        return (
          <li key={r.sampleId} className="border-b border-line">
            <Link href={`/sante/course/${r.sampleId}`} className="group -mx-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-[8px] px-3 py-3 hover:bg-surface-2 sm:grid-cols-[8rem_minmax(0,1fr)_10rem_auto]">
              <span className="text-small text-ink-2 sm:order-none">{fmtDay(r.date, "weekday")}</span>
              <Icon name="chev" size="s" className="row-span-3 self-center text-ink-3 sm:order-last sm:row-span-1" />
              <span className="grid min-w-0 gap-0.5">
                <b className="truncate font-bold text-ink">{runTitle(r.kind)}</b>
                <span className="num text-small text-ink-2">{facts}</span>
              </span>
              <span className="grid gap-1.5">
                <ZoneBar sec={r.zoneSec} />
                <span className="text-[12px] leading-none text-ink-2">
                  {easy}
                  {r.effort != null ? ` · effort ${r.effort}` : ""}
                  {r.pain ? ` · douleur ${r.pain}` : ""}
                  {r.heat ? " · chaleur" : ""}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
