// Textes des graphiques de la vue d'ensemble : titre d'un paquet, repères sous les barres, moyenne de la période.
import { dateFmt, fmtDay } from "@/components/ui/charts/core";
import type { Bucket, Grain } from "@/lib/health/series";

/** « lun. 3 nov. », « semaine du 27 oct. », « octobre 2026 ». */
export function bucketTitle(start: string, grain: Grain) {
  if (grain === "day") return fmtDay(start, "weekday");
  if (grain === "week") return `semaine du ${fmtDay(start)}`;
  return dateFmt("month-long", { month: "long", year: "numeric" }).format(new Date(`${start}T12:00:00Z`));
}

/** « par jour », « par semaine », « par mois ». */
export const per = (grain: Grain) => ({ day: "par jour", week: "par semaine", month: "par mois" })[grain];

/**
 * Repères sous les barres : les jours (7 j), les lundis (30 j), le début des mois (semaines), le début des
 * années ou des trimestres (mois). Au plus `max`, le plus récent gardé.
 */
export function bucketTicks(buckets: Pick<Bucket, "start">[], grain: Grain, max = 6): { i: number; label: string }[] {
  const all = buckets.flatMap((b, i) => {
    const d = b.start;
    const prev = buckets[i - 1]?.start;
    if (grain === "day") return buckets.length <= 10 ? [{ i, label: fmtDay(d, "weekday").split(" ")[0] }] : new Date(`${d}T00:00:00Z`).getUTCDay() === 1 ? [{ i, label: fmtDay(d) }] : [];
    if (grain === "week") return !prev || prev.slice(5, 7) !== d.slice(5, 7) ? [{ i, label: d.slice(5, 7) === "01" || (!prev && buckets.length > 30) ? d.slice(0, 4) : fmtDay(d, "month") }] : [];
    return d.slice(5, 7) === "01" ? [{ i, label: d.slice(0, 4) }] : buckets.length <= 14 ? [{ i, label: fmtDay(d, "month") }] : [];
  });
  if (all.length <= max) return all;
  const every = Math.ceil(all.length / max);
  return all.filter((_, k) => (all.length - 1 - k) % every === 0);
}

/** Moyenne de la période : par jour mesuré (`mean`) ou par paquet (`sum`). */
export function periodMean(buckets: Bucket[], mode: "mean" | "sum"): number | null {
  const xs = buckets.filter((b) => b.value != null);
  if (!xs.length) return null;
  if (mode === "sum") return xs.reduce((s, b) => s + b.value!, 0) / buckets.length;
  const n = xs.reduce((s, b) => s + b.n, 0);
  return n ? xs.reduce((s, b) => s + b.value! * b.n, 0) / n : null;
}
