// Ranger les listes de courses (archiver, supprimer) et les sessions test (rien n'est compté).
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { cookSessions, durationSamples, purchases, shoppingItems, shoppingLists } from "@/lib/db/schema";
import { bootstrap } from "@/seed/bootstrap";
import { archiveLists, deleteLists, restoreLists } from "@/lib/shopping/archive";
import { activeSession, addEvent, clearTestSessions, createSession, getSession } from "@/lib/session/store";

test("listes : un brouillon se supprime, une liste commandée s'archive à la place", () => {
  const { db } = openDb(":memory:");
  db.insert(shoppingLists).values([
    { id: "brouillon", title: "Brouillon", status: "draft" },
    { id: "commandee", title: "Commandée", status: "ordered" },
  ]).run();
  db.insert(shoppingItems).values({ id: "i1", listId: "brouillon", item: "riz" }).run();
  db.insert(purchases).values({ id: "p1", listId: "commandee", name: "Riz", boughtAt: "2026-10-20", pricePaid: 2 }).run();
  const r = deleteLists(db, ["brouillon", "commandee"]);
  assert.deepEqual(r, { deleted: 1, archived: 1 });
  assert.equal(db.select().from(shoppingLists).where(eq(shoppingLists.id, "brouillon")).get(), undefined);
  assert.equal(db.select().from(shoppingItems).all().length, 0);
  const kept = db.select().from(shoppingLists).where(eq(shoppingLists.id, "commandee")).get()!;
  assert.ok(kept.archivedAt, "archivée");
  assert.equal(db.select().from(purchases).all().length, 1, "les achats restent");
  assert.equal(restoreLists(db, ["commandee"]), 1);
  assert.equal(db.select().from(shoppingLists).where(eq(shoppingLists.id, "commandee")).get()!.archivedAt, null);
  assert.equal(archiveLists(db, ["commandee"]), 1);
  assert.equal(archiveLists(db, ["commandee"]), 0, "déjà archivée");
});

test("session test : ne passe pas devant une vraie session et ne mesure pas ses durées", () => {
  const { db } = openDb(":memory:");
  bootstrap(db);
  const real = createSession(db, { slugs: ["chasseur-porc"], durations: false });
  const demo = createSession(db, { slugs: ["chasseur-porc"], durations: false, test: true });
  assert.equal(getSession(db, demo)!.test, true);
  assert.equal(activeSession(db)!.id, real, "la vraie session d'abord");
  addEvent(db, real, { kind: "note", payload: { status: "abandoned" } });
  assert.deepEqual([activeSession(db)!.id, activeSession(db)!.test], [demo, true]);
  const step = getSession(db, demo)!.plan.steps[0];
  addEvent(db, demo, { kind: "step_start", ref: step.id });
  addEvent(db, demo, { kind: "step_done", ref: step.id });
  addEvent(db, demo, { kind: "note", payload: { status: "done" } });
  assert.equal(db.select().from(durationSamples).where(eq(durationSamples.sessionId, demo)).all().length, 0);
  // Une nouvelle session test efface l'ancienne, finie ; une vraie session n'est jamais touchée.
  const next = createSession(db, { slugs: ["chasseur-porc"], durations: false, test: true });
  assert.equal(getSession(db, demo), null);
  assert.ok(getSession(db, real));
  assert.equal(clearTestSessions(db, Date.now() + 13 * 3600_000), 1);
  assert.equal(getSession(db, next), null);
  assert.equal(db.select().from(cookSessions).all().length, 1);
});
