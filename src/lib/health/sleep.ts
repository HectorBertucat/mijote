// Nuits de sommeil à partir des phases envoyées par l'app (une ligne par phase, kind "sleep"). Pur.
// Une nuit porte la date du réveil (heure de Paris). L'iPhone et la montre écrivent parfois la même nuit :
// on fait l'union des intervalles, jamais la somme. Le détail (profond, paradoxal, essentiel) l'emporte sur
// « endormi » sans précision quand les deux existent pour la même nuit.
import { todayParis } from "./store";

export type Stage = "in_bed" | "asleep" | "core" | "deep" | "rem" | "awake";
export interface SleepSegment {
  stage: Stage;
  start: string;
  end: string;
}
export interface Night {
  date: string;
  asleepMin: number;
  inBedMin: number;
  /** Minutes par phase détaillée, si la montre les donne. */
  deepMin: number | null;
  remMin: number | null;
  coreMin: number | null;
}

/** Longueur de l'union d'intervalles, en minutes. */
export function unionMinutes(xs: [number, number][]): number {
  const s = [...xs].filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of s) {
    if (cur && a <= cur[1]) cur[1] = Math.max(cur[1], b);
    else {
      if (cur) total += cur[1] - cur[0];
      cur = [a, b];
    }
  }
  if (cur) total += cur[1] - cur[0];
  return Math.round(total / 60_000);
}

const DETAIL: Stage[] = ["core", "deep", "rem"];

/** Les nuits, de la plus ancienne à la plus récente. */
export function nights(segments: SleepSegment[]): Night[] {
  const by = new Map<string, SleepSegment[]>();
  for (const s of segments) {
    // Un réveil après 20 h compte pour la nuit suivante.
    const d = todayParis(new Date(Date.parse(s.end) + 4 * 3_600_000));
    by.set(d, [...(by.get(d) ?? []), s]);
  }
  const iv = (xs: SleepSegment[]) => xs.map((s) => [Date.parse(s.start), Date.parse(s.end)] as [number, number]);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, xs]) => {
      const detailed = xs.some((s) => DETAIL.includes(s.stage));
      const asleep = xs.filter((s) => (detailed ? DETAIL.includes(s.stage) : s.stage === "asleep"));
      const stage = (st: Stage) => (detailed ? unionMinutes(iv(xs.filter((s) => s.stage === st))) : null);
      return {
        date,
        asleepMin: unionMinutes(iv(asleep)),
        inBedMin: unionMinutes(iv(xs.filter((s) => s.stage !== "awake"))),
        deepMin: stage("deep"),
        remMin: stage("rem"),
        coreMin: stage("core"),
      };
    })
    .filter((n) => n.asleepMin > 0);
}

/** « 7 h 05 ». */
export const hm = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")}`;
