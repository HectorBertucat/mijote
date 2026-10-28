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
import { Alert, Card, Icon, Pill, Simmer } from "@/components/ui";
import { CartList, type RowData } from "@/components/cart/CartList";
import { acceptedForItems } from "@/lib/products/list";
import { orderedIngredientsFor } from "@/lib/shopping/ordered";
import { db } from "@/lib/db/client";
import { recipeIngredients, recipes, shoppingItems, shoppingLists, weekPlans } from "@/lib/db/schema";
import { factorLabel } from "@/lib/week/selection";
import { AISLES } from "@/lib/shopping/rules";
import { accountEnabled, catalogEnabled, type ResolvedProduct } from "@/lib/chronocatalog";
import { storeLabel } from "@/lib/settings";
import { DrivePanel } from "@/components/cart/DrivePanel";
import { cartPayload, orderSummary } from "@/lib/shopping/drive";

export const dynamic = "force-dynamic";

const TONE = { ok: "ok", warn: "warn", ko: "ko" } as const;
const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" });

function Back() {
  return (
    <Link href="/courses" className="inline-flex min-h-tap items-center gap-1 text-[14px] font-semibold text-ink-2 hover:text-ink">
      <Icon name="chev" size="s" className="rotate-180" />
      Listes
    </Link>
  );
}
const eur = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2).replace(".", ",")} €`);
const grams = (g: number | null) => (g == null ? null : g >= 1000 ? `${(g / 1000).toLocaleString("fr-FR")} kg` : `${Math.round(g)} g`);

export default async function Liste({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const list = db.select().from(shoppingLists).where(eq(shoppingLists.id, id)).get();
  if (!list) notFound();
  const store = storeLabel(db);
  const building = list.buildTotal != null && (list.buildDone ?? 0) < list.buildTotal;
  // Serveur redémarré pendant la création (déploiement) : la liste ne finira jamais.
  const stuck = building && !list.buildError && Date.now() - new Date(list.createdAt).getTime() > 5 * 60_000;
  if (building || list.buildError) {
    // Les lignes de recette qui passent par /resolve, dans l'ordre (affichage de la progression).
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
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <div>
          <Back />
          <h1 className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[36px] sm:leading-none">Courses du {day(list.createdAt)}</h1>
          <p className="mt-1.5 text-ink-2">{list.title}{store ? ` · ${store}` : ""}</p>
        </div>
        <BuildProgress done={list.buildDone ?? 0} total={list.buildTotal ?? 0} lines={lines} error={list.buildError ?? (stuck ? "création interrompue, refais la liste depuis Composer." : null)} />
        {!list.buildError && !stuck && <Simmer label="Je remplis le panier…" className="justify-self-center" />}
        {!list.buildError && !stuck && (
          <div className="grid gap-2" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-16 rounded-[14px]" style={{ opacity: 1 - i * 0.25 }} />
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
  const week = list.weekPlanId ? db.select({ weekStart: weekPlans.weekStart }).from(weekPlans).where(eq(weekPlans.id, list.weekPlanId)).get() : null;
  const scaledRecipes = recipeRows.filter((r) => list.recipeSlugs.includes(r.slug) && (list.recipeScales[r.slug] ?? 1) !== 1);

  const buy = items.filter((i) => !i.pantry);
  const total = buy.reduce((s, i) => s + (i.totalPrice ?? 0), 0);
  // Bandeau : la viande, le rouge, et les vrais doutes (pas un simple « vérifié il y a 6 h »).
  const realDoubt = (w: string) => !w.startsWith("vérifié il y a") && w !== "facultatif";
  const toCheck = buy.filter((i) => i.aisle === "Boucherie" || i.state === "ko" || i.warnings.some(realDoubt));
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
        return p ? `- ${i.packs} × ${p.name} ${p.quantityLabel ?? ""} · ${eur(i.totalPrice)} · ${p.productUrl}` : catalogEnabled() ? `- ${i.item} : introuvable, à chercher` : `- ${i.item}${i.needG ? ` (${Math.round(i.needG)} g)` : ""}`;
      }),
    ]),
  ].join("\n");

  const liveLines = buy.filter((i) => i.productJson).map((i) => ({ label: (i.productJson as ResolvedProduct).name, status: i.liveStatus }));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <AutoRefresh />
      <div>
        <Back />
        <h1 className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[36px] sm:leading-none">Courses du {day(list.createdAt)}</h1>
        <p className="mt-1.5 text-ink-2">
          {list.title}{store ? ` · ${store}` : ""} · <span className="num">{buy.length}</span> articles · ≈ <span className="num">{eur(total)}</span>
        </p>
        {(week || scaledRecipes.length > 0 || Object.keys(list.recipeExtras).length > 0) && (
          <p className="mt-1 text-[14px] text-ink-2">
            {week && (
              <Link href={`/semaine?w=${week.weekStart}`} className="font-semibold text-accent hover:underline">
                Semaine du {new Date(`${week.weekStart}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })}
              </Link>
            )}
            {scaledRecipes.map((r) => (
              <span key={r.slug}>
                {" "}
                · {r.name} {factorLabel(list.recipeScales[r.slug])} (<span className="num">{Math.round(r.servingsUnits * list.recipeScales[r.slug])} u</span>)
              </span>
            ))}
            {Object.keys(list.recipeExtras).length > 0 && <span> · {Object.keys(list.recipeExtras).length === 1 ? "1 paquet fini" : `${Object.keys(list.recipeExtras).length} paquets finis`} (grammes ajoutés)</span>}
          </p>
        )}
      </div>

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

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <div className="grid min-w-0 gap-3">
          {!ordered && toCheck.length > 0 && (
            <Alert tone="warn" title="À vérifier sur ton drive avant de valider">
              <span className="mt-1 grid gap-1">
                {toCheck.map((i) => (
                  <span key={i.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <Pill tone={TONE[i.state ?? "warn"]} dot>
                      {i.state === "ko" ? "rupture" : i.state === "ok" ? "en stock" : "à vérifier"}
                    </Pill>
                    <b className="font-semibold">{(i.productJson as ResolvedProduct | null)?.name ?? i.item}</b>
                    {i.warnings.length > 0 && <span className="text-[14px] opacity-80">{i.warnings.join(" · ")}</span>}
                  </span>
                ))}
              </span>
            </Alert>
          )}

          {!ordered && catalogEnabled() && <LiveVerify listId={id} lines={liveLines} />}

          {catalogEnabled() && <DrivePanel
            listId={id}
            enabled={accountEnabled()}
            ordered={ordered}
            products={cartPayload(items).length}
            drive={{ status: list.driveStatus, at: list.driveAt, error: list.driveError, summary: list.driveSummary }}
            order={{ status: list.orderStatus, error: list.orderError, ...(orderSummary(db, id) ?? { paid: null, estimated: null, matched: 0, total: 0 }) }}
          />}

          <CartList catalog={catalogEnabled()} listId={id} title={list.title ?? "Courses"} ordered={ordered} orderedAt={list.orderedAt} groups={groups} copy={<CopyButton text={copy} />} />

          <Coverage listId={id} ordered={ordered} />
        </div>

        <Card as="section" pad="md" className="grid gap-3">
          <h2 className="text-[18px] font-bold">Session de cuisine</h2>
      <form action={startSession} className="space-y-2.5">
        <input type="hidden" name="slugs" value={list.recipeSlugs.join(",")} />
        <input type="hidden" name="listId" value={id} />
        <ModePicker plans={plans} />
        <SubmitButton pendingText="Je planifie la session…" variant={ordered ? undefined : "soft"}>
          {ordered ? "Lancer la session avec ma commande" : "Lancer la session avec cette liste"}
        </SubmitButton>
      </form>
          {ordered && <CopyButton text={copy} size="sm" />}
        </Card>
      </div>
    </div>
  );
}

/** Ce que la commande couvre, recette par recette : manques (et unités conseillées) et restes. */
function Coverage({ listId, ordered }: { listId: string; ordered: boolean }) {
  const recs = orderedIngredientsFor(db, listId);
  const rows = recs.map((r) => ({
    r,
    short: r.ingredients.filter((i) => i.status === "short" || i.status === "missing"),
    surplus: r.ingredients.filter((i) => i.status === "surplus"),
  }));
  if (!rows.some((x) => x.short.length || x.surplus.length)) return null;
  return (
    <section className="mt-2 grid gap-2.5" aria-labelledby="couvre-titre">
      <h2 id="couvre-titre" className="text-[18px] font-bold">
        {ordered ? "Ce que la commande couvre" : "Ce que la liste couvre"}
      </h2>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {rows.map(({ r, short, surplus }) => (
          <Card key={r.recipeId} pad="sm" className="grid content-start gap-2 text-[14px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b className="font-display text-[16px]">{r.name}</b>
              {short.length === 0 ? <Pill tone="ok">tout est couvert</Pill> : <Pill tone="ko">{short.length === 1 ? "1 manque" : `${short.length} manques`}</Pill>}
            </div>
            {short.length === 0 ? (
              <p className="text-ink-2">
                Pour <span className="num">{r.servingsUnits}</span> unités.
              </p>
            ) : (
              <>
                <ul className="grid gap-0.5 text-ko-ink">
                  {short.map((i) => (
                    <li key={i.lineRaw}>
                      Manque {i.item.split(/[,(]/)[0]} : <span className="num">{grams(i.boughtG ?? 0)}</span> sur <span className="num">{grams(i.needG)}</span>
                    </li>
                  ))}
                </ul>
                {r.suggestedUnits < r.servingsUnits && (
                  <Alert tone="ko" className="!py-2 text-[14px]">
                    Ajuste la recette à <b className="num">{r.suggestedUnits} unités</b> au lieu de {r.servingsUnits}, ou ajoute un paquet.
                  </Alert>
                )}
              </>
            )}
            {surplus.length > 0 && (
              <p className="flex items-start gap-1.5 text-[13px] text-ink-2">
                <Icon name="leaf" size="s" className="mt-px shrink-0" />
                <span>Restes au placard : {surplus.map((i) => `${i.item.split(/[,(]/)[0]} +${grams(i.gapG)}`).join(" · ")}</span>
              </p>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
