// Connexion partagée de l'appli. Les scripts et les tests qui veulent une autre base
// utilisent openDb() de ./open.
import { openDb } from "./open";
import { bootstrap } from "@/seed/bootstrap";

export { openDb, type Db } from "./open";

// Une seule connexion par processus (le rechargement à chaud de Next garde globalThis).
const g = globalThis as unknown as { __cuisineDb?: ReturnType<typeof openDb> };
if (!g.__cuisineDb) {
  g.__cuisineDb = openDb();
  try {
    bootstrap(g.__cuisineDb.db, g.__cuisineDb.sqlite);
  } catch (e) {
    console.error("[seed] démarrage de la base :", e);
  }
}
export const sqlite = g.__cuisineDb.sqlite;
export const db = g.__cuisineDb.db;
