"use client";

// Affichage du bloc nutrition (DA « Plan de travail ») : un segment par mangeur (sa part en unités, tirée
// de sa cible : src/lib/eaters), jauges énergie et protéines avec la zone de son repère,
// glucides-lipides-fibres, ce qui pèse le plus, ce qui ne se mange pas.
// Avec `before`, c’est la vue « avant → après » d’une variante : chiffres qui glissent, repère de l’ancienne valeur.
import { useEffect, useRef, useState } from "react";
import { Card, Gauge, Icon, Segmented, verdictTone, verdictWord } from "@/components/ui";
import { proteinShare, type Macros } from "@/lib/nutrition/compute";
import { unitsLabel, verdictOf, type MealRef } from "@/lib/eaters/core";
import { CardTitle } from "./RecipeParts";
import { HowCalculated } from "./fiche/Block";
import { deName } from "./fiche/words";
import type { NutritionData } from "./Nutrition";

/** Un mangeur affiché : sa part (unités) et son repère d’un repas (null = sans repère). */
export type NutritionPerson = { id: string; name: string; units: number; ref: MealRef | null };
type Portions = Record<string, Macros>;

/** Un nombre qui glisse de sa valeur précédente à la nouvelle. */
export function AnimatedNumber({ value, from, decimals = 0 }: { value: number; from?: number; decimals?: number }) {
  const [shown, setShown] = useState(from ?? value);
  const last = useRef(from ?? value);
  useEffect(() => {
    const start = last.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 800);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(start + (value - start) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
      else last.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown.toLocaleString("fr-FR", { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}</>;
}

/** Jauge dont la valeur glisse depuis `before` (la barre part de l’ancienne largeur). */
function MovingGauge({ before, value, ...rest }: Omit<React.ComponentProps<typeof Gauge>, "display"> & { before?: number | null }) {
  const [w, setW] = useState(before ?? value);
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(value));
    return () => cancelAnimationFrame(id);
  }, [value]);
  return <Gauge {...rest} value={w} before={before != null && Math.round(before) !== Math.round(value) ? before : null} display={<AnimatedNumber value={value} from={before ?? undefined} />} />;
}

const diffWord = (d: number, unit: string) => (d === 0 ? "" : `${d > 0 ? "+" : "−"}${Math.abs(Math.round(d))} ${unit}`);

const NB = "\u00a0";

export function NutritionView({
  data,
  portions,
  before,
  people,
  title = "Nutrition par part",
  footer = true,
  bare = false,
  coverage: coverage0,
}: {
  coverage?: number | null;
  data?: NutritionData;
  portions?: Portions;
  before?: Portions | null;
  /** Les mangeurs et leur part ; sans, la première clé des parts, sans repère. */
  people?: NutritionPerson[];
  title?: string;
  footer?: boolean;
  /** Sans carte ni titre : posé dans une section à filet de la fiche. */
  bare?: boolean;
}) {
  const list: NutritionPerson[] = people?.length ? people : Object.keys(portions ?? data?.portions ?? { part: 0 }).map((id) => ({ id, name: "Une part", units: 4, ref: null }));
  const [who, setWho] = useState<string>(list[0].id);
  const P = list.find((x) => x.id === who) ?? list[0];
  const p = portions ?? data!.portions;
  const m = p[P.id];
  const b = before?.[P.id] ?? null;
  const ref = P.ref;
  const v = ref ? verdictOf(ref, m) : null;
  const kTone = v ? verdictTone(v.kcal) : undefined;
  const pTone = v ? verdictTone(v.protein) : undefined;
  const kGap = !ref ? "" : m.kcal > ref.kcalMax ? `${Math.round(m.kcal - ref.kcalMax)}${NB}kcal au-dessus` : m.kcal < ref.kcalMin ? `${Math.round(ref.kcalMin - m.kcal)}${NB}kcal sous la cible` : "dans la cible";
  const ratio = P.units;
  const coverage = coverage0 ?? data?.coverage ?? null;
  const totalK = Math.max(1, m.kcal);

  const body = (
    <>
      {list.length > 1 && <Segmented<string> label="Part de qui" value={P.id} onChange={setWho} options={list.map((x) => ({ value: x.id, label: `${x.name} · ${unitsLabel(x.units)}` }))} />}
      <MovingGauge
        label="Énergie"
        value={m.kcal}
        before={b?.kcal}
        unit="kcal"
        max={Math.max(1000, m.kcal * 1.08, b?.kcal ?? 0)}
        target={ref ? [ref.kcalMin, ref.kcalMax] : undefined}
        tone={kTone}
        left={ref ? (b ? `${kGap} · ${diffWord(m.kcal - b.kcal, "kcal")}` : kGap) : b ? diffWord(m.kcal - b.kcal, "kcal") : "sans repère"}
        right={ref ? `cible ${ref.kcalMin} à ${ref.kcalMax}` : null}
      />
      <MovingGauge
        label="Protéines"
        value={m.protein}
        before={b?.protein}
        unit="g"
        max={Math.max(80, m.protein * 1.08, b?.protein ?? 0)}
        target={ref ? [ref.proteinMin, ref.proteinMax] : undefined}
        tone={pTone}
        left={v ? `${verdictWord(v.protein)}${b ? ` · ${diffWord(m.protein - b.protein, "g")}` : ""}` : b ? diffWord(m.protein - b.protein, "g") : `${Math.round(proteinShare(m) * 100)}${NB}% des kcal`}
        right={ref ? `${ref.proteinMin} à ${ref.proteinMax}${NB}g` : null}
      />
      <dl className="grid grid-cols-3 border-y border-line">
        {(
          [
            ["glucides", m.carbs, b?.carbs],
            ["lipides", m.fat, b?.fat],
            ["fibres", m.fiber, b?.fiber],
          ] as const
        ).map(([l, val, old], i) => (
          <div key={l} className={`grid gap-1 py-3 ${i > 0 ? "border-l border-line pl-4" : ""}`}>
            <dt className="label order-2 text-ink-2">{l}</dt>
            <dd className="num-tight order-1 text-h3">
              <AnimatedNumber value={Math.round(val)} from={old != null ? Math.round(old) : undefined} />
              {NB}g
              {old != null && Math.round(old) !== Math.round(val) && <span className="num ml-2 text-small font-normal text-faint line-through">{Math.round(old)}</span>}
            </dd>
          </div>
        ))}
      </dl>

      {data && data.contrib.length > 0 && (
        <div>
          <h3 className="mb-3 text-h3">Ce qui pèse dans la part{list.length > 1 ? ` ${deName(P.name)}` : ""}</h3>
          <ul className="border-t border-line">
            {data.contrib.map((c) => {
              const pc = Math.round(((c.kcal * ratio) / totalK) * 100);
              return (
                <li key={c.item} className="grid grid-cols-[minmax(0,1fr)_minmax(48px,96px)_3rem] items-center gap-3 border-b border-line py-3 text-small last:border-b-0">
                  <span className="min-w-0">
                    <span className="block truncate text-body">{c.item.split(/[,(]/)[0].trim()}</span>
                    <span className="num block text-faint">
                      {Math.round(c.kcal * ratio)}
                      {NB}kcal · {Math.round(c.protein * ratio)}
                      {NB}g de protéines
                    </span>
                  </span>
                  <span className="h-1 overflow-hidden bg-surface-2">
                    <i className="block h-full bg-ink-2" style={{ width: `${Math.min(100, pc)}%` }} />
                  </span>
                  <span className="num-tight text-right text-body">
                    {pc}
                    {NB}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {coverage != null && coverage < 1 && (
        <p className="flex items-start gap-2 text-small text-warn-ink">
          <Icon name="alert" size="s" className="mt-0.5 shrink-0 text-warn" />
          <span>
            {Math.round(coverage * 100)}
            {NB}% des ingrédients comptés : les autres n’ont pas encore de valeurs, ces chiffres sont un plancher.
          </span>
        </p>
      )}

      {(footer || (data && data.notEaten.length > 0)) && (
        <HowCalculated>
          {data && data.notEaten.length > 0 && (
            <div>
              <p className="font-semibold text-ink">Ce qui ne se mange pas, déjà retiré</p>
              <ul>
                {data.notEaten.map((x) => (
                  <li key={x.key} className="border-b border-line py-2 last:border-b-0">
                    <span className="flex justify-between gap-3">
                      <span className="min-w-0">{x.text}</span>
                      {x.kcalUnit * ratio >= 1 && (
                        <span className="num shrink-0">
                          −{Math.round(x.kcalUnit * ratio)}
                          {NB}kcal
                        </span>
                      )}
                    </span>
                    {x.note && <span className="block text-faint">{x.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {footer && (
            <p>
              {before
                ? "Recalculé en code depuis les grammes (table Ciqual), jamais repris de l’IA. Trait fin : la valeur d’avant."
                : `Calculé en code sur ce qui est mangé : grammes de la fiche (table Ciqual, crus), moins la part du paquet non utilisée, la parure (os, peau, couenne) et le gras qui reste dans la poêle. La part de chacun = son repère d’un repas ÷ kcal d’une unité, au demi près. ${list
                    .filter((x) => x.ref)
                    .map((x) => `Repère ${deName(x.name)} : ${x.ref!.kcalMin} à ${x.ref!.kcalMax}${NB}kcal, ${x.ref!.proteinMin} à ${x.ref!.proteinMax}${NB}g de protéines.`)
                    .join(" ")}`}
            </p>
          )}
        </HowCalculated>
      )}
    </>
  );

  if (bare) return <div className="grid gap-6">{body}</div>;
  return (
    <Card as="section" pad="md" className="grid gap-4">
      <CardTitle aside={before ? <span className="text-small text-ink-2">avant → après</span> : null}>{title}</CardTitle>
      {body}
    </Card>
  );
}
