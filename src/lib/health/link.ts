// Apple Santé → Mijote : une clé par personne, que l'app Mijote Santé de l'iPhone envoie à chaque requête
// (GET/POST /api/sante/import). L'app demande au GET s'il lui faut tout l'historique (`history: "all"`,
// tant que historyCompleteAt est vide). L'ancien Raccourci (format v1) lit plutôt une fenêtre en jours :
// 6 mois la première fois, le dernier mois une fois par semaine, sinon 7 jours. Tout est dédoublonné à
// l'arrivée, donc renvoyer ne coûte rien.
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { appSettings, healthLinks } from "@/lib/db/schema";

export const WINDOWS = { history: 180, month: 35, week: 7 } as const;
export type SyncWindow = (typeof WINDOWS)[keyof typeof WINDOWS];

export interface LinkDates {
  lastSyncAt: string | null;
  lastMonthAt: string | null;
  lastHistoryAt: string | null;
}

const DAY = 86_400_000;

/** Fenêtre (en jours) à demander au téléphone. Pur. */
export function syncWindow(l: LinkDates, now: Date): SyncWindow {
  if (!l.lastHistoryAt) return WINDOWS.history;
  const since = (iso: string | null) => (iso ? (now.getTime() - Date.parse(iso)) / DAY : Infinity);
  // Une semaine sans le mois complet, ou un trou de plus de 6 jours : on reprend le mois.
  if (since(l.lastMonthAt) >= 7 || since(l.lastSyncAt) > 6) return WINDOWS.month;
  return WINDOWS.week;
}

/** Dates à poser après un envoi couvrant `window` jours. Pur. */
export function afterSync(l: LinkDates, window: number, now: Date): LinkDates {
  const at = now.toISOString();
  return {
    lastSyncAt: at,
    lastMonthAt: window >= WINDOWS.month ? at : l.lastMonthAt,
    lastHistoryAt: window >= WINDOWS.history ? at : l.lastHistoryAt,
  };
}

const newKey = () => randomBytes(24).toString("base64url");

export function getLink(db: Db, personId: string) {
  return db.select().from(healthLinks).where(eq(healthLinks.personId, personId)).get() ?? null;
}

export function ensureLink(db: Db, personId: string) {
  const l = getLink(db, personId);
  if (l) return l;
  db.insert(healthLinks).values({ personId, key: newKey() }).onConflictDoNothing().run();
  return getLink(db, personId)!;
}

/** Nouvelle clé : l'app (ou l'ancien Raccourci) est refusée jusqu'à ce qu'on recolle le code. */
export function rotateLink(db: Db, personId: string) {
  ensureLink(db, personId);
  db.update(healthLinks).set({ key: newKey() }).where(eq(healthLinks.personId, personId)).run();
  return getLink(db, personId)!;
}

export function linkForKey(db: Db, key: string) {
  if (!key) return null;
  return db.select().from(healthLinks).where(eq(healthLinks.key, key)).get() ?? null;
}

export function markSynced(db: Db, personId: string, window: number, now = new Date()) {
  const l = getLink(db, personId);
  if (!l) return;
  db.update(healthLinks).set(afterSync(l, window, now)).where(eq(healthLinks.personId, personId)).run();
}

/** Fin d'un envoi de l'app (paquet `last`) ; `complete` : c'était la fin de tout l'historique. */
export function markSyncedV2(db: Db, personId: string, complete: boolean, now = new Date()) {
  const at = now.toISOString();
  db.update(healthLinks)
    .set(complete ? { lastSyncAt: at, historyCompleteAt: at } : { lastSyncAt: at })
    .where(eq(healthLinks.personId, personId))
    .run();
}

/** « Tout renvoyer » : l'app relira tout l'historique, l'ancien Raccourci 6 mois. */
export function resetHistory(db: Db, personId: string) {
  db.update(healthLinks).set({ lastHistoryAt: null, historyCompleteAt: null }).where(eq(healthLinks.personId, personId)).run();
}

// ---------- Réglages ----------

export const CF_ID = "cf_access_client_id";
export const CF_SECRET = "cf_access_client_secret";

export function getSetting(db: Db, key: string): string | null {
  return db.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).get()?.v ?? null;
}

export function setSetting(db: Db, key: string, value: string) {
  const v = value.trim();
  if (!v) return db.delete(appSettings).where(eq(appSettings.key, key)).run();
  db.insert(appSettings)
    .values({ key, value: v })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: new Date().toISOString() } })
    .run();
}

// ---------- Code d'installation ----------

export const CODE_TAG = "mijote-sante";

/**
 * Ce que l'app Mijote Santé scanne (QR code) ou colle : tout ce qu'il lui faut, pour une personne. Pas de
 * prénom : la clé suffit, le GET le renvoie. `id` et `secret` restent vides sans Cloudflare Access.
 */
export function installCode(o: { url: string; key: string; clientId: string; clientSecret: string }) {
  return JSON.stringify({ [CODE_TAG]: 1, url: o.url, id: o.clientId, secret: o.clientSecret, key: o.key });
}
