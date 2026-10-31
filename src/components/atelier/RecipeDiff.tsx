"use client";

// Briques visuelles de l'atelier (DA v3 « Carnet de marché ») : ingrédients par bol avant → après (barrés, ajoutés,
// quantités qui changent et se posent), jauges nutrition qui glissent, restes de paquet (anti-gaspillage), étapes.
// Des sections à filets, pas de cartes ; les vérifications en lignes nettes, pas en pastilles.
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass, Icon, type IconName, type RecipeColor } from "@/components/ui";
import { AnimatedNumber, NutritionView } from "@/components/NutritionView";
import { BowlGroup, equipmentIcon, equipmentLabel, fmtQty, IngLine, StepItem } from "@/components/RecipeParts";
import type { DiffRow, Leftover, Verification } from "@/lib/atelier";
import type { RecipeInput } from "@/lib/recipes/format";
import { FoodIllu } from "@/components/illus/Illu";
import { Notes, SectionHead } from "./parts";

type Ing = RecipeInput["ingredients"][number];

export { AnimatedNumber, fmtQty };

export const fmtUsd = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

// ─── Nutrition avant → après ───

type AtelierPortions = Verification["after"];
const byId = (p: AtelierPortions) => Object.fromEntries(p.people.map((x) => [x.id, x.macros]));

export function NutritionCompare({ before, after, coverage }: { before: AtelierPortions | null; after: AtelierPortions; coverage: number }) {
  const people = after.people.map(({ id, name, units, ref }) => ({ id, name, units, ref }));
  return <NutritionView portions={byId(after)} before={before ? byId(before) : null} people={people} coverage={coverage} />;
}

// ─── Ingrédients ───

const STATE: Record<"ok" | "warn" | "replace", { icon: IconName; cls: string; text: string }> = {
  ok: { icon: "check", cls: "text-ok-ink", text: "au catalogue" },
  warn: { icon: "clock", cls: "text-warn-ink", text: "à vérifier" },
  replace: { icon: "x", cls: "text-ko-ink", text: "à remplacer" },
};

/** Vérification catalogue d'une ligne : l'état (forme et mot) et le produit retenu (lien vers le drive). */
function CheckLine({ row }: { row: DiffRow }) {
  const c = row.check;
  if (!c) return null;
  const s = STATE[c.state];
  return (
    <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-2">
      <span className={`inline-flex items-center gap-1 font-bold ${s.cls}`}>
        <Icon name={s.icon} size={14} strokeWidth={2.4} />
        {s.text}
      </span>
      {c.product && (
        <a href={c.product.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-2 hover:text-ink">
          <Icon name="basket" size="s" />
          <span className="truncate">
            {c.packs > 1 ? `${c.packs} × ` : ""}
            {c.product.name}
            {c.product.price != null && ` · ${c.product.price.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}`}
          </span>
        </a>
      )}
      {c.notes[0] && <span className="hidden truncate xl:inline">· {c.notes[0]}</span>}
    </span>
  );
}

function Row({ row }: { row: DiffRow }) {
  const ing = (row.after ?? row.before)!;
  const qtyBefore = row.before ? fmtQty(row.before.grams, row.before.units) : "";
  const qtyAfter = row.after ? fmtQty(row.after.grams, row.after.units) : "";
  const opt = ing.optional ? <span className="text-ink-2"> (facultatif)</span> : null;
  const art = <FoodIllu food={ing.food} item={ing.item} size="s" className={row.status === "removed" ? "opacity-40 grayscale" : ""} />;
  if (row.status === "removed")
    return (
      <IngLine art={art} qty={<span className="strike-out font-medium text-faint">{qtyBefore || "—"}</span>} name={<span className="strike-out text-faint">{ing.item}</span>} sub={<span className="text-small">· retiré</span>} className="animate-flash" />
    );
  if (row.status === "added")
    return (
      <IngLine art={art} qty={<span className="inline-block animate-swap-in">{qtyAfter || "—"}</span>} name={<span className="inline-block animate-swap-in font-semibold">+ {ing.item}</span>} className="animate-flash">
        {opt}
        <CheckLine row={row} />
      </IngLine>
    );
  if (row.status === "changed")
    return (
      <IngLine art={art}
        qty={
          <>
            {qtyBefore && <span className="mr-1 font-medium text-faint line-through">{qtyBefore}</span>}
            <span className="inline-block animate-swap-in text-accent">{qtyAfter}</span>
          </>
        }
        name={ing.item}
        className="animate-flash"
      >
        {opt}
        <CheckLine row={row} />
      </IngLine>
    );
  return (
    <IngLine art={art} qty={qtyAfter || "—"} name={ing.item}>
      {opt}
      <CheckLine row={row} />
    </IngLine>
  );
}

/** Ingrédients rangés par bol (pastilles à la couleur de la recette), placard à part ; chaque changement se voit. */
export function IngredientsDiff({ rows, title = "Ingrédients par bol", color = 8, aside }: { rows: DiffRow[]; title?: string; color?: RecipeColor; aside?: ReactNode }) {
  const main = rows.filter((r) => !(r.after ?? r.before)!.pantry);
  const pantry = rows.filter((r) => (r.after ?? r.before)!.pantry);
  const groups = new Map<string | null, DiffRow[]>();
  for (const r of main) {
    const g = (r.after ?? r.before)!.group ?? null;
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a == null ? -1 : b == null ? 1 : a.localeCompare(b)));
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const r of rows) if (r.status !== "same") counts[r.status]++;
  const tally = [
    counts.added ? `${counts.added} ajouté${counts.added > 1 ? "s" : ""}` : null,
    counts.changed ? `${counts.changed} modifié${counts.changed > 1 ? "s" : ""}` : null,
    counts.removed ? `${counts.removed} retiré${counts.removed > 1 ? "s" : ""}` : null,
  ].filter(Boolean);
  return (
    <section className="grid gap-2">
      <SectionHead aside={aside ?? (tally.length ? <span className="num">{tally.join(" · ")}</span> : null)}>{title}</SectionHead>
      <div>
        {ordered.map(([letter, items]) => (
          <BowlGroup key={letter ?? "—"} letter={letter} color={color}>
            {items.map((r) => (
              <Row key={r.key} row={r} />
            ))}
          </BowlGroup>
        ))}
      </div>
      {pantry.length > 0 && (
        <details className="group border-y border-line" open={pantry.some((r) => r.status !== "same")}>
          <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 text-body font-bold text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
            <Icon name="chev" size="s" className="transition-transform duration-[var(--dur-2)] ease-[var(--ease-out)] group-open:rotate-90" />
            Placard, à vérifier chez toi
            <span className="num font-normal text-faint">{pantry.length}</span>
          </summary>
          <div className="pb-3">
            {pantry.map((r) => (
              <Row key={r.key} row={r} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

// ─── Étapes ───

export function StepsList({ steps, before, color }: { steps: RecipeInput["steps"]; before?: RecipeInput["steps"] | null; color: RecipeColor }) {
  const known = new Set((before ?? []).map((s) => s.text.trim()));
  return (
    <ol>
      {steps.map((s, k) => {
        const fresh = before != null && !known.has(s.text.trim());
        return (
          <StepItem
            key={`${k}-${s.text.slice(0, 20)}`}
            n={k + 1}
            color={color}
            fresh={fresh}
            badge={fresh ? <span className="text-ink">réécrite</span> : null}
            step={{
              kind: s.kind,
              text: s.text,
              durationMin: s.durationMin,
              hobLevel: s.hobLevel,
              ovenTemp: s.ovenTemp,
              equipment: s.equipmentId ? { label: equipmentLabel(s.equipmentId), icon: equipmentIcon(null, s.equipmentId) } : null,
              bowls: s.bowls ?? [],
              cue: s.cue,
              phases: s.phases,
            }}
          />
        );
      })}
    </ol>
  );
}

// ─── Vérifications, restes ───

export function Checks({ v, duplicate }: { v: Verification; duplicate?: { slug: string; name: string; why: string } | null }) {
  const checked = v.rows.filter((r) => r.check);
  const ok = checked.filter((r) => r.check!.state === "ok").length;
  const toCheck = checked.length - ok - v.blocked.length;
  const tally = [`${ok} au catalogue`, toCheck > 0 ? `${toCheck} à vérifier` : null, v.blocked.length ? `${v.blocked.length} à remplacer` : null].filter(Boolean).join(" · ");
  return (
    <Notes
      title={checked.length > 0 ? <span className="num">{`${checked.length} ingrédient${checked.length > 1 ? "s" : ""} vérifié${checked.length > 1 ? "s" : ""} au drive : ${tally}`}</span> : undefined}
      items={[
        ...(duplicate
          ? [
              {
                tone: "info" as const,
                key: "dup",
                text: (
                  <>
                    <b>Trop proche de </b>
                    <Link href={`/recettes/${duplicate.slug}`} className="font-bold text-accent underline decoration-1 underline-offset-4 hover:decoration-2">
                      {duplicate.name}
                    </Link>{" "}
                    ({duplicate.why}). Change un aliment principal avant d’enregistrer.
                  </>
                ),
              },
            ]
          : []),
        ...(v.blocked.length ? [{ tone: "ko" as const, key: "blocked", text: <><b>Indisponible.</b> {v.blocked.join(", ")} : ni produit au catalogue, ni remplaçant.</> }] : []),
        ...v.warnings.map((w) => ({ tone: "warn" as const, key: w, text: w })),
      ]}
    />
  );
}

/** Anti-gaspillage : un paquet qui ne sera plus utilisé en entier, et où mettre le reste. */
type Suggestion = Leftover["suggestions"][number] & { usesG?: number | null; fits?: boolean };

/**
 * Reste de paquet : d'abord les recettes de la bibliothèque qui le finissent (celle qui en prend le plus près
 * du reste en bouton principal, avec ce qu'elle en prend), puis « une recette pour le reste » dans l'atelier.
 */
export function Leftovers({ items }: { items: (Omit<Leftover, "suggestions"> & { suggestions: Suggestion[] })[] }) {
  if (!items.length) return null;
  return (
    <div className="grid">
      {items.map((l, k) => {
        const what = l.item.split(",")[0].toLowerCase();
        const best = l.suggestions.find((s) => s.fits !== false) ?? null;
        return (
          <div key={`${k}-${l.item}`} className="grid gap-3 border-t border-line py-4">
            <p className="flex items-start gap-3">
              <Icon name="leaf" className="mt-1 shrink-0 text-faint" />
              <span className="grid gap-1">
                <b className="num text-body">Il restera {l.restG}{"\u202f"}g de {what}</b>
                <span className="num text-small text-ink-2">
                  {l.usedG}{"\u202f"}g utilisés sur {l.orderedG}{"\u202f"}g achetés.
                  {best ? " À finir dans une recette de la bibliothèque :" : ""}
                </span>
              </span>
            </p>
            <span className="flex flex-wrap gap-2 pl-9">
              {l.suggestions.map((s) => (
                <Link key={s.slug} href={`/recettes/${s.slug}`} className={buttonClass({ size: "sm", variant: s === best ? "secondary" : "quiet" })} title={s.usesG != null ? `${s.name} en prend ${s.usesG} g` : s.name}>
                  {s.name}
                  {s.usesG != null && <span className="num font-normal text-ink-2">· {s.usesG}{"\u202f"}g</span>}
                </Link>
              ))}
              <Link href={`/atelier?envie=${encodeURIComponent(`Une recette qui utilise ${l.restG} g de ${what}`)}`} className={buttonClass({ size: "sm", variant: l.suggestions.length ? "quiet" : "secondary" })}>
                <Icon name="sparkdraft" size="s" />
                {l.suggestions.length ? "Ou une nouvelle recette" : "Une recette pour le reste"}
              </Link>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export type { Ing };
