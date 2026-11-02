// Les `actionId` de l'API de l'app gardés en base (src/lib/app-api/actions.ts) : un renvoi ne refait jamais le
// geste, même après un redémarrage ou depuis un autre processus, et rend la réserve d'aujourd'hui.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, type Db } from "@/lib/db/open";
import { appApi, type AppRequest } from "@/lib/app-api/core";
import { ACTION_KEEP_MS, actionIdOf, findAction } from "@/lib/app-api/actions";
import { ensureLink } from "@/lib/health/link";
import { upsertRecipe } from "@/lib/recipes/store";
import { saveReserve } from "@/lib/reserve/store";
import { cookSessions, reserveServings } from "@/lib/db/schema";
import { seedTest } from "./helpers";

const NOW = Date.parse("2026-10-20T10:30:00Z");
type Plats = { dishes: { id: string; people: { personId: string; left: number }[] }[]; eaten: { id: string }[] };
type Body = { ok: boolean; message?: string; serving?: { id: string }; plats?: Plats; replayed?: boolean; error?: string };

function seed(db: Db) {
  seedTest(db);
  const { id: recipeId } = upsertRecipe(db, JSON.parse(fs.readFileSync("src/seed/recipes/poulet-teriyaki-riz.json", "utf8")));
  db.insert(cookSessions).values({ id: "S", planJson: { version: 1, recipes: [{ slug: "poulet-teriyaki-riz", name: "Teriyaki", color: "x", scale: 1 }] }, status: "done", endedAt: "2026-10-18T17:00:00Z" }).run();
  saveReserve(db, "S", recipeId, { weights: { plat: 1500, riz: 1100, "haricots-verts": 600 }, counts: { alex: 4, sam: 3 } }, new Date("2026-10-18T17:30:00Z"));
  return { alex: ensureLink(db, "alex").key, sam: ensureLink(db, "sam").key };
}

function caller(db: Db) {
  return (key: string, method: AppRequest["method"], p: string, body: unknown = null, now = NOW) => {
    const r = appApi(db, { method, path: p.split("/"), query: new URLSearchParams(), body, headers: new Headers({ "x-mijote-key": key }), now });
    return { status: r.status, body: r.body as unknown as Body };
  };
}

/** Une base dans un fichier, qu'on peut fermer et rouvrir (un redémarrage) ou ouvrir deux fois (deux processus). */
function fileDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mijote-actions-"));
  const file = path.join(dir, "mijote.db");
  const first = openDb(file);
  const keys = seed(first.db);
  const dishId = (caller(first.db)(keys.alex, "GET", "plats").body as unknown as Plats).dishes[0].id;
  return { file, first, keys, dishId, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const servings = (db: Db, personId: string) => db.select().from(reserveServings).all().filter((s) => s.personId === personId).length;
const left = (b: Body, personId: string) => b.plats!.dishes[0].people.find((x) => x.personId === personId)!.left;

test("actionId : valable s'il est une chaîne de 1 à 80 caractères", () => {
  assert.equal(actionIdOf({ actionId: "a" }), "a");
  assert.equal(actionIdOf({ actionId: "" }), null);
  assert.equal(actionIdOf({ actionId: "x".repeat(81) }), null);
  assert.equal(actionIdOf({ actionId: 3 }), null);
  assert.equal(actionIdOf(null), null);
});

test("actionId : un renvoi après un redémarrage ne compte pas une deuxième portion", () => {
  const { file, first, keys, dishId, done } = fileDb();
  try {
    const r1 = caller(first.db)(keys.alex, "POST", "plats/manger", { dishId, actionId: "geste-1" });
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.equal(left(r1.body, "alex"), 3);
    first.sqlite.close();
    // Redémarrage : plus rien en mémoire, la base est rouverte.
    const again = openDb(file);
    const r2 = caller(again.db)(keys.alex, "POST", "plats/manger", { dishId, actionId: "geste-1" }, NOW + 3600_000);
    assert.equal(r2.status, 200);
    assert.equal(r2.body.replayed, true);
    assert.equal(r2.body.serving!.id, r1.body.serving!.id);
    assert.equal(r2.body.message, r1.body.message);
    assert.equal(left(r2.body, "alex"), 3);
    assert.equal(servings(again.db, "alex"), 1);
    // Un autre actionId est un autre geste.
    assert.equal(left(caller(again.db)(keys.alex, "POST", "plats/manger", { dishId, actionId: "geste-2" }).body, "alex"), 2);
    again.sqlite.close();
  } finally {
    done();
  }
});

test("actionId : renvoi concurrent depuis un autre processus", () => {
  const { file, first, keys, dishId, done } = fileDb();
  const other = openDb(file);
  try {
    // Le premier tient la base (geste en cours) : l'autre ne peut ni lire ni écrire l'actionId avant la fin.
    other.sqlite.pragma("busy_timeout = 50");
    first.sqlite.exec("BEGIN IMMEDIATE");
    assert.throws(() => caller(other.db)(keys.alex, "POST", "plats/manger", { dishId, actionId: "g" }), /locked|busy/i);
    first.sqlite.exec("ROLLBACK");
    const a = caller(first.db)(keys.alex, "POST", "plats/manger", { dishId, actionId: "g" });
    const b = caller(other.db)(keys.alex, "POST", "plats/manger", { dishId, actionId: "g" });
    assert.equal(a.status, 200);
    assert.equal(b.body.replayed, true);
    assert.equal(b.body.serving!.id, a.body.serving!.id);
    assert.equal(servings(first.db, "alex"), 1);
  } finally {
    other.sqlite.close();
    first.sqlite.close();
    done();
  }
});

test("actionId : le renvoi rend la réserve d'aujourd'hui, pas celle du premier envoi", () => {
  const { db } = openDb(":memory:");
  const keys = seed(db);
  const call = caller(db);
  const dishId = (call(keys.alex, "GET", "plats").body as unknown as Plats).dishes[0].id;
  const r1 = call(keys.alex, "POST", "plats/manger", { dishId, actionId: "m" });
  assert.equal(left(r1.body, "sam"), 3);
  // Entre-temps, Sam mange depuis son téléphone et Alex réajuste depuis le site.
  assert.equal(call(keys.sam, "POST", "plats/manger", { dishId, actionId: "m" }).status, 200, "un actionId est propre à une personne");
  const r2 = call(keys.alex, "POST", "plats/manger", { dishId, actionId: "m" });
  assert.equal(r2.body.replayed, true);
  assert.equal(left(r2.body, "sam"), 2);
  assert.equal(left(r2.body, "alex"), 3);
  assert.equal(r2.body.plats!.eaten[0].id, r1.body.serving!.id);
  // Annuler : un renvoi répond 200 (portion déjà annulée) avec la réserve d'aujourd'hui.
  const u1 = call(keys.alex, "POST", "plats/annuler", { servingId: r1.body.serving!.id, actionId: "u" });
  assert.equal(left(u1.body, "alex"), 4);
  const u2 = call(keys.alex, "POST", "plats/annuler", { servingId: r1.body.serving!.id, actionId: "u" });
  assert.equal(u2.status, 200);
  assert.equal(u2.body.message, u1.body.message);
  assert.equal(left(u2.body, "alex"), 4);
  // Sans actionId, une portion déjà annulée reste inconnue.
  assert.equal(call(keys.alex, "POST", "plats/annuler", { servingId: r1.body.serving!.id }).status, 404);
  // Le même actionId pour une autre action : refusé, rien n'est fait.
  const wrong = call(keys.alex, "POST", "plats/reglage", { dishId, left: { sam: 1 }, actionId: "m" });
  assert.equal(wrong.status, 409);
  assert.equal(left({ ok: true, plats: call(keys.alex, "GET", "plats").body as unknown as Plats }, "sam"), 2);
  // Un échec n'est pas gardé : le même actionId peut repartir une fois corrigé.
  assert.equal(call(keys.alex, "POST", "plats/manger", { dishId: "inconnu", actionId: "z" }).status, 404);
  assert.equal(findAction(db, "alex", "z"), null);
});

test("actionId : purge au bout de 30 jours", () => {
  const { db } = openDb(":memory:");
  const keys = seed(db);
  const call = caller(db);
  const dishId = (call(keys.alex, "GET", "plats").body as unknown as Plats).dishes[0].id;
  call(keys.alex, "POST", "plats/manger", { dishId, actionId: "vieux" });
  call(keys.alex, "POST", "plats/manger", { dishId, actionId: "recent" }, NOW + ACTION_KEEP_MS - 1000);
  assert.ok(findAction(db, "alex", "vieux"));
  // Un geste suivant, plus de 30 jours après le premier, l'oublie ; le récent reste.
  call(keys.sam, "POST", "plats/manger", { dishId, actionId: "autre" }, NOW + ACTION_KEEP_MS + 1);
  assert.equal(findAction(db, "alex", "vieux"), null);
  assert.ok(findAction(db, "alex", "recent"));
});
