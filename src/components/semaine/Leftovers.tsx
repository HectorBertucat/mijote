// « Paquets entamés » : ce qui restera de chaque paquet après la session, sur toutes les
// recettes retenues, et ce qu'on peut en faire (calculé en code, src/lib/week/leftovers.ts).
// « Carnet de marché » : un paquet par ligne sous un filet, ce qu’il sert recette par recette, ses propositions en lignes.
// Composant serveur asynchrone : à placer dans un <Suspense> (les /resolve sont en cache).
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass, Icon, RecipeTile } from "@/components/ui";
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

/** `head={false}` quand la section est déjà titrée (repli de la Semaine). */
export async function Leftovers({ sel, mode, head = true }: { sel: { slug: string; factor?: number; extras?: Record<string, number> }[]; mode: LeftoverMode; head?: boolean }) {
  if (sel.length === 0) return null;
  const { leftovers, error } = await leftoversFor(db, sel);
  const fresh = leftovers.filter((l) => l.perishable);
  const keeps = leftovers.filter((l) => !l.perishable);
  const extrasOf = Object.assign({}, ...sel.map((x) => x.extras ?? {})) as Record<string, number>;

  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-6" aria-labelledby={head ? "restes-titre" : undefined} aria-label={head ? undefined : "Paquets entamés"}>
      {head && <Head />}
      <div className="border-b border-line">
        {error && <Line icon="alert">{error}</Line>}
        {!error && fresh.length === 0 && <Line icon="check">Aucun paquet frais entamé : tout ce qui s’achète est utilisé.</Line>}
        {fresh.slice(0, SHOWN).map((l) => (
          <LeftoverRow key={l.key} l={l} mode={mode} extrasOf={extrasOf} />
        ))}
        {fresh.length > SHOWN && (
          <details className="group min-w-0 border-t border-line">
            <summary className="flex min-h-tap cursor-pointer list-none items-center gap-3 py-4 text-small font-bold hover:text-ink [&::-webkit-details-marker]:hidden">
              {fresh.length - SHOWN === 1 ? "1 autre reste" : `${fresh.length - SHOWN} autres restes`}
              <span className="min-w-0 flex-1 truncate font-normal text-ink-2">{fresh.slice(SHOWN).map((l) => `${fmtG(l.restG)} ${deFood(l.label)}`).join(" · ")}</span>
              <Icon name="chev" size="s" className="text-ink-3 transition-transform duration-[var(--dur-2)] ease-[var(--ease-out)] group-open:rotate-90" />
            </summary>
            {fresh.slice(SHOWN).map((l) => (
              <LeftoverRow key={l.key} l={l} mode={mode} extrasOf={extrasOf} />
            ))}
          </details>
        )}
      </div>
      {keeps.length > 0 && (
        <p className="text-small text-ink-2">
          <b className="text-ink">Se garde</b> (sec ou surgelé)&nbsp;: {keeps.map((l) => `${fmtG(l.restG)} ${deFood(l.label)}`).join(" · ")}.
        </p>
      )}
    </section>
  );
}

function Line({ icon, children }: { icon: "alert" | "check"; children: ReactNode }) {
  return (
    <p className="flex items-start gap-3 border-t border-line py-4 text-small">
      <Icon name={icon} size="s" className={`mt-[3px] shrink-0 ${icon === "alert" ? "text-warn" : "text-ink-2"}`} />
      {children}
    </p>
  );
}

function Head() {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <h2 id="restes-titre" className="text-h2">
        Paquets entamés
      </h2>
      <p className="text-small text-ink-2">sur toutes les recettes, d’après les produits du drive</p>
    </div>
  );
}

function LeftoverRow({ l, mode, extrasOf }: { l: Leftover; mode: LeftoverMode; extrasOf: Record<string, number> }) {
  const pct = Math.round((l.needG / l.orderedG) * 100);
  const hasActions = l.add.length > 0 || l.adjust || l.atelierHref;
  return (
    <article className="grid gap-3 border-t border-line py-6">
      <h3 className="text-body font-bold tracking-normal [font-family:var(--font-sans)]">
        Il restera <span className="num">{fmtG(l.restG)}</span> {deFood(l.label)}
      </h3>
      <p className="text-small tabular-nums text-ink-2">
        {l.packs > 1 ? `${l.packs} × ` : ""}
        {l.quantityLabel ?? fmtG(l.packG)} achetés · {fmtG(l.needG)} utilisés ({pct}&nbsp;%)
      </p>
      {/* Ce qui est utilisé, recette par recette, dans le paquet acheté. */}
      <span className="flex h-2 max-w-[480px] overflow-hidden rounded-[4px] bg-surface-2" aria-hidden>
        {l.uses.map((u) => (
          <span key={u.slug} style={{ width: `${(u.grams / l.orderedG) * 100}%`, background: recipeColor(u.slug) }} />
        ))}
      </span>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-small text-ink-2">
        {l.uses.map((u) => (
          <span key={u.slug} className="inline-flex items-center gap-2">
            <i className="size-2 rounded-[2px]" style={{ background: recipeColor(u.slug) }} aria-hidden />
            {u.name} <span className="num">{fmtG(u.grams)}</span>
          </span>
        ))}
      </p>
      {hasActions && (
        <div className="grid border-b border-line">
          {l.add.map((a) => (
            <AddRow key={a.slug} l={l} a={a} mode={mode} />
          ))}
          {l.adjust && <AdjustRow l={l} mode={mode} current={extrasOf[l.adjust.ingredientId] ?? 0} />}
          {l.atelierHref && (
            <Proposal lead={<Lead icon="sparkdraft" />} title={`Une recette pour ces ${fmtG(l.restG)}`} sub="créée dans l’atelier, à partir du reste">
              <Link href={l.atelierHref} className={buttonClass({ size: "sm" })}>
                Atelier <PendingMark idle={<Icon name="chev" size="s" />} />
              </Link>
            </Proposal>
          )}
        </div>
      )}
    </article>
  );
}

function Lead({ icon }: { icon: "sparkdraft" | "plus" }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-[4px] bg-surface-2 text-ink-2">
      <Icon name={icon} size="s" />
    </span>
  );
}

function Proposal({ lead, title, sub, children }: { lead: ReactNode; title: ReactNode; sub: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-t border-line py-3 text-ink">
      {lead}
      <span className="grid min-w-0 flex-1">
        <span className="text-small font-bold">{title}</span>
        <span className="text-small text-ink-2">{sub}</span>
      </span>
      <span className="shrink-0">{children}</span>
    </div>
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

export function LeftoversSkeleton({ head = true }: { head?: boolean }) {
  return (
    <section className="grid gap-4" aria-busy="true" aria-label="Calcul des paquets entamés">
      {head && <Head />}
      <p className="text-small text-ink-2">Je regarde les paquets du drive pour toutes les recettes…</p>
      {[0, 1].map((k) => (
        <div key={k} className="skeleton h-24 !rounded-[8px]" />
      ))}
    </section>
  );
}
