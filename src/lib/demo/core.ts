// Mode démo (MIJOTE_DEMO=1) : la logique pure, sans base ni fichier. Chaque visiteur a sa propre base,
// copiée d'une base modèle et reconnue par un cookie ; les bases inactives sont effacées, leur nombre et
// leur taille sont plafonnés. Le lien avec les fichiers est dans ./store.ts, le foyer dans ./household.ts
// et ./seed.ts. Ce fichier ne dépend de rien d'autre : proxy.ts l'importe.
import path from "path";

/** Cookie qui porte l'identifiant du visiteur, et en-tête par lequel proxy.ts le passe aux pages. */
export const DEMO_COOKIE = "mijote.demo";
export const DEMO_HEADER = "x-mijote-demo";
export const REPO_URL = "https://github.com/HectorBertucat/mijote";
export const INSTALL_URL = `${REPO_URL}/blob/main/docs/installation.md`;

export const demoEnabled = (env: Record<string, string | undefined> = process.env) => env.MIJOTE_DEMO === "1" || env.MIJOTE_DEMO === "true";

export interface DemoLimits {
  /** Bases de visiteurs gardées à la fois (au-delà, la moins récemment utilisée est effacée). */
  maxBases: number;
  /** Une base sans visite depuis ce délai est effacée. */
  idleMs: number;
  /** Taille maximale d'une base au-delà de la base modèle (SQLite refuse d'écrire plus). */
  headroomMb: number;
  /** Nouvelles bases par minute (un robot sans cookie en créerait une à chaque requête). */
  newPerMinute: number;
}

const int = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v?.trim() ? Math.max(min, Math.min(max, Math.round(n))) : def;
};

/** Les plafonds, réglables par l'environnement dans des bornes raisonnables. */
export function demoLimits(env: Record<string, string | undefined> = process.env): DemoLimits {
  return {
    maxBases: int(env.MIJOTE_DEMO_MAX_BASES, 100, 1, 1000),
    idleMs: int(env.MIJOTE_DEMO_IDLE_MIN, 120, 5, 24 * 60) * 60_000,
    headroomMb: int(env.MIJOTE_DEMO_MAX_MB, 32, 4, 512),
    newPerMinute: int(env.MIJOTE_DEMO_NEW_PER_MIN, 30, 1, 600),
  };
}

/** Identifiant de visiteur : 32 caractères hexadécimaux (un UUID sans tirets), rien d'autre. */
export const isVisitorId = (s: string | null | undefined): s is string => typeof s === "string" && /^[0-9a-f]{32}$/.test(s);

export const newVisitorId = () => crypto.randomUUID().replace(/-/g, "");

/** Le fichier de la base d'un visiteur, toujours dans le dossier de la démo. */
export function visitorFile(dir: string, id: string): string {
  if (!isVisitorId(id)) throw new Error("Identifiant de visiteur invalide.");
  const root = path.resolve(dir);
  const file = path.resolve(root, `v-${id}.db`);
  if (path.dirname(file) !== root) throw new Error("Chemin hors du dossier de la démo.");
  return file;
}

/** L'identifiant tiré d'un nom de fichier du dossier (base ou ses -wal / -shm), sinon null. */
export function visitorOfFile(name: string): string | null {
  const m = /^v-([0-9a-f]{32})\.db(-wal|-shm|-journal)?$/.exec(name);
  return m ? m[1] : null;
}

export interface BaseUse {
  id: string;
  lastSeen: number;
}

/**
 * Les bases à effacer : celles restées sans visite trop longtemps, puis les moins récemment utilisées
 * tant qu'il y en a trop (en gardant `room` places libres pour celles qu'on va créer).
 */
export function basesToPurge(bases: BaseUse[], now: number, limits: Pick<DemoLimits, "maxBases" | "idleMs">, room = 0): string[] {
  const idle = bases.filter((b) => now - b.lastSeen > limits.idleMs);
  const live = bases.filter((b) => now - b.lastSeen <= limits.idleMs).sort((a, b) => a.lastSeen - b.lastSeen);
  const over = Math.max(0, live.length + room - limits.maxBases);
  return [...idle, ...live.slice(0, over)].map((b) => b.id);
}

/** Peut-on créer une base de plus ? (créations de la dernière minute, horodatées en ms) */
export function canCreate(created: number[], now: number, limits: Pick<DemoLimits, "newPerMinute">): boolean {
  return created.filter((t) => now - t < 60_000).length < limits.newPerMinute;
}

/** Plafond de pages SQLite d'une base de visiteur : la base modèle plus la marge permise. */
export function maxPageCount(templateBytes: number, pageSize: number, limits: Pick<DemoLimits, "headroomMb">): number {
  return Math.ceil(templateBytes / pageSize) + Math.ceil((limits.headroomMb * 1024 * 1024) / pageSize);
}
