// Base SQLite + migrations au démarrage (modèle : chronocatalog/src/lib/db/client.ts,
// sans la partie FTS). Chaque migration s'applique en une transaction, une seule fois,
// même si plusieurs processus démarrent en même temps (workers de `next build`).
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import * as schema from "./schema";

export function dbPath(): string {
  const dir = process.env.MIJOTE_DATA_DIR || path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "mijote.db");
}

function findMigrationsFolder(): string | null {
  const candidates = [
    process.env.MIJOTE_MIGRATIONS_DIR,
    path.join(process.cwd(), "src/lib/db/migrations"),
    path.join(__dirname, "migrations"),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((c) => fs.existsSync(path.join(c, "meta/_journal.json"))) ?? null;
}

interface Migration {
  tag: string;
  when: number;
  hash: string;
  statements: string[];
}

function readMigrations(folder: string): Migration[] {
  const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta/_journal.json"), "utf8")) as {
    entries: { tag: string; when: number }[];
  };
  return journal.entries.map((e) => {
    const content = fs.readFileSync(path.join(folder, `${e.tag}.sql`), "utf8");
    return {
      tag: e.tag,
      when: e.when,
      hash: crypto.createHash("sha256").update(content).digest("hex"),
      statements: content.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean),
    };
  });
}

export function migrate(sqlite: Database.Database, folder = findMigrationsFolder()): number {
  if (!folder) {
    console.warn("[db] dossier des migrations introuvable : pas de migration auto (MIJOTE_MIGRATIONS_DIR).");
    return 0;
  }
  sqlite.exec(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at INTEGER)`);
  const maxStmt = sqlite.prepare("SELECT MAX(created_at) AS m FROM __drizzle_migrations");
  const insert = sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)");
  let applied = 0;
  for (const m of readMigrations(folder)) {
    sqlite
      .transaction(() => {
        const last = (maxStmt.get() as { m: number | null }).m ?? 0;
        if (m.when <= last) return;
        for (const stmt of m.statements) sqlite.prepare(stmt).run();
        insert.run(m.hash, m.when);
        applied++;
        console.log(`[db] migration ${m.tag} appliquée`);
      })
      .immediate();
  }
  return applied;
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Passe la base en WAL. Sur une base neuve, quand plusieurs processus l'ouvrent ensemble, ce pragma
 * peut répondre « database is locked » tout de suite, sans passer par busy_timeout (constaté avec
 * 12 processus : un échec sur quelques centaines d'ouvertures). On réessaie donc nous-mêmes ; une fois
 * en WAL, le mode est écrit dans le fichier et les ouvertures suivantes n'ont plus rien à changer.
 */
export function setWal(sqlite: Database.Database, timeoutMs = 60000) {
  const until = Date.now() + timeoutMs;
  for (let wait = 5; ; wait = Math.min(wait * 2, 200)) {
    try {
      if (sqlite.pragma("journal_mode", { simple: true }) === "wal") return;
      sqlite.pragma("journal_mode = WAL");
      return;
    } catch (e) {
      if ((e as { code?: string }).code?.startsWith("SQLITE_BUSY") !== true || Date.now() > until) throw e;
      sleep(wait + Math.random() * wait);
    }
  }
}

export function openDb(file = dbPath()) {
  const sqlite = new Database(file);
  // busy_timeout d'abord : passer en WAL prend aussi un verrou. Large : au premier démarrage (ou pendant
  // `next build`, plusieurs processus à la fois), un seul fait les migrations et l'import des recettes,
  // qui peuvent prendre plus de 5 s sur une petite machine ; les autres attendent au lieu d'échouer.
  sqlite.pragma("busy_timeout = 60000");
  setWal(sqlite);
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export type Db = ReturnType<typeof openDb>["db"];
