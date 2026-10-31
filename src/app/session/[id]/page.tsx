import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { db } from "@/lib/db/client";
import { dayPlan, eventsAfter, getSession } from "@/lib/session/store";
import { SessionApp } from "@/components/session/SessionApp";
import { modeOf, type SessionPlan } from "@/lib/session/planner";
import { mealsOf, type RecipeStorage } from "@/lib/session/flow";
import { recipes } from "@/lib/db/schema";
import { householdUnits, loadEaters } from "@/lib/eaters/store";
import { inArray } from "drizzle-orm";
import { DishBox } from "@/components/ui/dish";
import { listDishRecipes } from "@/lib/recipes/queries";
import type { DayChoice } from "@/components/session/SessionApp";
// Styles de la session (consigne et cadrans lus à un mètre, mouvement) : ici, pas dans les composants que les tests importent.
import "@/components/session/session.css";

const busy = (plan: SessionPlan, p: "A" | "B") =>
  plan.prep.tasks.filter((t) => t.person === p).reduce((x, t) => x + t.minutes, 0) + plan.steps.filter((x) => x.person === p).reduce((x, st) => x + st.activeMin, 0);

export const dynamic = "force-dynamic";

export default async function SessionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ vue?: string; personne?: string }> }) {
  const { id } = await params;
  const { vue, personne } = await searchParams;
  const s = getSession(db, id);
  if (!s) notFound();
  // Par défaut, la vue simple (trois temps, une consigne à la fois) ; ?vue=detail : la vue détaillée
  // (fil, ressources, minuteurs) ; ?vue=telephone : la vue simple en plein écran, posée à côté du feu.
  const view = vue === "telephone" ? "phone" : vue === "detail" ? "full" : "simple";
  // L’adresse vue par le navigateur (derrière Caddy et le tunnel : en-têtes transmis).
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3010";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") || /^\d+\.\d+\.\d+\.\d+/.test(host) ? "http" : "https");
  const phoneUrl = `${proto}://${host}/session/${id}?vue=telephone`;
  const qrSvg = view !== "phone" ? await QRCode.toString(phoneUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) : null;
  // À deux : un QR code par personne, qui ouvre son fil sur son téléphone.
  const duo = modeOf(s.plan) === "duo";
  const personQrs =
    duo && view === "full"
      ? await Promise.all(
          (["A", "B"] as const).map(async (person) => {
            const url = `${phoneUrl}&personne=${person}`;
            return { person, url, svg: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
          })
        )
      : undefined;
  const person = personne === "A" || personne === "B" ? personne : null;
  const events = eventsAfter(db, id, 0);
  // Prep la veille, bols au frigo : ce que donnerait le jour J à deux (le plan n’est enregistré qu’à la reprise).
  let dayChoice: DayChoice | null = null;
  if (modeOf(s.plan) === "veille" && s.status === "fridge") {
    const d = dayPlan(db, id, events);
    dayChoice = {
      solo: { prepMin: s.plan.prep.minutes, cookingMin: s.plan.cookingMin, totalMin: s.plan.prep.minutes + s.plan.cookingMin },
      duo: d && d.errors.length === 0 ? { totalMin: d.totalMin, aMin: busy(d, "A"), bMin: busy(d, "B") } : null,
    };
  }
  // Le rangement : une boîte par repas du foyer, et la conservation de chaque fiche.
  const perMeal = householdUnits(loadEaters(db));
  const rows = db.select({ slug: recipes.slug, units: recipes.servingsUnits, fridgeDays: recipes.fridgeDays, freezerOk: recipes.freezerOk }).from(recipes).where(inArray(recipes.slug, s.plan.recipes.map((r) => r.slug))).all();
  const storage: RecipeStorage[] = s.plan.recipes.flatMap((r) => {
    const row = rows.find((x) => x.slug === r.slug);
    if (!row) return [];
    const units = row.units * r.scale;
    return [{ slug: r.slug, units, meals: mealsOf(units, perMeal), fridgeDays: row.fridgeDays, freezerOk: row.freezerOk }];
  });
  // La boîte de chaque plat, dessinée ici (le dessin reste côté serveur).
  const dishes = Object.fromEntries(
    [...listDishRecipes(db).values()].flatMap((d) => {
      const r = s.plan.recipes.find((x) => x.slug === d.slug);
      return r ? [[d.slug, <DishBox key={d.slug} recipe={d} size="sm" color={r.color} />]] : [];
    })
  );
  return (
    <SessionApp
      id={id}
      plan={s.plan}
      startedAt={s.startedAt}
      initialStatus={s.status}
      initialEvents={events}
      view={view}
      phoneUrl={phoneUrl}
      qrSvg={qrSvg}
      serverNow={Date.now()}
      personQrs={personQrs}
      person={person}
      dayChoice={dayChoice}
      test={s.test}
      storage={storage}
      dishes={dishes}
    />
  );
}
