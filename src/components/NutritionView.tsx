"use client";

// Affichage du bloc nutrition (DA « Plan de travail ») : un segment par mangeur (sa part en unités, tirée
// de sa cible : src/lib/eaters), jauges énergie et protéines avec la zone de son repère,
// glucides-lipides-fibres, ce qui pèse le plus, ce qui ne se mange pas.
// Avec `before`, c'est la vue « avant → après » d'une variante : chiffres qui glissent, repère de l'ancienne valeur.
import { useEffect, useRef, useState } from "react";
import { Alert, Card, Gauge, Segmented, verdictTone, verdictWord } from "@/components/ui";
import { proteinShare, type Macros } from "@/lib/nutrition/compute";
import { unitsLabel, verdictOf, type MealRef } from "@/lib/eaters/core";
import { CardTitle, Eyebrow } from "./RecipeParts";
import type { NutritionData } from "./Nutrition";

/** Un mangeur affiché : sa part (unités) et son repère d'un repas (null = sans repère). */
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

/** Jauge dont la valeur glisse depuis `before` (la barre part de l'ancienne largeur). */
function MovingGauge({ before, value, ...rest }: Omit<React.ComponentProps<typeof Gauge>, "display"> & { before?: number | null }) {
  const [w, setW] = useState(before ?? value);
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(value));
    return () => cancelAnimationFrame(id);
  }, [value]);
  return <Gauge {...rest} value={w} before={before != null && Math.round(before) !== Math.round(value) ? before : null} display={<AnimatedNumber value={value} from={before ?? undefined} />} />;
}

const diffWord = (d: number, unit: string) => (d === 0 ? "" : `${d > 0 ? "+" : "−"}${Math.abs(Math.round(d))} ${unit}`);

export function NutritionView({
  data,
  portions,
  before,
  people,
  title = "Nutrition par part",
  footer = true,
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
  const kGap = !ref ? "" : m.kcal > ref.kcalMax ? `au-dessus de ${Math.round(m.kcal - ref.kcalMax)} kcal` : m.kcal < ref.kcalMin ? `sous la cible de ${Math.round(ref.kcalMin - m.kcal)} kcal` : "dans la cible";
  const ratio = P.units;
  const coverage = coverage0 ?? data?.coverage ?? null;
  const totalK = Math.max(1, m.kcal);

  return (
    <Card as="section" pad="md" className="grid gap-3.5">
      <CardTitle aside={before ? <span className="text-[13px] text-ink-2">avant → après</span> : null}>{title}</CardTitle>
      <Segmented<string> label="Part de qui" value={P.id} onChange={setWho} options={list.map((x) => ({ value: x.id, label: `${x.name} · ${unitsLabel(x.units)}` }))} />
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
        left={v ? `${verdictWord(v.protein)}${b ? ` · ${diffWord(m.protein - b.protein, "g")}` : ""}` : b ? diffWord(m.protein - b.protein, "g") : `${Math.round(proteinShare(m) * 100)} % des kcal`}
        right={ref ? `${ref.proteinMin} à ${ref.proteinMax} g` : null}
      />
      <div className="grid grid-cols-3 gap-2 text-[13px] text-ink-2">
        {(
          [
            ["glucides", m.carbs, b?.carbs],
            ["lipides", m.fat, b?.fat],
            ["fibres", m.fiber, b?.fiber],
          ] as const
        ).map(([l, val, old]) => (
          <div key={l}>
            <b className="num text-[17px] text-ink">
              <AnimatedNumber value={Math.round(val)} from={old != null ? Math.round(old) : undefined} /> g
            </b>
            {old != null && Math.round(old) !== Math.round(val) && <span className="num ml-1 text-faint line-through">{Math.round(old)}</span>}
            <br />
            {l}
          </div>
        ))}
      </div>
      {ref && <p className="text-[13px] text-ink-2">Protéines : {Math.round(proteinShare(m) * 100)} % des kcal.</p>}

      {data && data.contrib.length > 0 && (
        <div>
          <Eyebrow className="mb-2">Ce qui pèse le plus · part de {P.name}</Eyebrow>
          <div className="grid gap-2">
            {data.contrib.map((c) => {
              const pc = Math.round(((c.kcal * ratio) / totalK) * 100);
              return (
                <div key={c.item} className="grid grid-cols-[minmax(0,1fr)_minmax(56px,100px)_40px] items-center gap-2.5 text-[14px]">
                  <span className="min-w-0">
                    <span className="block truncate">{c.item}</span>
                    <span className="num block text-[12px] text-faint">
                      {Math.round(c.kcal * ratio)} kcal · {Math.round(c.protein * ratio)} g prot.
                    </span>
                  </span>
                  <span className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <i className="block h-full rounded-full bg-ink-2" style={{ width: `${Math.min(100, pc)}%` }} />
                  </span>
                  <span className="num text-right">{pc} %</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data && data.notEaten.length > 0 && (
        <div>
          <Eyebrow className="mb-1.5">Ce qui ne se mange pas</Eyebrow>
          {data.notEaten.map((x) => (
            <div key={x.key} className="border-b border-dashed border-line py-1.5 text-[14px] last:border-b-0">
              <div className="flex justify-between gap-2.5">
                <span className="min-w-0">{x.text}</span>
                {x.kcalUnit * ratio >= 1 && <span className="num shrink-0">−{Math.round(x.kcalUnit * ratio)} kcal</span>}
              </div>
              {x.note && <div className="text-[13px] text-ink-2">{x.note}</div>}
            </div>
          ))}
          <p className="pt-1 text-[13px] text-faint">déjà déduit des chiffres ci-dessus</p>
        </div>
      )}

      {coverage != null && coverage < 1 && (
        <Alert tone="warn" title={`${Math.round(coverage * 100)} % des ingrédients pris en compte`}>
          Les autres n&apos;ont pas encore de valeurs nutritionnelles : les chiffres sont un plancher.
        </Alert>
      )}
      {footer && (
        <p className="text-[12px] leading-snug text-faint">
          {before
            ? "Recalculé en code depuis les grammes (table Ciqual), jamais repris de l'IA. Trait fin : la valeur d'avant."
            : `Calculé en code sur ce qui est mangé : grammes de la fiche (table Ciqual, crus), moins la part du paquet non utilisée, la parure (os, peau, couenne) et le gras qui reste dans la poêle. Part de chacun = son repère d'un repas ÷ kcal d'une unité, au demi près. ${list
                .filter((x) => x.ref)
                .map((x) => `Repère ${x.name} : ${x.ref!.kcalMin}-${x.ref!.kcalMax} kcal, ${x.ref!.proteinMin}-${x.ref!.proteinMax} g de protéines.`)
                .join(" ")}`}
        </p>
      )}
    </Card>
  );
}
