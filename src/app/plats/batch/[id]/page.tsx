// Le bilan d’un batch (src/lib/reserve/batch.ts) : ce que la session a cuit, plat par plat, ses groupes
// (le plat, le riz, les légumes) et les portions de chacun. Sans pesée, tout est déjà en réserve, estimé
// d’après le cru (les grammes de la session) et marqué « estimé » ; on pèse ici plus tard, même après un
// repas (la pesée de ce qui reste). On y arrive par la fin de session, l’accueil, la Semaine et Nos plats.
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Icon, Pill } from "@/components/ui";
import { DishBox } from "@/components/ui/dish";
import { BoxGlyph } from "@/components/boxes/BoxGlyph";
import { Figures } from "@/components/semaine/Parts";
import { plural } from "@/components/semaine/format";
import { SessionBoxes } from "@/components/session/SessionBoxes";
import { db } from "@/lib/db/client";
import { cookSessions } from "@/lib/db/schema";
import { gramsLabel } from "@/lib/boxes/core";
import { listDishRecipes } from "@/lib/recipes/queries";
import { BaseList, FreezeList } from "@/components/plats/Bases";
import { freezeList, listBases } from "@/lib/reserve/bases-store";
import { batchView, listDishes, sessionReserves, type BatchDish } from "@/lib/reserve/store";
import { todayParis } from "@/lib/health/store";
import type { SessionPlan } from "@/lib/session/planner";
import { recipeColor } from "@/lib/ui";
import { joinFr } from "@/lib/week/tastes";
import { firstOfMonth } from "@/lib/typo";

export const dynamic = "force-dynamic";

const longDay = (ymd: string) => firstOfMonth(new Date(`${ymd}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }));

export default async function Bilan({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = db.select().from(cookSessions).where(eq(cookSessions.id, id)).get();
  if (!s?.planJson || s.test) notFound();
  const plan = s.planJson as SessionPlan;
  const now = new Date();
  const data = sessionReserves(db, id, now);
  const batch = batchView(db, id, now);
  if (!data) notFound();
  // Les pesées : les plats en réserve de ce batch ; sans aucun (la session n’a rien cuit), toutes ses marmites.
  const owned = batch ? data.models.filter((m) => data.saved[m.recipeId]) : data.models;
  const recipes = listDishRecipes(db);
  const arts = Object.fromEntries(data.models.map((m) => [m.slug, recipes.get(m.recipeId) ? <DishBox key={m.slug} recipe={recipes.get(m.recipeId)!} size="sm" /> : <BoxGlyph key={m.slug} color={recipeColor(m.slug)} size={56} />]));
  const sum = batch?.summary;
  const names = [...new Set(batch?.dishes.flatMap((d) => d.people.filter((p) => p.total > 0).map((p) => p.name)) ?? [])];
  const open = batch?.dishes.some((d) => d.open) ?? false;
  // Les bases cuites par ce batch (le riz de tous ses plats) et ce qui est à congeler.
  const today = todayParis(now);
  const all = batch ? listDishes(db, null, now) : [];
  const ids = new Set(batch?.dishes.map((d) => d.reserveId));
  const bases = batch ? listBases(db, all, now).filter((b) => b.containers.some((c) => c.sessionId === id) || b.dishes.some((d) => ids.has(d.dishId))) : [];
  const freeze = batch ? freezeList(db, all, now).filter((f) => ids.has(f.dishId)) : [];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 md:gap-18 lg:grid-cols-12 lg:gap-x-6">
      <AutoRefresh />
      <header className="grid gap-6 lg:col-span-8">
        <Link href="/plats" className="inline-flex min-h-tap w-fit items-center gap-1 rounded-[8px] font-semibold text-ink-2 hover:text-ink">
          <Icon name="chev" size="s" className="rotate-180" />
          Nos plats
        </Link>
        <p className="label text-ink-2">Cuisiné {longDay(batch?.cookedOn ?? (s.endedAt ?? s.startedAt ?? now.toISOString()).slice(0, 10))}</p>
        <h1 className="text-h1">{batch?.title ?? "Le batch"}</h1>
        <p className="num max-w-[52ch] text-lead text-ink-2">
          {!batch || !sum
            ? "Rien en réserve pour cette session. Pèse les marmites ci-dessous : je dis combien de portions pour chacun."
            : `${plural(sum.dishes, "plat")}, ${plural(sum.portions, "portion")}${names.length ? ` pour ${joinFr(names)}` : ""}. ${
                sum.toWeigh > 0
                  ? `${sum.toWeigh === 1 ? "Un plat n’est pas encore pesé : ses portions sont estimées" : `${sum.toWeigh} plats ne sont pas encore pesés : leurs portions sont estimées`} d’après le cru. Chacun peut déjà manger ; pèse quand tu peux.`
                  : open
                    ? "Tout est pesé."
                    : "Tout est mangé."
              }`}
        </p>
      </header>

      {batch && sum && (
        <section aria-labelledby="cuit-titre" className="grid content-start gap-6 lg:col-span-8">
          <Figures
            items={[
              { value: sum.dishes, label: sum.dishes > 1 ? "plats cuits" : "plat cuit" },
              { value: sum.left, label: sum.left > 1 ? "portions restantes" : "portion restante" },
              { value: sum.toWeigh, label: "à peser" },
            ]}
          />
          <FreezeList dishes={freeze} bases={bases} today={today} />
          <h2 id="cuit-titre" className="sr-only">
            Ce qui a été cuit
          </h2>
          <ul className="grid border-b border-line">
            {batch.dishes.map((d) => (
              <DishLine key={d.reserveId} d={d} art={d.slug ? arts[d.slug] : undefined} />
            ))}
          </ul>
          <BaseList bases={bases} today={today} title="Les bases du batch" />
        </section>
      )}

      <div className="lg:col-span-12">
        <SessionBoxes id={id} plan={plan} initial={{ models: owned, saved: data.saved, bases: data.bases }} arts={arts} />
      </div>
    </div>
  );
}

/** Un plat cuit : ses groupes (pesés, ou ≈ estimés), les portions de chacun, ce qui reste. */
function DishLine({ d, art }: { d: BatchDish; art?: React.ReactNode }) {
  const est = d.weigh !== "weighed";
  return (
    <li className="grid grid-cols-[56px_minmax(0,1fr)] items-start gap-x-4 gap-y-2 border-t border-line py-4" data-batch-dish={d.slug ?? d.reserveId} data-weigh={d.weigh}>
      {art ?? <BoxGlyph color={d.slug ? recipeColor(d.slug) : "var(--c-ink-3)"} size={56} />}
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {d.open ? (
            <Link href={`/plats/${d.reserveId}`} className="text-[17px] font-bold leading-snug text-pretty hover:underline hover:decoration-line-strong hover:underline-offset-4">
              {d.name}
            </Link>
          ) : (
            <b className="text-[17px] leading-snug text-pretty">{d.name}</b>
          )}
          {!d.open ? <Pill tone="idle" icon="check">tout mangé</Pill> : est ? <Pill tone="warn" icon="scale">{d.weigh === "partial" ? "en partie pesé" : "estimé"}</Pill> : <Pill tone="ok">pesé</Pill>}
        </div>
        <p className="num text-small text-ink-2">
          {d.groups.some((g) => g.g > 0) ? d.groups.filter((g) => g.g > 0).map((g) => `${g.label} ${g.estimated ? "≈ " : ""}${gramsLabel(g.g)}${g.base ? " (au récipient commun)" : ""}`).join(" · ") : "rangé en boîtes"}
          {est && d.open ? " (cuit, estimé d’après le cru)" : ""}
          {d.open ? (d.freezerOk ? " · se congèle" : " · ne se congèle pas") : ""}
        </p>
        <p className="num text-small text-ink">
          {d.people
            .filter((p) => p.total > 0)
            .map((p) => `${p.name} : ${plural(p.total, "portion")}${p.eaten ? `, ${p.left} restante${p.left > 1 ? "s" : ""}` : ""}`)
            .join(" · ")}
        </p>
      </div>
    </li>
  );
}
