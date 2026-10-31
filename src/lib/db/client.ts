// Connexion partagée de l'appli. Les scripts et les tests qui veulent une autre base
// utilisent openDb() de ./open.
import { openDb, type Db } from "./open";
import { bootstrap } from "@/seed/bootstrap";
import { demoEnabled } from "@/lib/demo/core";
import { requestDemoDb } from "@/lib/demo/request";

export { openDb, type Db } from "./open";

// Une seule connexion par processus (le rechargement à chaud de Next garde globalThis).
const g = globalThis as unknown as { __cuisineDb?: ReturnType<typeof openDb> };

function shared(): Db {
  if (!g.__cuisineDb) {
    g.__cuisineDb = openDb();
    try {
      bootstrap(g.__cuisineDb.db, g.__cuisineDb.sqlite);
    } catch (e) {
      console.error("[seed] démarrage de la base :", e);
    }
  }
  return g.__cuisineDb.db;
}

/**
 * En démo (MIJOTE_DEMO=1), chaque visiteur a sa base (src/lib/demo) : `db` la retrouve à chaque usage,
 * d'après la requête en cours. Sinon, la base de l'instance.
 */
export const db: Db = demoEnabled()
  ? new Proxy({} as Db, {
      get(_, prop) {
        const real = requestDemoDb();
        const v = Reflect.get(real, prop, real);
        return typeof v === "function" ? v.bind(real) : v;
      },
    })
  : shared();
