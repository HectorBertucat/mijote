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

export function openDb(file = dbPath()) {
  const sqlite = new Database(file);
  // busy_timeout d'abord : passer en WAL prend aussi un verrou.
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export type Db = ReturnType<typeof openDb>["db"];
