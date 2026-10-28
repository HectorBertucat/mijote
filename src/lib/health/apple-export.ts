// Lecture de l'export d'Apple Santé (export.zip ou export.xml) dans le navigateur, sans l'envoyer :
// le fichier peut peser des centaines de Mo, on n'en extrait que les pesées, les séances et les pas.
// Fonctionne aussi sous Node (tests). Zip : on lit le répertoire central, puis l'entrée XML via
// DecompressionStream("deflate-raw").

export interface ExportWeight {
  kg: number;
  at: string; // ISO 8601
}

export interface ExportWorkout {
  type: string; // HKWorkoutActivityTypeSwimming…
  start: string;
  end?: string;
  durationMin?: number;
  distanceM?: number;
  kcal?: number;
}

/** Pas d'un enregistrement, par jour local et par appareil (iPhone et montre comptent les mêmes pas). */
export interface ExportSteps {
  day: string; // yyyy-MM-dd, heure locale de l'enregistrement
  source: string;
  count: number;
}

export interface ExportFound {
  weights: ExportWeight[];
  workouts: ExportWorkout[];
  steps: ExportSteps[];
}

/** « 2026-10-21 06:30:12 +0200 » (format de l'export) → « 2026-10-21T06:30:12+02:00 ». */
export function exportDateToIso(s: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/.exec(s.trim());
  return m ? `${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}` : null;
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
const numAttr = (tag: string, name: string) => {
  const v = Number(attr(tag, name));
  return Number.isFinite(v) ? v : undefined;
};
const DIST: Record<string, number> = { m: 1, km: 1000, mi: 1609.344, yd: 0.9144 };
const ENERGY: Record<string, number> = { kcal: 1, Cal: 1, kJ: 1 / 4.184 };

/** Pesées, séances et pas contenus dans un morceau de XML (des balises complètes). */
export function scanXml(xml: string): ExportFound {
  const out: ExportFound = { weights: [], workouts: [], steps: [] };
  const re = /<Record\b[^>]*HKQuantityTypeIdentifier(?:BodyMass|StepCount)"[^>]*>|<Workout\b[^>]*>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const tag = m[0];
    const start = attr(tag, "startDate") ?? "";
    const at = exportDateToIso(start);
    if (!at) continue;
    if (tag.startsWith("<Workout")) {
      const unit = attr(tag, "durationUnit") ?? "min";
      const d = numAttr(tag, "duration");
      const dist = numAttr(tag, "totalDistance");
      const kcal = numAttr(tag, "totalEnergyBurned");
      out.workouts.push({
        type: attr(tag, "workoutActivityType") ?? "",
        start: at,
        end: exportDateToIso(attr(tag, "endDate") ?? "") ?? undefined,
        durationMin: d == null ? undefined : Math.round((unit === "s" ? d / 60 : unit === "hr" ? d * 60 : d) * 10) / 10,
        distanceM: dist == null ? undefined : Math.round(dist * (DIST[attr(tag, "totalDistanceUnit") ?? "m"] ?? 1)),
        kcal: kcal == null ? undefined : Math.round(kcal * (ENERGY[attr(tag, "totalEnergyBurnedUnit") ?? "kcal"] ?? 1)),
      });
      continue;
    }
    const v = numAttr(tag, "value");
    if (v == null) continue;
    if (tag.includes("StepCount")) out.steps.push({ day: start.slice(0, 10), source: attr(tag, "sourceName") ?? "", count: v });
    else out.weights.push({ kg: Math.round((/lb/i.test(attr(tag, "unit") ?? "kg") ? v * 0.45359237 : v) * 100) / 100, at });
  }
  return out;
}

/** Pesées seules (compatibilité). */
export const weightsInXml = (xml: string) => scanXml(xml).weights;

/**
 * Total de pas par jour. Santé ne double pas les pas de l'iPhone et de la montre : on fait la somme par
 * appareil, puis on garde l'appareil qui en a compté le plus ce jour-là (proche du total de l'app Santé).
 */
export function dailySteps(rows: ExportSteps[]): { date: string; count: number }[] {
  const bySource = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const day = bySource.get(r.day) ?? new Map<string, number>();
    day.set(r.source, (day.get(r.source) ?? 0) + r.count);
    bySource.set(r.day, day);
  }
  return [...bySource.entries()].map(([date, m]) => ({ date, count: Math.round(Math.max(...m.values())) })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Parcourt un flux de texte XML par morceaux et rend ce qu'il trouve au fil de l'eau. */
export async function scanXmlStream(stream: ReadableStream<string>, onFound: (f: ExportFound) => void, onProgress?: (chars: number) => void) {
  const reader = stream.getReader();
  let carry = "";
  let seen = 0;
  const emit = (xml: string) => {
    const f = scanXml(xml);
    if (f.weights.length || f.workouts.length || f.steps.length) onFound(f);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += value.length;
    const text = carry + value;
    const cut = text.lastIndexOf(">") + 1;
    emit(text.slice(0, cut));
    carry = text.slice(cut);
    if (carry.length > 1_000_000) carry = carry.slice(-10_000); // jamais de balise aussi longue
    onProgress?.(seen);
  }
  emit(carry);
}

interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  size: number;
  localOffset: number;
}

async function bytes(blob: Blob, start: number, end: number) {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

/** Entrées d'un zip (répertoire central). */
export async function zipEntries(file: Blob): Promise<ZipEntry[]> {
  const tailLen = Math.min(file.size, 65_557);
  const tail = await bytes(file, file.size - tailLen, file.size);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Ce fichier n'est pas un zip lisible.");
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff) throw new Error("Export trop gros pour être lu zippé : décompresse-le et choisis export.xml.");
  const cd = await bytes(file, cdOffset, cdOffset + cdSize);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let p = 0; p + 46 <= cd.byteLength && cd.getUint32(p, true) === 0x02014b50; ) {
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    out.push({
      method: cd.getUint16(p + 10, true),
      compSize: cd.getUint32(p + 20, true),
      size: cd.getUint32(p + 24, true),
      localOffset: cd.getUint32(p + 42, true),
      name: dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen)),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Le XML principal de l'export : le plus gros .xml qui n'est pas un document CDA. */
export function pickExportXml(entries: ZipEntry[]): ZipEntry | null {
  return entries.filter((e) => /\.xml$/i.test(e.name) && !/cda/i.test(e.name)).sort((a, b) => b.size - a.size)[0] ?? null;
}

/** Flux de texte d'une entrée du zip. */
export async function zipEntryText(file: Blob, e: ZipEntry): Promise<ReadableStream<string>> {
  const lh = await bytes(file, e.localOffset, e.localOffset + 30);
  if (lh.getUint32(0, true) !== 0x04034b50) throw new Error("Zip abîmé (en-tête local).");
  const start = e.localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
  const raw = file.slice(start, start + e.compSize).stream();
  const data = e.method === 8 ? raw.pipeThrough(new DecompressionStream("deflate-raw")) : e.method === 0 ? raw : null;
  if (!data) throw new Error(`Compression non prise en charge (${e.method}).`);
  return data.pipeThrough(new TextDecoderStream());
}

/** Tout ce qui nous sert dans un export (zip ou xml). */
export async function readExport(file: File | Blob, onWeights: (f: ExportFound) => void, onProgress?: (fraction: number) => void) {
  const isZip = new DataView(await file.slice(0, 4).arrayBuffer()).getUint32(0, true) === 0x04034b50;
  if (!isZip) return scanXmlStream(file.stream().pipeThrough(new TextDecoderStream()), onWeights, (c) => onProgress?.(Math.min(1, c / file.size)));
  const entry = pickExportXml(await zipEntries(file));
  if (!entry) throw new Error("Pas de fichier export.xml dans ce zip.");
  return scanXmlStream(await zipEntryText(file, entry), onWeights, (c) => onProgress?.(Math.min(1, c / Math.max(1, entry.size))));
}
