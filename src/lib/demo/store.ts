// Mode démo, côté fichiers : la base modèle (le foyer d'Alex et Sam, refaite chaque jour pour que les dates
// suivent), et une copie par visiteur dans <MIJOTE_DATA_DIR>/demo/, ouverte à la demande, effacée après
// inactivité ou quand il y en a trop. Rien n'est écrit ailleurs que dans ce dossier.
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "fs";
import path from "path";
import * as schema from "@/lib/db/schema";
import { openDb, type Db } from "@/lib/db/open";
import { todayParis } from "@/lib/health/store";
import { bootstrap } from "@/seed/bootstrap";
import { basesToPurge, canCreate, demoLimits, maxPageCount, visitorFile, visitorOfFile } from "./core";
import { seedDemo } from "./seed";

interface Conn {
  sqlite: Database.Database;
  db: Db;
}

interface DemoState {
  dir: string;
  /** Jour de la base modèle en place (YYYY-MM-DD), null tant qu'elle n'existe pas. */
  day: string | null;
  building: Promise<void> | null;
  template: Conn | null;
  visitors: Map<string, Conn & { lastSeen: number }>;
  created: number[];
  timer: ReturnType<typeof setInterval> | null;
}

// Gardé sur globalThis : le rechargement à chaud de Next ne rouvre pas tout.
const g = globalThis as unknown as { __mijoteDemo?: DemoState };

export function demoDir(): string {
  return path.join(process.env.MIJOTE_DATA_DIR || path.join(process.cwd(), "data"), "demo");
}

const state = (): DemoState => (g.__mijoteDemo ??= { dir: demoDir(), day: null, building: null, template: null, visitors: new Map(), created: [], timer: null });
const templateFile = (s: DemoState) => path.join(s.dir, "modele.db");

function removeBase(file: string) {
  for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) fs.rmSync(f, { force: true });
}

function closeVisitor(s: DemoState, id: string) {
  const c = s.visitors.get(id);
  if (c) {
    try {
      c.sqlite.close();
    } catch {
      /* déjà fermée */
    }
    s.visitors.delete(id);
  }
  removeBase(visitorFile(s.dir, id));
}

/** Construit la base modèle du jour à côté, puis la met en place d'un coup (renommage). */
async function buildTemplate(s: DemoState, day: string) {
  fs.mkdirSync(s.dir, { recursive: true });
  const tmp = path.join(s.dir, `modele-${process.pid}.tmp.db`);
  removeBase(tmp);
  const { sqlite, db } = openDb(tmp);
  try {
    bootstrap(db, sqlite);
    await seedDemo(db, day);
    // Un seul fichier à copier : tout revient dans la base, puis le journal classique.
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    sqlite.pragma("journal_mode = DELETE");
    sqlite.exec("VACUUM");
  } finally {
    sqlite.close();
  }
  s.template?.sqlite.close();
  s.template = null;
  removeBase(templateFile(s));
  fs.renameSync(tmp, templateFile(s));
  s.day = day;
  console.log(`[démo] base modèle du ${day} prête (${Math.round(fs.statSync(templateFile(s)).size / 1024)} Ko)`);
}

/** Refait la base modèle si le jour a changé (une seule construction à la fois). */
function refresh(s: DemoState): Promise<void> {
  const day = todayParis();
  if (s.day === day) return Promise.resolve();
  s.building ??= buildTemplate(s, day)
    .catch((e) => console.error("[démo] construction de la base modèle :", e))
    .finally(() => (s.building = null));
  return s.building;
}

/** Efface les bases inactives ou en trop, et les fichiers que plus rien ne suit. */
export function purgeDemo(now = Date.now(), room = 0) {
  const s = state();
  const limits = demoLimits();
  for (const id of basesToPurge([...s.visitors].map(([id, c]) => ({ id, lastSeen: c.lastSeen })), now, limits, room)) closeVisitor(s, id);
  if (!fs.existsSync(s.dir)) return;
  for (const name of fs.readdirSync(s.dir)) {
    const id = visitorOfFile(name);
    if (id && !s.visitors.has(id)) removeBase(visitorFile(s.dir, id));
  }
}

/**
 * Démarrage du serveur en démo (instrumentation.ts) : on repart d'un dossier vide (les bases d'un
 * lancement précédent ne suivent peut-être plus le schéma), on construit la base modèle, puis on purge
 * et on vérifie le jour toutes les 5 minutes.
 */
export async function prepareDemo() {
  const s = state();
  fs.rmSync(s.dir, { recursive: true, force: true });
  fs.mkdirSync(s.dir, { recursive: true });
  await refresh(s);
  if (!s.timer) {
    s.timer = setInterval(() => {
      purgeDemo();
      void refresh(s);
    }, 5 * 60_000);
    s.timer.unref();
  }
}

/** La base modèle en lecture seule : pour une page vue sans visiteur reconnu (rien ne peut y écrire). */
export function templateDb(): Db {
  const s = state();
  if (!s.template) {
    const sqlite = new Database(templateFile(s), { readonly: true, fileMustExist: true });
    s.template = { sqlite, db: drizzle(sqlite, { schema }) };
  }
  return s.template.db;
}

function openVisitor(s: DemoState, file: string): Conn {
  const sqlite = new Database(file, { fileMustExist: true });
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // Plafond de taille : au-delà, SQLite refuse d'écrire (SQLITE_FULL) au lieu de remplir le disque.
  const pageSize = sqlite.pragma("page_size", { simple: true }) as number;
  sqlite.pragma(`max_page_count = ${maxPageCount(fs.statSync(templateFile(s)).size, pageSize, demoLimits())}`);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

/**
 * La base du visiteur, copiée de la base modèle à sa première visite. Si la démo n'est pas prête ou que
 * trop de bases viennent d'être créées, la base modèle en lecture seule (on voit tout, rien ne s'écrit).
 */
export function visitorDb(id: string, now = Date.now()): Db {
  const s = state();
  const known = s.visitors.get(id);
  if (known) {
    known.lastSeen = now;
    return known.db;
  }
  if (!s.day || !fs.existsSync(templateFile(s))) throw new Error("La démo se prépare : réessaie dans quelques secondes.");
  const file = visitorFile(s.dir, id);
  if (!fs.existsSync(file)) {
    const limits = demoLimits();
    if (!canCreate(s.created, now, limits)) return templateDb();
    purgeDemo(now, 1);
    fs.copyFileSync(templateFile(s), file, fs.constants.COPYFILE_EXCL);
    s.created = [...s.created.filter((t) => now - t < 60_000), now];
  }
  const conn = { ...openVisitor(s, file), lastSeen: now };
  s.visitors.set(id, conn);
  return conn.db;
}

/** « Recommencer » : la base du visiteur repart de la base modèle du jour. */
export function resetVisitor(id: string) {
  closeVisitor(state(), id);
}

export const demoReady = () => state().day != null;
