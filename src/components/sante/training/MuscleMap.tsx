"use client";

// Carte des muscles d'un exercice (séance guidée sur grand écran, consignes) : le corps de face et de dos,
// chaque muscle teinté selon ce qu'il travaille (cible, aide, stabilise). Pendant le rythme guidé, les
// muscles cibles s'allument au tempo du geste (`effort` : 0 en haut du mouvement, 1 dans la position la
// plus dure), avec la même horloge que la figure. Dessin : src/lib/training/body.ts ; données : muscles.ts.
import { BACK, BODY_LIMBS, BODY_MIRROR, BODY_SHAPES, BODY_VIEWBOX, FRONT } from "@/lib/training/body";
import { MUSCLE_LABEL, musclesOf, ranked, type Load, type Muscle, type MuscleLoad } from "@/lib/training/muscles";
import type { Exercise } from "@/lib/training/program";
import { useReducedMotion } from "./KbFigure";

const BASE: Record<Load, number> = { 3: 1, 2: 0.55, 1: 0.28 };

function Half({ regions, load, effort }: { regions: Partial<Record<Muscle, string>>; load: MuscleLoad; effort: number }) {
  return (
    <>
      <g className="fill-surface-2 stroke-surface-2" strokeLinecap="round">
        {BODY_SHAPES.map((d) => (
          <path key={d} d={d} strokeWidth={0} />
        ))}
        {BODY_LIMBS.map((l, i) => (
          <line key={i} x1={l.a[0]} y1={l.a[1]} x2={l.b[0]} y2={l.b[1]} strokeWidth={l.w} />
        ))}
      </g>
      {(Object.entries(regions) as [Muscle, string][]).map(([m, d]) => {
        const w = load[m];
        // Les cibles respirent avec le geste ; les autres restent posées.
        const op = w ? (w === 3 ? 0.62 + 0.38 * effort : BASE[w]) : 1;
        return <path key={m} d={d} className={`${w ? "fill-accent" : "fill-line"} stroke-bg`} strokeWidth={0.9} fillOpacity={op} strokeLinejoin="round" />;
      })}
    </>
  );
}

function Body({ regions, load, effort, label }: { regions: Partial<Record<Muscle, string>>; load: MuscleLoad; effort: number; label: string }) {
  return (
    <figure className="grid justify-items-center gap-1">
      <svg viewBox={BODY_VIEWBOX} className="block h-auto w-full" aria-hidden>
        <Half regions={regions} load={load} effort={effort} />
        <g transform={BODY_MIRROR}>
          <Half regions={regions} load={load} effort={effort} />
        </g>
      </svg>
      <figcaption className="label text-ink-3">{label}</figcaption>
    </figure>
  );
}

export function MuscleMap({ ex, exercise, effort = 0, active = false, className = "" }: { ex: string; exercise?: Pick<Exercise, "muscles"> | null; effort?: number; active?: boolean; className?: string }) {
  const reduced = useReducedMotion();
  const load = musclesOf(ex, exercise);
  const list = ranked(load);
  if (!list.length) return null;
  const e = reduced || !active ? 0.6 : Math.max(0, Math.min(1, effort));
  const main = list.filter((x) => x.w === 3).map((x) => MUSCLE_LABEL[x.m]);
  const help = list.filter((x) => x.w === 2).map((x) => MUSCLE_LABEL[x.m]);
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-3 ${className}`} role="img" aria-label={`Travaille surtout : ${main.join(", ")}${help.length ? ` ; aussi : ${help.join(", ")}` : ""}`}>
      <Body regions={FRONT} load={load} effort={e} label="Face" />
      <Body regions={BACK} load={load} effort={e} label="Dos" />
      <dl className="grid content-center gap-3 text-small">
        <div>
          <dt className="label flex items-center gap-2 text-ink-2">
            <span className="size-2.5 rounded-full bg-accent" aria-hidden /> Travaille surtout
          </dt>
          <dd className="mt-1 font-bold text-ink">{main.join(", ")}</dd>
        </div>
        {help.length > 0 && (
          <div>
            <dt className="label flex items-center gap-2 text-ink-2">
              <span className="size-2.5 rounded-full bg-accent opacity-55" aria-hidden /> Aide
            </dt>
            <dd className="mt-1 text-ink-2">{help.join(", ")}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
