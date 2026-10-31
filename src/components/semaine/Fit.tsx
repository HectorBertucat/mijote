// Objectifs → recettes, sur la Semaine (src/lib/week/fit.ts) : une pastille d’un mot sur chaque plat,
// un avertissement seulement quand une sélection s’écarte du repère de quelqu’un (avec de quoi y
// remédier), une ligne quand tout va bien, et les chiffres repliés. Sans état.
import type { ReactNode } from "react";
import { Icon } from "@/components/ui";
import type { FitBadge, FitWarning, WeekFit } from "@/lib/week/fit";
import { HowTo, Notice } from "./Parts";

/** La pastille d’un plat : une icône et quelques mots, sous ses faits (« Calé pour Alex et Sam »). */
export function FitMark({ badge }: { badge: FitBadge | null }) {
  if (!badge) return null;
  const ok = badge.tone === "ok";
  return (
    <span className={`mt-1 flex items-center gap-1 ${ok ? "text-ink-2" : "text-warn-ink"}`}>
      <Icon name={ok ? "check" : "alert"} size="s" className={`shrink-0 ${ok ? "text-ok" : "text-warn"}`} />
      {badge.text}
    </span>
  );
}

/** Les écarts d’une sélection, à poser dans la liste « À regarder » : une phrase, une suggestion, un bouton. */
export function FitWarnings({ warnings, add }: { warnings: FitWarning[]; add?: (slug: string, name: string) => ReactNode }) {
  return warnings.map((w) => (
    <Notice key={w.personId} icon="scale" action={w.suggestion.recipe && add ? add(w.suggestion.recipe.slug, w.suggestion.recipe.name) : undefined}>
      <b>
        {w.issue === "proteines" ? "Protéines justes" : w.issue === "trop-riche" ? "Repas riches" : "Repas légers"} pour {w.name}
      </b>
      &nbsp;: {w.text}. {w.suggestion.text}
    </Notice>
  ));
}

const fr = (n: number) => Math.round(n).toLocaleString("fr-FR");

/** Une ligne quand tout va bien, et le détail par personne replié. */
export function FitNote({ fit, summary, loin }: { fit: WeekFit; summary: string | null; loin: string[] }) {
  const people = fit.people.filter((p) => p.perMeal && p.ref);
  if (!people.length) return null;
  return (
    <div className="grid gap-1 text-small text-ink-2">
      {summary && (
        <p className="flex items-start gap-3">
          <Icon name="check" size="s" className="mt-[3px] shrink-0 text-ok" />
          <span>{summary}</span>
        </p>
      )}
      <HowTo label="Objectifs : le détail">
        {people.map((p) => (
          <p key={p.personId}>
            <b className="text-ink">{p.name}</b>&nbsp;: un repas moyen fait <span className="num">{fr(p.perMeal!.kcal)}&nbsp;kcal et {p.perMeal!.protein}&nbsp;g</span> de protéines, pour{" "}
            <span className="num">
              {fr(p.ref!.kcalMin)}–{fr(p.ref!.kcalMax)}&nbsp;kcal et {p.ref!.proteinMin}–{p.ref!.proteinMax}&nbsp;g
            </span>
            .
            {p.perDay && p.dayTarget && (
              <>
                {" "}
                Avec ce qui est mangé à côté, un jour fait <span className="num">{fr(p.perDay.kcal)}&nbsp;kcal et {p.perDay.protein}&nbsp;g</span> (cible{" "}
                <span className="num">
                  {fr(p.dayTarget.kcal)}&nbsp;kcal, {p.dayTarget.proteinG}&nbsp;g
                </span>
                ).
              </>
            )}
            {p.stuck && " Une plus grande part ne suffirait pas : elle dépasserait les kcal avant d’atteindre les protéines."}
          </p>
        ))}
        {loin.length > 0 && <p>Plats loin du repère&nbsp;: {loin.join(" ; ")}.</p>}
        <p>La part de chacun suit ses kcal&nbsp;; les protéines dépendent du plat. Le repère d’un repas déduit déjà les habitudes (shaker, petit-déjeuner).</p>
      </HowTo>
    </div>
  );
}
