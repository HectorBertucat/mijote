// Le détail d'une séance envoyé par l'app (contrat v2.1, `workouts[].details`) : lecture champ par champ avec
// des bornes de vraisemblance (un champ hors bornes est retiré, le reste du détail passe), et la série de FC
// rangée en binaire (3 octets par point). Pur.
import { z } from "zod";
import type { HrPoint, PauseEvent, Split } from "./series";

/** 2 000 points au plus (contrat : 1 point toutes les 5 s au plus, 2 000 au plus). */
export const MAX_HR_POINTS = 2000;
export const MAX_SPLITS = 300;
export const MAX_EVENTS = 500;

export interface Details {
  hr: HrPoint[] | null;
  splits: Split[] | null;
  cadenceAvg: number | null;
  strideM: number | null;
  elevGainM: number | null;
  elevLossM: number | null;
  powerW: number | null;
  indoor: boolean | null;
  pausesSec: number | null;
  events: PauseEvent[] | null;
  source: { name?: string; model?: string } | null;
  plannedId: string | null;
  effort: number | null;
  weather: { tempC?: number; humidityPct?: number } | null;
}

const num = (min: number, max: number) => z.number().finite().min(min).max(max);
/** Un champ lu à part : invalide → null (le reste du détail passe). */
const pick = <T>(schema: z.ZodType<T>, v: unknown): T | null => {
  if (v == null) return null;
  const r = schema.safeParse(v);
  return r.success ? r.data : null;
};
const round1 = (x: number) => Math.round(x * 10) / 10;

const SplitSchema = z.object({ km: num(0.001, 500), sec: num(1, 86_400), hrAvg: num(25, 250).optional(), elevGainM: num(0, 5000).optional(), elevLossM: num(0, 5000).optional() });
const EventSchema = z.object({ type: z.string().min(1).max(40), t: num(0, 86_400), durSec: num(0, 86_400).optional() });

/**
 * Lit `details` (objet libre de l'app). Retourne null si ce n'est pas un objet. `durationS` borne le temps
 * de la série et des événements (une marge d'une minute : l'app arrondit).
 */
export function parseDetails(raw: unknown, durationS: number | null): Details | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  const tMax = durationS != null ? durationS + 60 : 86_400;

  // FC : paires [s, bpm] ; un point illisible ou hors bornes est retiré ; trop de points → série refusée.
  let hr: HrPoint[] | null = null;
  if (Array.isArray(d.hr) && d.hr.length <= MAX_HR_POINTS) {
    const pts = d.hr
      .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map(([t, v]) => [Math.round(t), Math.round(v)] as HrPoint)
      .filter(([t, v]) => t >= 0 && t <= tMax && v >= 25 && v <= 250)
      .sort((a, b) => a[0] - b[0]);
    // Un même instant deux fois : le dernier gagne.
    const byT = new Map(pts.map((p) => [p[0], p]));
    hr = byT.size ? [...byT.values()] : null;
  }

  // Temps au kilomètre : croissants, sinon tous retirés.
  let splits: Split[] | null = null;
  if (Array.isArray(d.splits) && d.splits.length <= MAX_SPLITS) {
    const xs = d.splits.map((s) => pick(SplitSchema, s));
    if (xs.length && xs.every((s, i) => s && (i === 0 || s.km > xs[i - 1]!.km))) splits = xs.map((s) => ({ ...s! }));
  }

  let events: PauseEvent[] | null = null;
  if (Array.isArray(d.events) && d.events.length <= MAX_EVENTS) {
    const xs = d.events.map((e) => pick(EventSchema, e)).filter((e): e is PauseEvent => !!e && e.t <= tMax);
    events = xs.length ? xs : null;
  }

  const power = d.power && typeof d.power === "object" ? pick(num(0, 2500), (d.power as { avgW?: unknown }).avgW) : null;
  const src = d.source && typeof d.source === "object" ? (d.source as Record<string, unknown>) : null;
  const source = src
    ? {
        ...(typeof src.name === "string" && src.name.trim() ? { name: src.name.trim().slice(0, 200) } : {}),
        ...(typeof src.model === "string" && src.model.trim() ? { model: src.model.trim().slice(0, 60) } : {}),
      }
    : null;
  const w = d.weather && typeof d.weather === "object" ? (d.weather as Record<string, unknown>) : null;
  const tempC = w ? pick(num(-40, 60), w.tempC) : null;
  const humidityPct = w ? pick(num(0, 100), w.humidityPct) : null;
  const effort = pick(num(1, 10), d.effort);
  const plannedId = typeof d.plannedId === "string" && d.plannedId.trim() ? d.plannedId.trim().slice(0, 200) : null;

  return {
    hr,
    splits,
    cadenceAvg: pick(num(30, 260), d.cadenceAvg),
    strideM: pick(num(0.2, 3), d.strideM),
    elevGainM: pick(num(0, 20_000), d.elevGainM),
    elevLossM: pick(num(0, 20_000), d.elevLossM),
    powerW: power,
    indoor: typeof d.indoor === "boolean" ? d.indoor : null,
    pausesSec: pick(num(0, 86_400), d.pausesSec),
    events,
    source: source && Object.keys(source).length ? source : null,
    plannedId,
    effort: effort != null ? round1(effort) : null,
    weather: tempC != null || humidityPct != null ? { ...(tempC != null ? { tempC: round1(tempC) } : {}), ...(humidityPct != null ? { humidityPct: Math.round(humidityPct) } : {}) } : null,
  };
}

/** Un détail qui n'apporte rien (tous les champs absents). */
export const emptyDetails = (d: Details) => Object.values(d).every((v) => v == null);

// ─── La série de FC en binaire ───
// Par point : l'écart au point précédent en secondes (entier non signé sur 2 octets, petit-boutiste) puis le
// bpm (1 octet). Les points sont triés ; un écart de plus de 65 535 s (18 h) n'arrive pas dans une séance.

export function encodeHr(points: HrPoint[]): Buffer {
  const buf = Buffer.alloc(points.length * 3);
  let prev = 0;
  points.forEach(([t, v], i) => {
    const dt = Math.max(0, Math.min(65_535, Math.round(t) - prev));
    prev += dt;
    buf.writeUInt16LE(dt, i * 3);
    buf.writeUInt8(Math.max(0, Math.min(255, Math.round(v))), i * 3 + 2);
  });
  return buf;
}

export function decodeHr(buf: Uint8Array | null | undefined): HrPoint[] {
  if (!buf?.length) return [];
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: HrPoint[] = [];
  let t = 0;
  for (let i = 0; i + 2 < b.length; i += 3) {
    t += b.readUInt16LE(i);
    out.push([t, b.readUInt8(i + 2)]);
  }
  return out;
}
