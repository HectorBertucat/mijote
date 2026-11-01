// Nuits de sommeil à partir des phases envoyées par l'app (une ligne par phase, kind "sleep"). Pur.
// Une nuit porte la date du réveil (heure de Paris). L'iPhone et la montre écrivent parfois la même nuit :
// on fait l'union des intervalles, jamais la somme. Le détail (profond, paradoxal, essentiel) l'emporte sur
// « endormi » sans précision quand les deux existent pour la même nuit.
import { dayString } from "@/lib/days";
import { todayParis } from "./store";

export type Stage = "in_bed" | "asleep" | "core" | "deep" | "rem" | "awake";
export interface SleepSegment {
  stage: Stage;
  /** Instant ISO, ou déjà en millisecondes (lu par la base sur un long historique). */
  start: string | number;
  end: string | number;
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
  return unionSorted([...xs].sort((a, b) => a[0] - b[0]));
}

/** `unionMinutes` d'intervalles déjà rangés par début. */
function unionSorted(xs: [number, number][]): number {
  const s = xs.filter(([a, b]) => b > a);
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
  // Des dizaines de milliers de phases sur des années : chaque instant est lu une fois, et la date de Paris
  // (UTC+1 ou +2) ne demande le fuseau qu'à l'heure de minuit, quand les deux décalages donnent deux jours.
  const by = new Map<string, { stage: Stage; iv: [number, number] }[]>();
  for (const s of segments) {
    const iv: [number, number] = [typeof s.start === "number" ? s.start : Date.parse(s.start), typeof s.end === "number" ? s.end : Date.parse(s.end)];
    // Un réveil après 20 h compte pour la nuit suivante.
    const t = iv[1] + 4 * 3_600_000;
    const winter = Math.floor((t + 3_600_000) / 86_400_000);
    const d = winter === Math.floor((t + 7_200_000) / 86_400_000) ? dayString(winter) : todayParis(new Date(t));
    const xs = by.get(d);
    if (xs) xs.push({ stage: s.stage, iv });
    else by.set(d, [{ stage: s.stage, iv }]);
  }
  const iv = (xs: { iv: [number, number] }[]) => xs.map((s) => s.iv);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, xs]) => {
      // Rangées une fois par début : chaque union ci-dessous garde cet ordre.
      xs.sort((a, b) => a.iv[0] - b.iv[0]);
      const detailed = xs.some((s) => DETAIL.includes(s.stage));
      const asleep = xs.filter((s) => (detailed ? DETAIL.includes(s.stage) : s.stage === "asleep"));
      const stage = (st: Stage) => (detailed ? unionSorted(iv(xs.filter((s) => s.stage === st))) : null);
      return {
        date,
        asleepMin: unionSorted(iv(asleep)),
        inBedMin: unionSorted(iv(xs.filter((s) => s.stage !== "awake"))),
        deepMin: stage("deep"),
        remMin: stage("rem"),
        coreMin: stage("core"),
      };
    })
    .filter((n) => n.asleepMin > 0);
}

/** « 7 h 05 ». */
export const hm = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")}`;
