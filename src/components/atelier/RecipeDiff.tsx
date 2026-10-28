"use client";

// Briques visuelles de l'atelier (DA « Plan de travail ») : ingrédients par bol avant → après (barrés, ajoutés,
// quantités qui changent et se posent), jauges nutrition qui glissent, restes de paquet (anti-gaspillage), étapes.
import Link from "next/link";
import type { ReactNode } from "react";
import { Alert, buttonClass, Card, Icon, Pill, type RecipeColor } from "@/components/ui";
import { AnimatedNumber, NutritionView } from "@/components/NutritionView";
import { BowlGroup, CardTitle, equipmentIcon, equipmentLabel, fmtQty, IngLine, StepItem } from "@/components/RecipeParts";
import type { DiffRow, Leftover, Verification } from "@/lib/atelier";
import type { RecipeInput } from "@/lib/recipes/format";
import { FoodIllu } from "@/components/illus/Illu";

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

const STATE = {
  ok: { tone: "ok", text: "au catalogue" },
  warn: { tone: "warn", text: "à vérifier" },
  replace: { tone: "ko", text: "à remplacer" },
} as const;

/** Vérification catalogue d'une ligne : pastille d'état et produit retenu (lien vers le drive). */
function CheckLine({ row }: { row: DiffRow }) {
  const c = row.check;
  if (!c) return null;
  const s = STATE[c.state];
  return (
    <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-2">
      <Pill tone={s.tone} className="h-[22px] text-[12px]">
        {s.text}
      </Pill>
      {c.product && (
        <a href={c.product.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1.5 hover:text-ink">
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
      <IngLine art={art} qty={<span className="strike-out font-medium text-faint">{qtyBefore || "—"}</span>} name={<span className="strike-out text-faint">{ing.item}</span>} sub={<span className="text-[13px]">· retiré</span>} className="animate-flash rounded-[6px]" />
    );
  if (row.status === "added")
    return (
      <IngLine art={art} qty={<span className="inline-block animate-swap-in">{qtyAfter || "—"}</span>} name={<span className="inline-block animate-swap-in font-semibold">+ {ing.item}</span>} className="animate-flash rounded-[6px]">
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
        className="animate-flash rounded-[6px]"
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
  return (
    <Card as="section" pad="md" className="grid gap-1">
      <CardTitle
        aside={
          aside ??
          (counts.added + counts.changed + counts.removed > 0 ? (
            <span className="flex flex-wrap justify-end gap-1.5">
              {counts.added > 0 && (
                <Pill tone="ok" icon="plus">
                  {counts.added} ajouté{counts.added > 1 ? "s" : ""}
                </Pill>
              )}
              {counts.changed > 0 && (
                <Pill tone="idle" icon="swap">
                  {counts.changed} modifié{counts.changed > 1 ? "s" : ""}
                </Pill>
              )}
              {counts.removed > 0 && (
                <Pill tone="ko" icon="minus">
                  {counts.removed} retiré{counts.removed > 1 ? "s" : ""}
                </Pill>
              )}
            </span>
          ) : null)
        }
      >
        {title}
      </CardTitle>
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
        <details className="group mt-2 rounded-[12px] bg-surface-2 px-3.5 py-2.5" open={pantry.some((r) => r.status !== "same")}>
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[14px] font-semibold active:scale-100">
            <Icon name="chev" size="s" className="transition-transform group-open:rotate-90" />
            Placard, à vérifier chez toi
            <span className="num font-semibold text-faint">{pantry.length}</span>
          </summary>
          <div className="mt-1">
            {pantry.map((r) => (
              <Row key={r.key} row={r} />
            ))}
          </div>
        </details>
      )}
    </Card>
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
            badge={fresh ? <Pill tone="idle" icon="sparkdraft" className="h-5 normal-case tracking-normal">réécrite</Pill> : null}
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
  return (
    <div className="grid gap-2">
      {duplicate && (
        <Alert tone="info" title="Trop proche d'une recette de la bibliothèque">
          <Link href={`/recettes/${duplicate.slug}`} className="font-semibold text-accent underline-offset-2 hover:underline">
            {duplicate.name}
          </Link>{" "}
          ({duplicate.why}). Change un aliment principal avant d&apos;enregistrer.
        </Alert>
      )}
      {v.blocked.length > 0 && (
        <Alert tone="ko" title="Indisponible">
          {v.blocked.join(", ")} : ni produit au catalogue, ni remplaçant.
        </Alert>
      )}
      {checked.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-[14px] text-ink-2">
          <span className="num">
            {checked.length} ingrédient{checked.length > 1 ? "s" : ""} vérifié{checked.length > 1 ? "s" : ""} au drive
          </span>
          <Pill tone="ok">{ok} ok</Pill>
          {toCheck > 0 && <Pill tone="warn">{toCheck} à vérifier</Pill>}
          {v.blocked.length > 0 && <Pill tone="ko">{v.blocked.length} à remplacer</Pill>}
        </p>
      )}
      {v.warnings.map((w) => (
        <Alert key={w} tone="warn" className="py-2 text-[14px]">
          {w}
        </Alert>
      ))}
    </div>
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
    <div className="grid gap-2">
      {items.map((l, k) => {
        const what = l.item.split(",")[0].toLowerCase();
        const best = l.suggestions.find((s) => s.fits !== false) ?? null;
        return (
          <Alert key={`${k}-${l.item}`} tone="leaf" className="animate-swap-in" title={<span className="num">Il restera {l.restG} g de {what}</span>}>
            <span className="num">
              {l.usedG} g utilisés sur {l.orderedG} g achetés.
              {best ? " À finir dans une recette de la bibliothèque :" : ""}
            </span>
            <span className="mt-2 flex flex-wrap gap-1.5">
              {l.suggestions.map((s) => (
                <Link key={s.slug} href={`/recettes/${s.slug}`} className={buttonClass({ size: "sm", variant: s === best ? "secondary" : "quiet" })} title={s.usesG != null ? `${s.name} en prend ${s.usesG} g` : s.name}>
                  {s.name}
                  {s.usesG != null && <span className="num font-normal text-ink-2">· {s.usesG} g</span>}
                </Link>
              ))}
              <Link href={`/atelier?envie=${encodeURIComponent(`Une recette qui utilise ${l.restG} g de ${what}`)}`} className={buttonClass({ size: "sm", variant: l.suggestions.length ? "quiet" : "secondary" })}>
                <Icon name="sparkdraft" size="s" />
                {l.suggestions.length ? "Ou une nouvelle recette" : "Une recette pour le reste"}
              </Link>
            </span>
          </Alert>
        );
      })}
    </div>
  );
}

export type { Ing };
