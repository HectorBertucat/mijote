import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { startSession } from "@/app/session/actions";
import { restoreListForm } from "@/app/courses/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ModePicker } from "@/components/session/ModePicker";
import { buildPlan } from "@/lib/session/store";
import type { SessionMode, SessionPlan } from "@/lib/session/planner";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BuildProgress, CopyButton, LiveVerify } from "@/components/ListActions";
import { Alert, Icon, Simmer } from "@/components/ui";
import { BackLink, Figure, PageHead, SectionHead } from "@/components/cart/Carnet";
import { recipeColor } from "@/lib/ui";
import { CartList, type RowData } from "@/components/cart/CartList";
import { acceptedForItems } from "@/lib/products/list";
import { orderedIngredientsFor } from "@/lib/shopping/ordered";
import { db } from "@/lib/db/client";
import { recipeIngredients, recipes, shoppingItems, shoppingLists, weekPlans } from "@/lib/db/schema";
import { periodHeading } from "@/lib/week/period";
import { factorLabel } from "@/lib/week/selection";
import { AISLES } from "@/lib/shopping/rules";
import { buyName } from "@/lib/shopping/label";
import { accountEnabled, catalogEnabled, type ResolvedProduct } from "@/lib/chronocatalog";
import { storeLabel } from "@/lib/settings";
import { DrivePanel } from "@/components/cart/DrivePanel";
import { cartPayload, orderSummary } from "@/lib/shopping/drive";
import { firstOfMonth } from "@/lib/typo";

export const dynamic = "force-dynamic";

const day = (iso: string) => firstOfMonth(new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" }));

const eur = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2).replace(".", ",")} €`);
const grams = (g: number | null) => (g == null ? null : g >= 1000 ? `${(g / 1000).toLocaleString("fr-FR")}\u00a0kg` : `${Math.round(g)}\u00a0g`);
/** Titre long (plusieurs plats) : un cran plus petit, pour rester sur deux lignes. */

export default async function Liste({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const list = db.select().from(shoppingLists).where(eq(shoppingLists.id, id)).get();
  if (!list) notFound();
  const store = storeLabel(db);
  const building = list.buildTotal != null && (list.buildDone ?? 0) < list.buildTotal;
  // Serveur redémarré pendant la création (déploiement) : la liste ne finira jamais.
  const stuck = building && !list.buildError && Date.now() - new Date(list.createdAt).getTime() > 5 * 60_000;
  if (building || list.buildError) {
    // Les lignes de recette qui passent par /resolve, dans l’ordre (affichage de la progression).
    const rids = db.select({ id: recipes.id, slug: recipes.slug }).from(recipes).where(inArray(recipes.slug, list.recipeSlugs)).all();
    const order = new Map(list.recipeSlugs.map((s, i) => [s, i]));
    const slugOf = new Map(rids.map((r) => [r.id, r.slug]));
    const lines = rids.length
      ? db
          .select({ recipeId: recipeIngredients.recipeId, item: recipeIngredients.item, position: recipeIngredients.position })
          .from(recipeIngredients)
          .where(and(inArray(recipeIngredients.recipeId, rids.map((r) => r.id)), eq(recipeIngredients.pantry, false)))
          .all()
          .sort((a, b) => (order.get(slugOf.get(a.recipeId) ?? "") ?? 0) - (order.get(slugOf.get(b.recipeId) ?? "") ?? 0) || a.position - b.position)
          .map((l) => l.item.split(/[,(]/)[0].trim())
      : [];
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-12">
        <PageHead back={<BackLink href="/courses">Listes</BackLink>} kicker={store ?? "Liste de courses"} title={`Courses du ${day(list.createdAt)}`} size="display" />
        <BuildProgress done={list.buildDone ?? 0} total={list.buildTotal ?? 0} lines={lines} error={list.buildError ?? (stuck ? "création interrompue, refais la liste depuis Composer." : null)} />
        {!list.buildError && !stuck && <Simmer label="Je remplis le panier…" className="justify-self-center" />}
        {!list.buildError && !stuck && (
          <div className="grid gap-2" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-12 !rounded-[8px]" style={{ opacity: 1 - i * 0.25 }} />
            ))}
          </div>
        )}
      </div>
    );
  }
  const ordered = list.status === "ordered" || list.status === "paid";
  const plans: Partial<Record<SessionMode, SessionPlan>> = {};
  if (list.recipeSlugs.length) for (const m of ["solo", "duo", "veille"] as const) plans[m] = buildPlan(db, { slugs: list.recipeSlugs, shoppingListId: id, mode: m });
  const items = db.select().from(shoppingItems).where(eq(shoppingItems.listId, id)).orderBy(asc(shoppingItems.position)).all();
  const recipeRows = db.select({ id: recipes.id, name: recipes.name, slug: recipes.slug, servingsUnits: recipes.servingsUnits }).from(recipes).all();
  const recipeNames = new Map(recipeRows.map((r) => [r.id, r.name]));
  const week = list.weekPlanId ? db.select({ weekStart: weekPlans.weekStart, days: weekPlans.days }).from(weekPlans).where(eq(weekPlans.id, list.weekPlanId)).get() : null;
  const scaledRecipes = recipeRows.filter((r) => list.recipeSlugs.includes(r.slug) && (list.recipeScales[r.slug] ?? 1) !== 1);

  const buy = items.filter((i) => !i.pantry);
  const total = buy.reduce((s, i) => s + (i.totalPrice ?? 0), 0);
  // Bandeau : la viande, le rouge, et les vrais doutes (pas un simple « vérifié il y a 6 h »).
  const realDoubt = (w: string) => !w.startsWith("vérifié il y a") && w !== "facultatif";
  const toCheck = buy.filter((i) => i.state === "ko" || i.warnings.some(realDoubt));
  const meat = !catalogEnabled() ? 0 : buy.filter((i) => i.aisle === "Boucherie" && !toCheck.includes(i)).length;
  const reason = (i: (typeof items)[number]): { tone: "ko" | "warn"; text: string } => {
    const w = i.warnings.find(realDoubt);
    return i.state === "ko" ? { tone: "ko", text: w ?? "rupture" } : { tone: "warn", text: w ?? "à vérifier" };
  };
  const acceptedOf = acceptedForItems(db, items);
  const toRow = (i: (typeof items)[number]): RowData => {
    const p = i.productJson as ResolvedProduct | null;
    return {
      id: i.id,
      pantry: i.pantry,
      item: i.item,
      packs: i.packs ?? 0,
      unitPrice: i.unitPrice,
      totalPrice: i.totalPrice,
      state: i.state,
      warnings: i.warnings,
      forRecipes: i.recipeIds.map((r) => recipeNames.get(r)).filter(Boolean).join(", "),
      needG: i.needG,
      product: p ? { name: p.name, url: p.productUrl, quantityLabel: p.quantityLabel, brandName: p.brandName } : null,
      alts: ((i.alternativesJson ?? []) as ResolvedProduct[]).map((a) => ({ id: a.id, label: `${a.name} ${a.quantityLabel ?? ""}`.trim(), price: a.promoPriceEur ?? a.currentPrice })),
      inCart: !!i.inCartAt,
      liveStatus: i.liveStatus,
      accepted: acceptedOf.get(i.id) ?? [],
      canRefuse: !!(p && i.assocKey),
      drive: i.driveOutcome ? { outcome: i.driveOutcome, qty: i.driveQty } : null,
    };
  };
  const byAisle = AISLES.map((a) => ({ aisle: a, rows: items.filter((i) => (i.pantry ? "Placard" : i.aisle) === a) })).filter((g) => g.rows.length);

  const groups = byAisle.map((g) => ({ aisle: g.aisle, rows: g.rows.map(toRow) }));
  const copy = [
    `Courses : ${list.title} (≈ ${eur(total)})`,
    ...byAisle.flatMap(({ aisle, rows }) => [
      "",
      aisle.toUpperCase(),
      ...rows.map((i) => {
        if (i.pantry) return `- ${i.item} (placard, à vérifier)`;
        const p = i.productJson as ResolvedProduct | null;
        return p ? `- ${i.packs} × ${p.name} ${p.quantityLabel ?? ""} · ${eur(i.totalPrice)} · ${p.productUrl}` : catalogEnabled() ? `- ${buyName(i.item)} : introuvable, à chercher` : `- ${buyName(i.item)}${i.needG ? ` (${Math.round(i.needG)} g)` : ""}`;
      }),
    ]),
  ].join("\n");

  const liveLines = buy.filter((i) => i.productJson).map((i) => ({ label: (i.productJson as ResolvedProduct).name, status: i.liveStatus }));

  // Le titre est le jour ; les plats (ancien titre « A + B + C ») passent dessous, ils ne tiennent pas en titre.
  const title = `Courses du ${day(list.createdAt)}`;
  const dishes = (list.title ?? "").split(" + ").filter(Boolean);
  const checkFirst = !ordered && (toCheck.length > 0 || meat > 0);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:gap-18">
      <AutoRefresh />
      <PageHead
        back={<BackLink href="/courses">Listes</BackLink>}
        kicker={store ?? "Liste de courses"}
        title={title}
        size="display"
        aside={
          total > 0 ? (
            <Figure big value={total.toFixed(2).replace(".", ",")} unit="€" label={`${buy.length} articles${ordered ? (catalogEnabled() ? ", commandés" : ", achetés") : catalogEnabled() ? ", estimé" : ", prix saisis"}`} />
          ) : (
            <Figure big value={buy.length} label={`articles${ordered ? (catalogEnabled() ? " commandés" : " achetés") : " à prendre"}`} />
          )
        }
      >
        {/* Les plats une seule fois, avec leur multiplicateur (« Colombo de porc ×2 ») plutôt que redits dessous. */}
        {dishes.length > 0 && (
          <p className="max-w-[60ch] text-lead text-ink-2">
            {dishes.map((d, i) => {
              const scaled = scaledRecipes.find((r) => r.name === d);
              return (
                <span key={d}>
                  {i > 0 && " · "}
                  {d}
                  {scaled && <span className="num whitespace-nowrap">{`\u00a0${factorLabel(list.recipeScales[scaled.slug])}`}</span>}
                </span>
              );
            })}
          </p>
        )}
        {(week || Object.keys(list.recipeExtras).length > 0) && (
          <p className="text-small text-ink-2">
            {week && (
              <Link href={`/semaine?w=${week.weekStart}`} className="font-semibold text-accent underline-offset-4 hover:underline">
                {periodHeading(week.weekStart, week.days)}
              </Link>
            )}
            {Object.keys(list.recipeExtras).length > 0 && <span>{week && " · "}{Object.keys(list.recipeExtras).length === 1 ? "1 paquet fini" : `${Object.keys(list.recipeExtras).length} paquets finis`} (grammes ajoutés)</span>}
          </p>
        )}
      </PageHead>

      {list.archivedAt && (
        <Alert
          tone="info"
          icon="archive"
          title="Liste archivée"
          action={
            <form action={restoreListForm}>
              <input type="hidden" name="listId" value={list.id} />
              <SubmitButton size="sm" variant="soft" pendingText="Je restaure…">
                Restaurer
              </SubmitButton>
            </form>
          }
        >
          Rangée sous « Archivées » dans Courses.
        </Alert>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-6">
        {checkFirst && (
          <section aria-labelledby="verifier-titre" className="grid content-start gap-3 lg:col-span-4 lg:col-start-9 lg:row-start-1">
            <SectionHead as="label" id="verifier-titre" title="Avant de valider" count={toCheck.length || undefined} />
            <ul>
              {toCheck.map((i) => {
                const r = reason(i);
                return (
                  <li key={i.id} className="border-b border-line">
                    <a href={`#ligne-${i.id}`} className="grid gap-1 py-3 hover:text-ink [&:hover_b]:underline [&:hover_b]:decoration-line-strong [&:hover_b]:underline-offset-4">
                      <b className="font-semibold">{(i.productJson as ResolvedProduct | null)?.name ?? i.item}</b>
                      <span className={`inline-flex items-center gap-1 text-small font-semibold ${r.tone === "ko" ? "text-ko-ink" : "text-warn-ink"}`}>
                        <Icon name={r.tone === "ko" ? "x" : "alert"} size="s" strokeWidth={2.4} />
                        {r.text.charAt(0).toUpperCase() + r.text.slice(1)}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
            {meat > 0 && <p className="text-small text-ink-2">Boucherie : regarde le poids et le prix au kilo sur le drive ({meat === 1 ? "1 ligne" : `${meat} lignes`}).</p>}
          </section>
        )}

        <div className="min-w-0 lg:col-span-8 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <CartList catalog={catalogEnabled()} listId={id} title={title} ordered={ordered} orderedAt={list.orderedAt} groups={groups} copy={<CopyButton text={copy} links={catalogEnabled()} />} />
        </div>

        {catalogEnabled() && (
          <aside className={`grid content-start gap-12 lg:col-span-4 lg:col-start-9 ${checkFirst ? "lg:row-start-2" : "lg:row-start-1 lg:row-span-2"}`}>
            {!ordered && <LiveVerify listId={id} lines={liveLines} />}
            <DrivePanel
              listId={id}
              enabled={accountEnabled()}
              ordered={ordered}
              products={cartPayload(items).length}
              drive={{ status: list.driveStatus, at: list.driveAt, error: list.driveError, summary: list.driveSummary }}
              order={{ status: list.orderStatus, error: list.orderError, ...(orderSummary(db, id) ?? { paid: null, estimated: null, matched: 0, total: 0 }) }}
            />
          </aside>
        )}
      </div>

      <Coverage listId={id} ordered={ordered} />

      <section aria-labelledby="session-titre" className="grid gap-6">
        <SectionHead id="session-titre" title="Cuisiner" />
        <form action={startSession} className="grid gap-4">
          <input type="hidden" name="slugs" value={list.recipeSlugs.join(",")} />
          <input type="hidden" name="listId" value={id} />
          <ModePicker plans={plans} />
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton pendingText="Je planifie la session…" variant={ordered ? undefined : "soft"}>
              {ordered ? "Lancer la session avec ma commande" : "Lancer la session avec cette liste"}
            </SubmitButton>
            {ordered && <CopyButton text={copy} links={catalogEnabled()} />}
          </div>
        </form>
      </section>
    </div>
  );
}

/** Ce que la commande couvre, recette par recette : manques (et unités conseillées) et restes. */
function Coverage({ listId, ordered }: { listId: string; ordered: boolean }) {
  const recs = orderedIngredientsFor(db, listId);
  // Sans aucun produit choisi (pas de catalogue), on ne sait pas ce que la liste couvre : tout serait « manquant ».
  if (!recs.some((r) => r.ingredients.some((i) => i.product))) return null;
  const rows = recs.map((r) => ({
    r,
    short: r.ingredients.filter((i) => i.status === "short" || i.status === "missing"),
    surplus: r.ingredients.filter((i) => i.status === "surplus"),
  }));
  if (!rows.some((x) => x.short.length || x.surplus.length)) return null;
  return (
    <section className="grid gap-6" aria-labelledby="couvre-titre">
      <SectionHead id="couvre-titre" title={ordered ? "Ce que la commande couvre" : "Ce que la liste couvre"} />
      <ul className="grid gap-x-6 lg:grid-cols-2">
        {rows.map(({ r, short, surplus }) => (
          <li key={r.recipeId} className="grid content-start gap-3 border-b border-line py-4 pl-4" style={{ boxShadow: `inset 4px 0 0 ${recipeColor(r.slug)}` }}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-h3">{r.name}</h3>
              {short.length === 0 ? (
                <span className="inline-flex items-center gap-1 text-small font-semibold text-ok-ink">
                  <Icon name="check" size="s" strokeWidth={2.4} />
                  Tout est couvert
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-small font-semibold text-ko-ink">
                  <Icon name="x" size="s" strokeWidth={2.4} />
                  {short.length === 1 ? "1 manque" : `${short.length} manques`}
                </span>
              )}
            </div>
            {short.length === 0 ? (
              <p className="text-small text-ink-2">
                Pour <span className="num">{r.servingsUnits}</span> unités.
              </p>
            ) : (
              <>
                <table className="w-full text-small">
                  <tbody>
                    {short.map((i) => (
                      <tr key={i.lineRaw} className="border-t border-line">
                        <td className="py-1 pr-4">{i.item.split(/[,(]/)[0]}</td>
                        <td className="num whitespace-nowrap py-1 text-right text-ink-2">
                          <span className="text-ink">{grams(i.boughtG ?? 0)}</span> sur {grams(i.needG) ?? "?"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {r.suggestedUnits < r.servingsUnits && (
                  <p className="text-small text-ink">
                    Fais <b className="num">{r.suggestedUnits}</b> {r.suggestedUnits > 1 ? "unités" : "unité"} au lieu de <span className="num">{r.servingsUnits}</span>, ou ajoute un paquet.
                  </p>
                )}
              </>
            )}
            {surplus.length > 0 && (
              <p className="flex items-start gap-1 text-small text-ink-2">
                <Icon name="leaf" size="s" className="mt-1 shrink-0" />
                <span>Restes au placard : {surplus.map((i) => `${i.item.split(/[,(]/)[0]} +${grams(i.gapG)}`).join(" · ")}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
