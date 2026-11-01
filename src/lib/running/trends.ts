// Tendances (docs/course.md § 3.8) : volume par semaine empilé par intensité, régularité, sortie la plus
// longue, allure en Z2 et EF en médiane glissante, répartition sur 4 semaines, alerte de volume (§ 2.7). Pur.
import { EASY_SHARE_MIN, REGULAR_MIN_RUNS, REGULAR_WEEKS, TREND_WEEKS, WEEK_SPIKE_RATIO } from "./constants";
import { addDays, daysBetween, mean, median, mondayOfDay, round } from "./dates";

export interface RunPoint {
  date: string;
  minutes: number;
  km: number | null;
  seiler?: { easy: number; moderate: number; hard: number } | null;
  z2Speed?: number | null;
  ef?: number | null;
  /** Sortie à exclure des tendances (chaleur, FC douteuse). */
  excluded?: boolean;
  deload?: boolean;
}

export interface WeekVolume {
  weekStart: string;
  runs: number;
  minutes: number;
  km: number;
  /** Minutes de course par intensité (si la FC est connue), le reste en « inconnu ». */
  easyMin: number;
  moderateMin: number;
  hardMin: number;
  unknownMin: number;
  longestMin: number;
  longestKm: number | null;
}

/** Les `weeks` dernières semaines (lundi–dimanche) jusqu'à celle de `today` incluse. */
export function weeklyVolume(runs: RunPoint[], today: string, weeks: number): WeekVolume[] {
  const last = mondayOfDay(today);
  const out: WeekVolume[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = addDays(last, -7 * i);
    const xs = runs.filter((r) => r.date >= ws && r.date < addDays(ws, 7));
    let easy = 0;
    let moderate = 0;
    let hard = 0;
    let unknown = 0;
    for (const r of xs) {
      const s = r.seiler;
      const tot = s ? s.easy + s.moderate + s.hard : 0;
      if (!s || !tot) {
        unknown += r.minutes;
        continue;
      }
      easy += (r.minutes * s.easy) / tot;
      moderate += (r.minutes * s.moderate) / tot;
      hard += (r.minutes * s.hard) / tot;
    }
    const kms = xs.map((r) => r.km).filter((k): k is number => k != null);
    out.push({
      weekStart: ws,
      runs: xs.length,
      minutes: round(xs.reduce((s, r) => s + r.minutes, 0)),
      km: round(kms.reduce((s, k) => s + k, 0), 1),
      easyMin: round(easy),
      moderateMin: round(moderate),
      hardMin: round(hard),
      unknownMin: round(unknown),
      longestMin: round(Math.max(0, ...xs.map((r) => r.minutes))),
      longestKm: kms.length ? round(Math.max(...kms), 2) : null,
    });
  }
  return out;
}

/** Semaines avec au moins 2 sorties sur les 8 dernières (semaine en cours exclue). */
export function regularity(runs: RunPoint[], today: string): { weeks: number; of: number } {
  const ws = weeklyVolume(runs, addDays(mondayOfDay(today), -1), REGULAR_WEEKS);
  return { weeks: ws.filter((w) => w.runs >= REGULAR_MIN_RUNS).length, of: REGULAR_WEEKS };
}

/** Une valeur par sortie, et sa médiane glissante sur 6 semaines (sorties exclues mises de côté). */
export function rollingMedian(points: { date: string; value: number | null; excluded?: boolean }[]): { date: string; value: number; median: number }[] {
  const xs = points.filter((p): p is { date: string; value: number; excluded?: boolean } => p.value != null && !p.excluded).sort((a, b) => a.date.localeCompare(b.date));
  return xs.map((p) => ({ date: p.date, value: p.value, median: round(median(xs.filter((q) => q.date <= p.date && daysBetween(q.date, p.date) < 7 * TREND_WEEKS).map((q) => q.value))!, 3) }));
}

/** Répartition de l'intensité sur les 4 dernières semaines, contre la cible 80 / 20. */
export function intensityShare(runs: RunPoint[], today: string): { easy: number; moderate: number; hard: number; ok: boolean } | null {
  let e = 0;
  let m = 0;
  let h = 0;
  for (const r of runs) {
    if (r.date > today || daysBetween(r.date, today) >= 28 || !r.seiler) continue;
    e += r.seiler.easy;
    m += r.seiler.moderate;
    h += r.seiler.hard;
  }
  const tot = e + m + h;
  if (!tot) return null;
  return { easy: round(e / tot, 3), moderate: round(m / tot, 3), hard: round(h / tot, 3), ok: e / tot >= EASY_SHARE_MIN };
}

/** Volume réellement couru d'une semaine au-delà de 1,30 × la moyenne des 2 précédentes. */
export function weekSpike(weeks: WeekVolume[]): { weekStart: string; ratio: number } | null {
  if (weeks.length < 3) return null;
  const [a, b, c] = weeks.slice(-3);
  const ref = mean([a.minutes, b.minutes])!;
  if (!ref) return null;
  const ratio = c.minutes / ref;
  return ratio > WEEK_SPIKE_RATIO ? { weekStart: c.weekStart, ratio: round(ratio, 2) } : null;
}
