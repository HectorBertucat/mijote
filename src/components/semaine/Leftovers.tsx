// « Paquets entamés » : ce qui restera de chaque paquet après la session, sur toutes les
// recettes retenues, et ce qu'on peut en faire (calculé en code, src/lib/week/leftovers.ts).
// DA « Plan de travail » : un Alert « leaf » (anti-gaspillage) par paquet, ses propositions en lignes.
// Composant serveur asynchrone : à placer dans un <Suspense> (les /resolve sont en cache).
import Link from "next/link";
import type { ReactNode } from "react";
import { Alert, buttonClass, Icon, RecipeTile } from "@/components/ui";
import { db } from "@/lib/db/client";
import { leftoversFor } from "@/lib/week/store";
import type { Leftover } from "@/lib/week/leftovers";
import { composerHref, type Selection } from "@/lib/week/selection";
import { recipeColor } from "@/lib/ui";
import { addAction, extraAction } from "@/app/semaine/actions";
import { PendingMark } from "@/components/PendingMark";
import { PendingButton } from "./PendingButton";
import { deFood, fmtG, fmtMin } from "./format";

export type LeftoverMode = { kind: "week"; w: string } | { kind: "composer"; selection: Selection };

const SHOWN = 4;

export async function Leftovers({ sel, mode }: { sel: { slug: string; factor?: number; extras?: Record<string, number> }[]; mode: LeftoverMode }) {
  if (sel.length === 0) return null;
  const { leftovers, error } = await leftoversFor(db, sel);
  const fresh = leftovers.filter((l) => l.perishable);
  const keeps = leftovers.filter((l) => !l.perishable);
  const extrasOf = Object.assign({}, ...sel.map((x) => x.extras ?? {})) as Record<string, number>;

  return (
    <section id="restes" className="grid scroll-mt-20 grid-cols-[minmax(0,1fr)] gap-2.5" aria-labelledby="restes-titre">
      <Head />
      {error && <Alert tone="warn">{error}</Alert>}
      {!error && fresh.length === 0 && (
        <Alert tone="ok" title="Aucun paquet frais entamé">
          Tout ce qui s&apos;achète est utilisé.
        </Alert>
      )}
      {fresh.slice(0, SHOWN).map((l) => (
        <LeftoverRow key={l.key} l={l} mode={mode} extrasOf={extrasOf} />
      ))}
      {fresh.length > SHOWN && (
        <details className="group min-w-0">
          <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 rounded-[12px] border border-line px-3.5 text-[14px] font-semibold hover:bg-surface-2">
            {fresh.length - SHOWN === 1 ? "1 autre reste" : `${fresh.length - SHOWN} autres restes`}
            <span className="min-w-0 flex-1 truncate font-normal text-ink-2">{fresh.slice(SHOWN).map((l) => `${fmtG(l.restG)} ${deFood(l.label)}`).join(" · ")}</span>
            <Icon name="chev" size="s" className="text-faint transition-transform group-open:rotate-90" />
          </summary>
          <div className="mt-2.5 grid gap-2.5">
            {fresh.slice(SHOWN).map((l) => (
              <LeftoverRow key={l.key} l={l} mode={mode} extrasOf={extrasOf} />
            ))}
          </div>
        </details>
      )}
      {keeps.length > 0 && (
        <p className="text-[13px] text-ink-2">
          <b className="text-ink">Se garde</b> (sec ou surgelé) : {keeps.map((l) => `${fmtG(l.restG)} ${deFood(l.label)}`).join(" · ")}.
        </p>
      )}
    </section>
  );
}

function Head() {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <h2 id="restes-titre" className="text-[18px] font-bold">
        Paquets entamés
      </h2>
      <p className="text-[13px] text-ink-2">sur toutes les recettes, d&apos;après les produits du drive</p>
    </div>
  );
}

function LeftoverRow({ l, mode, extrasOf }: { l: Leftover; mode: LeftoverMode; extrasOf: Record<string, number> }) {
  const pct = Math.round((l.needG / l.orderedG) * 100);
  const hasActions = l.add.length > 0 || l.adjust || l.atelierHref;
  return (
    <Alert tone="leaf" className="animate-pop" title={<>Il restera <span className="num">{fmtG(l.restG)}</span> {deFood(l.label)}</>}>
      <span className="grid gap-2">
        <span className="text-[13px] tabular-nums text-ink-2">
          {l.packs > 1 ? `${l.packs} × ` : ""}
          {l.quantityLabel ?? fmtG(l.packG)} achetés · {fmtG(l.needG)} utilisés ({pct} %)
        </span>
        {/* Ce qui est utilisé, recette par recette, dans le paquet acheté. */}
        <span className="flex h-2 overflow-hidden rounded-full bg-surface" aria-hidden>
          {l.uses.map((u) => (
            <span key={u.slug} style={{ width: `${(u.grams / l.orderedG) * 100}%`, background: recipeColor(u.slug) }} />
          ))}
        </span>
        <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-ink-2">
          {l.uses.map((u) => (
            <span key={u.slug} className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full" style={{ background: recipeColor(u.slug) }} aria-hidden />
              {u.name} <span className="num">{fmtG(u.grams)}</span>
            </span>
          ))}
        </span>
        {hasActions && (
          <span className="mt-0.5 grid overflow-hidden rounded-[10px] border border-line bg-surface [&>*:last-child]:border-b-0">
            {l.add.map((a) => (
              <AddRow key={a.slug} l={l} a={a} mode={mode} />
            ))}
            {l.adjust && <AdjustRow l={l} mode={mode} current={extrasOf[l.adjust.ingredientId] ?? 0} />}
            {l.atelierHref && (
              <Proposal lead={<Lead icon="sparkdraft" />} title={`Une recette pour ces ${fmtG(l.restG)}`} sub="créée dans l'atelier, à partir du reste">
                <Link href={l.atelierHref} className={buttonClass({ size: "sm" })}>
                  Atelier <PendingMark idle={<Icon name="chev" size="s" />} />
                </Link>
              </Proposal>
            )}
          </span>
        )}
      </span>
    </Alert>
  );
}

function Lead({ icon }: { icon: "sparkdraft" | "plus" }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-[6px] bg-surface-2 text-ink-2">
      <Icon name={icon} size="s" />
    </span>
  );
}

function Proposal({ lead, title, sub, children }: { lead: ReactNode; title: ReactNode; sub: ReactNode; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-3 border-b border-line px-3 py-2.5 text-ink">
      {lead}
      <span className="grid min-w-0 flex-1">
        <span className="text-[14px] font-semibold leading-tight">{title}</span>
        <span className="text-[13px] leading-snug text-ink-2">{sub}</span>
      </span>
      <span className="shrink-0">{children}</span>
    </span>
  );
}

function AddRow({ l, a, mode }: { l: Leftover; a: Leftover["add"][number]; mode: LeftoverMode }) {
  const what = a.morePacks ? `en demande ${fmtG(a.usesG)} : un paquet de plus` : a.restAfterG === 0 ? `finit le paquet (${fmtG(a.usesG)})` : `en utilise ${fmtG(a.usesG)}, il resterait ${fmtG(a.restAfterG)}`;
  const sub = (
    <>
      {what} · {a.addedMin > 0 ? `+${fmtMin(a.addedMin)}` : "sans allonger la session"}
      {a.dislikes.length > 0 && <span className="text-warn-ink"> · {a.dislikes.join(" · ")}</span>}
    </>
  );
  const button =
    mode.kind === "composer" ? (
      <Link href={composerHref({ ...mode.selection, slugs: [...mode.selection.slugs, a.slug] })} scroll={false} className={buttonClass({ size: "sm" })}>
        <PendingMark idle={<Icon name="plus" size="s" />} />
        Ajouter
      </Link>
    ) : (
      <form action={addAction}>
        <input type="hidden" name="w" value={mode.w} />
        <input type="hidden" name="slug" value={a.slug} />
        <PendingButton icon="plus" title={`Ajouter ${a.name} à la semaine pour finir ${deFood(l.label)}`} loadingLabel="Ajout…">
          Ajouter
        </PendingButton>
      </form>
    );
  return (
    <Proposal lead={<RecipeTile color={recipeColor(a.slug)} name={a.name} size="sm" />} title={a.name} sub={sub}>
      {button}
    </Proposal>
  );
}

function AdjustRow({ l, mode, current }: { l: Leftover; mode: LeftoverMode; current: number }) {
  const j = l.adjust!;
  const sub = (
    <>
      {j.item} {fmtG(j.fromG)} → {fmtG(j.fromG + j.extraG)} · part H <span className="num">{j.before.kcal} → {j.after.kcal}</span> kcal, <span className="num">{j.before.protein} → {j.after.protein}</span> g{" "}
      {j.inTarget ? "(dans le repère)" : "(écart au repère presque inchangé)"}
    </>
  );
  const title = `Mettre les ${fmtG(j.extraG)} dans ${j.name}`;
  const button =
    mode.kind === "composer" ? (
      <Link href={composerHref({ ...mode.selection, extras: { ...mode.selection.extras, [j.ingredientId]: current + j.extraG } })} scroll={false} className={buttonClass({ size: "sm" })}>
        <PendingMark idle={<Icon name="check" size="s" />} />
        Mettre
      </Link>
    ) : (
      <form action={extraAction}>
        <input type="hidden" name="w" value={mode.w} />
        <input type="hidden" name="slug" value={j.slug} />
        <input type="hidden" name="ingredientId" value={j.ingredientId} />
        <input type="hidden" name="grams" value={String(current + j.extraG)} />
        <PendingButton icon="check" loadingLabel="…">
          Mettre
        </PendingButton>
      </form>
    );
  return (
    <Proposal lead={<RecipeTile color={recipeColor(j.slug)} name={j.name} size="sm" />} title={title} sub={sub}>
      {button}
    </Proposal>
  );
}

export function LeftoversSkeleton() {
  return (
    <section className="grid gap-2.5" aria-busy="true" aria-label="Calcul des paquets entamés">
      <Head />
      <p className="text-[13px] text-ink-2">Je regarde les paquets du drive pour toutes les recettes…</p>
      {[0, 1].map((k) => (
        <div key={k} className="skeleton h-24 rounded-[12px]" />
      ))}
    </section>
  );
}
