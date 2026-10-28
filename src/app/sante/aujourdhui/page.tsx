import Link from "next/link";
import { buttonClass, Icon } from "@/components/ui";
import { TodayLog } from "@/components/sante/TodayLog";
import { db } from "@/lib/db/client";
import { recipes } from "@/lib/db/schema";
import { activePerson } from "@/lib/health/active";
import { isComplete, listEntries, listTemplates, pending, plannedMeals, recentExtras, totals } from "@/lib/health/log";
import { currentReview, todayParis } from "@/lib/health/store";
import { recipeColor } from "@/lib/ui";
import { addDays } from "@/lib/week/propose";

export const dynamic = "force-dynamic";

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

export default async function Aujourdhui({ searchParams }: { searchParams: Promise<{ jour?: string }> }) {
  const person = await activePerson();
  const today = todayParis();
  const { jour } = await searchParams;
  const date = isDate(jour) && jour <= today ? jour : today;
  const entries = listEntries(db, person.id, date);
  const todo = pending(plannedMeals(db, person.id, date), listTemplates(db, person.id), entries, date);
  const review = currentReview(db, person);
  const lib = db.select({ id: recipes.id, slug: recipes.slug, name: recipes.name, kcalUnit: recipes.kcalUnit, proteinUnit: recipes.proteinUnit, status: recipes.status }).from(recipes).all();
  const colors = Object.fromEntries(lib.map((r) => [r.slug, recipeColor(r.slug)]));
  const slugById = new Map(lib.map((r) => [r.id, r.slug]));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex items-center gap-2">
        <Link href={`/sante/aujourdhui?jour=${addDays(date, -1)}`} className={buttonClass({ variant: "quiet", size: "sm", iconOnly: true })} aria-label="Jour précédent">
          <Icon name="chev" className="rotate-180" />
        </Link>
        <h2 className="text-[18px] font-bold first-letter:uppercase">{date === today ? "Aujourd'hui" : fmt(date)}</h2>
        {date < today && (
          <Link href={`/sante/aujourdhui?jour=${addDays(date, 1)}`} className={buttonClass({ variant: "quiet", size: "sm", iconOnly: true })} aria-label="Jour suivant">
            <Icon name="chev" />
          </Link>
        )}
        {date !== today && (
          <Link href="/sante/aujourdhui" className="ml-auto text-[14px] font-semibold text-accent">
            Revenir à aujourd'hui
          </Link>
        )}
      </div>
      <TodayLog
        key={`${person.id}-${date}`}
        personId={person.id}
        personName={person.name}
        date={date}
        portionUnits={person.portionUnits}
        target={review ? { kcal: review.targets.kcal, proteinG: review.targets.proteinG } : null}
        totals={totals(entries)}
        planned={todo.planned.map((m) => ({ ...m, color: colors[m.slug] }))}
        habits={todo.templates.map((t) => ({ id: t.id, label: t.label, meal: t.meal, kcal: t.kcal, proteinG: t.proteinG, suggested: t.suggested }))}
        entries={entries.map((e) => ({ id: e.id, meal: e.meal, kind: e.kind, label: e.label, units: e.units, kcal: e.kcal, proteinG: e.proteinG, source: e.source, slug: e.recipeId ? (slugById.get(e.recipeId) ?? null) : null }))}
        recents={recentExtras(db, person.id).map((e) => ({ label: e.label, meal: e.meal, kcal: e.kcal, proteinG: e.proteinG, fatG: e.fatG, carbsG: e.carbsG, ai: e.source === "ai" }))}
        library={lib.filter((r) => r.status !== "archived").map((r) => ({ id: r.id, slug: r.slug, name: r.name, kcalUnit: r.kcalUnit, proteinUnit: r.proteinUnit, color: colors[r.slug] }))}
        complete={isComplete(db, person.id, date)}
        colors={colors}
      />
    </div>
  );
}
