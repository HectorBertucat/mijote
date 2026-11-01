// Séance en cours partagée (table training_live) : création, lecture, écriture avec contrôle de
// version (le premier écran arrivé gagne), fin avec enregistrement dans le carnet.
import { randomUUID } from "crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { people, trainingLive } from "@/lib/db/schema";
import { entriesOf, normOpts, startLive, type GuideOpts, type Live } from "./live";
import { programById } from "./programs";
import { saveWorkout } from "./store";

/** Une séance oubliée depuis plus de 6 h ne reprend pas. */
export const STALE_MS = 6 * 3600_000;

export interface LiveRow {
  id: string;
  personId: string;
  live: Live;
  version: number;
  ended: boolean;
}

const toRow = (r: typeof trainingLive.$inferSelect): LiveRow => ({ id: r.id, personId: r.personId, live: r.state as Live, version: r.version, ended: r.endedAt != null });

export function getLive(db: Db, id: string): LiveRow | null {
  const r = db.select().from(trainingLive).where(eq(trainingLive.id, id)).get();
  return r ? toRow(r) : null;
}

/** La séance en cours d'une personne (pas finie, touchée depuis moins de 6 h). */
export function activeLive(db: Db, personId: string, now = Date.now()): LiveRow | null {
  const r = db
    .select()
    .from(trainingLive)
    .where(and(eq(trainingLive.personId, personId), isNull(trainingLive.endedAt), gt(trainingLive.updatedAt, now - STALE_MS)))
    .orderBy(desc(trainingLive.updatedAt))
    .get();
  return r ? toRow(r) : null;
}

/** Réglages du rythme guidé d'une personne (défauts s'il n'y en a pas). */
export function guideOpts(db: Db, personId: string): GuideOpts {
  const r = db.select({ g: people.trainingGuide }).from(people).where(eq(people.id, personId)).get();
  return normOpts(r?.g);
}

export function setGuideOpts(db: Db, personId: string, opts: Partial<GuideOpts>): GuideOpts {
  const next = normOpts({ ...guideOpts(db, personId), ...opts });
  db.update(people).set({ trainingGuide: next }).where(eq(people.id, personId)).run();
  return next;
}

/** Lance une séance ; une séance déjà en cours pour cette personne est abandonnée. */
export function createLive(db: Db, personId: string, programId: string, type: string, now = Date.now()): LiveRow | null {
  const p = programById(db, programId);
  if (!p || !p.people.includes(personId) || !p.sessions[type]) return null;
  db.update(trainingLive).set({ endedAt: now }).where(and(eq(trainingLive.personId, personId), isNull(trainingLive.endedAt))).run();
  const id = randomUUID();
  const live = startLive(p, type, now, guideOpts(db, personId));
  db.insert(trainingLive).values({ id, personId, state: live, version: 1, updatedAt: now }).run();
  return { id, personId, live, version: 1, ended: false };
}

/** Séance à deux : une séance par personne (chacune son programme, son horloge, sa fin), liées par `pair`
 * pour que l'écran partagé les affiche côte à côte. */
export function createDuo(db: Db, a: { personId: string; programId: string; type: string }, b: { personId: string; programId: string; type: string }, now = Date.now()): [LiveRow, LiveRow] | null {
  if (a.personId === b.personId) return null;
  const ok = (x: typeof a) => {
    const p = programById(db, x.programId);
    return !!p && p.people.includes(x.personId) && !!p.sessions[x.type];
  };
  if (!ok(a) || !ok(b)) return null;
  return db.transaction(() => {
    const ra = createLive(db, a.personId, a.programId, a.type, now)!;
    const rb = createLive(db, b.personId, b.programId, b.type, now)!;
    const la = { ...ra.live, pair: rb.id };
    const lb = { ...rb.live, pair: ra.id };
    db.update(trainingLive).set({ state: la }).where(eq(trainingLive.id, ra.id)).run();
    db.update(trainingLive).set({ state: lb }).where(eq(trainingLive.id, rb.id)).run();
    return [{ ...ra, live: la }, { ...rb, live: lb }] as [LiveRow, LiveRow];
  });
}

/** Écrit le nouvel état si `expect` est la version en base ; sinon renvoie l'état actuel (conflit). */
export function writeLive(db: Db, id: string, expect: number, live: Live, now = Date.now()): { ok: boolean; row: LiveRow | null } {
  const cur = getLive(db, id);
  if (!cur || cur.ended) return { ok: false, row: cur };
  if (cur.version !== expect || live.program !== cur.live.program || live.pair !== cur.live.pair) return { ok: false, row: cur };
  const res = db
    .update(trainingLive)
    .set({ state: live, version: expect + 1, updatedAt: now })
    .where(and(eq(trainingLive.id, id), eq(trainingLive.version, expect), isNull(trainingLive.endedAt)))
    .run();
  if (res.changes !== 1) return { ok: false, row: getLive(db, id) };
  // Réglages du rythme changés pendant la séance : ils restent ceux de la personne pour les suivantes.
  if (live.opts && JSON.stringify(normOpts(live.opts)) !== JSON.stringify(normOpts(cur.live.opts))) setGuideOpts(db, cur.personId, live.opts);
  return { ok: true, row: { ...cur, live, version: expect + 1 } };
}

/** Fin de séance : enregistre le carnet (une seule fois) ou abandonne. */
export function endLive(db: Db, id: string, save: { note: string } | null, now = Date.now()): { ok: boolean; message: string; workoutId?: string | null } {
  const cur = getLive(db, id);
  if (!cur) return { ok: false, message: "Séance inconnue." };
  if (cur.ended) {
    const r = db.select({ w: trainingLive.workoutId }).from(trainingLive).where(eq(trainingLive.id, id)).get();
    return { ok: true, message: "Séance déjà terminée.", workoutId: r?.w ?? null };
  }
  let workoutId: string | null = null;
  if (save) {
    const minutes = Math.round((now - cur.live.t0) / 60000);
    workoutId = saveWorkout(db, cur.personId, { type: cur.live.type, minutes, note: save.note, entries: entriesOf(cur.live) }, new Date(now));
    if (!workoutId) return { ok: false, message: "Aucune série notée : rien à enregistrer." };
  }
  db.update(trainingLive)
    .set({ endedAt: now, workoutId, version: cur.version + 1, updatedAt: now })
    .where(eq(trainingLive.id, id))
    .run();
  return { ok: true, message: save ? "Séance enregistrée dans le carnet." : "Séance arrêtée.", workoutId };
}
