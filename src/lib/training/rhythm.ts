// Guide visuel du rythme : une courbe qui défile, et une bille posée dessus, comme l'écran de certaines
// machines de sport. La hauteur suit la pose visée (en haut = pose de départ, en bas = la pose la plus
// éloignée), avec la même courbe d'accélération que la figure : la bille monte et descend exactement
// quand le geste et les bips le demandent, et la suite du parcours se voit d'avance.
// Même horloge que la figure (`t`, en secondes depuis le départ). Module pur (tests/training.test.ts).
import { cycleDuration, ease, type Motion } from "./motion";

/** Hauteur d'une pose clé, de 1 (pose de départ, en haut) à 0 (la dernière pose, en bas). */
export const keyLevel = (m: Motion, key: number) => (m.keys.length <= 1 ? 1 : 1 - key / (m.keys.length - 1));

/**
 * Hauteur de la bille à l'instant `t`. Avant 0 et après `end` (fin de la série), elle attend sur la pose
 * de départ. Une étape qui vise la pose où l'on est déjà (une pause) donne un palier.
 */
export function heightAt(m: Motion, t: number, end: number | null = null): number {
  if (!m.steps.length) return 1;
  if (t <= 0 || (end != null && t >= end)) return keyLevel(m, 0);
  const total = cycleDuration(m);
  let x = t % total;
  let from = 0;
  for (const s of m.steps) {
    if (x < s.dur) {
      const k = s.dur > 0 ? x / s.dur : 1;
      const a = keyLevel(m, from);
      return a + (keyLevel(m, s.to) - a) * ease(k);
    }
    x -= s.dur;
    from = s.to;
  }
  return keyLevel(m, from);
}

export interface RhythmMark {
  /** Instant où commence la phase, en secondes depuis le départ. */
  at: number;
  label: string;
  /** Début d'une répétition (le bip aigu). */
  rep: boolean;
}

/** Débuts de phase entre `from` et `to` (secondes), ceux qui sonnent ; rien après la fin de la série. */
export function marksBetween(m: Motion, from: number, to: number, end: number | null = null): RhythmMark[] {
  const total = cycleDuration(m);
  if (total <= 0) return [];
  const out: RhythmMark[] = [];
  const last = end != null ? Math.min(to, end) : to;
  for (let cycle = Math.max(0, Math.floor(from / total)); cycle * total <= last; cycle++) {
    let at = cycle * total;
    m.steps.forEach((s, i) => {
      if (at >= from && at < last && at >= 0) out.push({ at, label: s.label, rep: i === 0 });
      at += s.dur;
    });
  }
  return out;
}

/** Points de la courbe à dessiner, de `t - past` à `t + ahead` secondes : x en secondes relatives à `t`, h de 0 à 1. */
export function rhythmPath(m: Motion, t: number, past: number, ahead: number, end: number | null = null, step = 0.05): { x: number; h: number }[] {
  const out: { x: number; h: number }[] = [];
  for (let dt = -past; dt <= ahead + 1e-9; dt += step) out.push({ x: dt, h: heightAt(m, t + dt, end) });
  return out;
}
