// Séries d'une sortie (docs/course.md § 3.1) : FC remise à 1 Hz, nettoyée (plage, pics, verrouillage sur la
// cadence), pic de 30 s pour la FCmax observée ; vitesse et pente seconde par seconde tirées des temps au
// kilomètre (l'app n'envoie pas de trace, par choix de vie privée). Pur.
import {
  CADENCE_LOCK_BPM,
  CADENCE_LOCK_MIN_S,
  DOUBTFUL_SHARE,
  HR_VALID,
  PEAK_MIN_VALID_S,
  PEAK_WINDOW_S,
  RESAMPLE_MAX_GAP_S,
  SPIKE_BPM,
  SPIKE_WINDOW_S,
} from "./constants";
import { median } from "./dates";

/** [secondes depuis le début, bpm] */
export type HrPoint = [number, number];

export interface Split {
  /** Kilomètre atteint (cumulé) ; décimal pour le dernier, partiel. */
  km: number;
  /** Temps du tronçon, en secondes actives. */
  sec: number;
  hrAvg?: number;
  elevGainM?: number;
  elevLossM?: number;
}

export interface PauseEvent {
  type: string;
  t: number;
  durSec?: number;
}

/** Une valeur par seconde (null = pas de mesure). */
export type Hz = (number | null)[];

/** Remet une série irrégulière à 1 Hz : interpolation linéaire entre deux mesures à 10 s au plus, sinon trou. */
export function resample(points: HrPoint[], durationS?: number): Hz {
  const pts = [...points].filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v) && t >= 0).sort((a, b) => a[0] - b[0]);
  if (!pts.length) return [];
  const end = Math.max(Math.round(pts[pts.length - 1][0]), durationS != null ? Math.round(durationS) : 0);
  const out: Hz = new Array(end + 1).fill(null);
  let i = 0;
  for (let s = 0; s <= end; s++) {
    while (i < pts.length - 1 && pts[i + 1][0] <= s) i++;
    const [t0, v0] = pts[i];
    if (Math.round(t0) === s) {
      out[s] = v0;
      continue;
    }
    const next = pts[i + 1];
    if (t0 <= s && next && next[0] > s && next[0] - t0 <= RESAMPLE_MAX_GAP_S) out[s] = v0 + ((next[1] - v0) * (s - t0)) / (next[0] - t0);
  }
  return out;
}

export interface Cleaned {
  hr: Hz;
  /** Secondes mesurées avant nettoyage, et retirées. */
  measured: number;
  removed: number;
  /** Plus de 20 % retiré : affichée, exclue des tendances et de la FCmax. */
  doubtful: boolean;
}

/**
 * Nettoie une série à 1 Hz : hors de 35–230 bpm ; pics (plus de 25 bpm d'écart à la médiane des 30 s
 * précédentes, apparu en 5 s ou moins) ; verrouillage sur la cadence (|FC − cadence| ≤ 3 pendant 30 s, alors
 * que la FC vient de sauter de plus de 20 bpm au-dessus de la médiane de la sortie : la signature d'un capteur
 * optique qui lit les pas ; choix de Mijote, faute de série d'allure).
 */
export function clean(hz: Hz, cadence?: number | null): Cleaned {
  const hr: Hz = hz.map((v) => (v != null && v >= HR_VALID.min && v <= HR_VALID.max ? v : null));
  const measured = hz.filter((v) => v != null).length;
  // Pics : la référence ne compte que ce qui a été gardé ; une suite de pics s'arrête au bout de 30 s.
  let chain = 0;
  for (let s = 0; s < hr.length; s++) {
    const v = hr[s];
    if (v == null) continue;
    const prev = hr.slice(Math.max(0, s - SPIKE_WINDOW_S), s).filter((x): x is number => x != null);
    const ref = prev.length >= 10 ? median(prev) : null;
    const back = s >= 5 ? hz[s - 5] : null;
    const jump = back == null || Math.abs(v - back) > SPIKE_BPM || chain > 0;
    if (ref != null && Math.abs(v - ref) > SPIKE_BPM && jump && chain < SPIKE_WINDOW_S) {
      hr[s] = null;
      chain++;
    } else chain = 0;
  }
  if (cadence != null && cadence > 0) {
    const all = hr.filter((x): x is number => x != null);
    const med = median(all);
    if (med != null) {
      let start = -1;
      const close = (s: number) => hr[s] != null && Math.abs(hr[s]! - cadence) <= CADENCE_LOCK_BPM && hr[s]! > med + 20;
      for (let s = 0; s <= hr.length; s++) {
        if (s < hr.length && close(s)) {
          if (start < 0) start = s;
        } else {
          if (start >= 0 && s - start >= CADENCE_LOCK_MIN_S) for (let k = start; k < s; k++) hr[k] = null;
          start = -1;
        }
      }
    }
  }
  const kept = hr.filter((v) => v != null).length;
  const removed = measured - kept;
  return { hr, measured, removed, doubtful: measured > 0 && removed / measured > DOUBTFUL_SHARE };
}

/** Pic de la sortie : le maximum de la moyenne glissante sur 30 s (fenêtre valide si 25 s mesurées). */
export function peak30(hr: Hz): number | null {
  let best: number | null = null;
  let sum = 0;
  let n = 0;
  for (let s = 0; s < hr.length; s++) {
    if (hr[s] != null) {
      sum += hr[s]!;
      n++;
    }
    const out = s - PEAK_WINDOW_S;
    if (out >= 0 && hr[out] != null) {
      sum -= hr[out]!;
      n--;
    }
    if (s >= PEAK_WINDOW_S - 1 && n >= PEAK_MIN_VALID_S) {
      const m = sum / n;
      if (best == null || m > best) best = m;
    }
  }
  return best == null ? null : Math.round(best);
}

/** Les pauses de la montre, en intervalles [début, fin[ de secondes écoulées. */
export function pauseIntervals(events: PauseEvent[] = []): [number, number][] {
  return events.filter((e) => e.type === "pause" && (e.durSec ?? 0) > 0).map((e) => [Math.round(e.t), Math.round(e.t + (e.durSec ?? 0))] as [number, number]).sort((a, b) => a[0] - b[0]);
}

export interface Motion {
  /** m/s par seconde écoulée (0 pendant une pause), null si inconnue. */
  speed: (number | null)[];
  /** Pente du tronçon (fraction), null si inconnue. */
  grade: (number | null)[];
  /** Indice du tronçon (kilomètre) de chaque seconde, -1 en pause. */
  split: number[];
}

/**
 * Vitesse et pente seconde par seconde, à partir des temps au kilomètre (temps actif, pauses exclues) et des
 * pauses de la montre. Une vitesse par kilomètre : c'est ce que permet un envoi sans trace.
 */
export function motionOf(splits: Split[], events: PauseEvent[] = [], durationS?: number): Motion {
  const pauses = pauseIntervals(events);
  const segs = splits.map((x, i) => {
    const dist = (x.km - (i ? splits[i - 1].km : 0)) * 1000;
    const grade = x.elevGainM != null && x.elevLossM != null && dist >= 100 ? (x.elevGainM - x.elevLossM) / dist : null;
    return { dist, sec: Math.max(1, x.sec), grade };
  });
  const active = segs.reduce((s, x) => s + x.sec, 0);
  const pauseTotal = pauses.reduce((s, [a, b]) => s + (b - a), 0);
  const end = Math.max(durationS ?? 0, active + pauseTotal);
  const speed: (number | null)[] = [];
  const grade: (number | null)[] = [];
  const split: number[] = [];
  let act = 0;
  let k = 0;
  let acc = segs[0]?.sec ?? 0;
  for (let s = 0; s < end; s++) {
    if (pauses.some(([a, b]) => s >= a && s < b)) {
      speed.push(0);
      grade.push(null);
      split.push(-1);
      continue;
    }
    while (k < segs.length - 1 && act >= acc) acc += segs[++k].sec;
    const seg = act < active ? segs[k] : null;
    speed.push(seg ? seg.dist / seg.sec : null);
    grade.push(seg ? seg.grade : null);
    split.push(seg ? k : -1);
    act++;
  }
  return { speed, grade, split };
}
