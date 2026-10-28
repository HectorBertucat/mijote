// Raccourci Apple Santé installé depuis le téléphone : une clé par personne, et la fenêtre de synchro
// que l'appli demande au Raccourci à chaque envoi (GET /api/sante/import). Première fois : 6 mois
// d'historique ; ensuite le dernier mois une fois par semaine (rattrape un oubli, une pesée tardive) ;
// sinon les 7 derniers jours. Tout est dédoublonné à l'arrivée, donc renvoyer ne coûte rien.
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

/** Nouvelle clé : l'ancien Raccourci est refusé jusqu'à ce qu'on recolle le code. */
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

/** Remet l'historique à refaire (le prochain envoi reprendra 6 mois). */
export function resetHistory(db: Db, personId: string) {
  db.update(healthLinks).set({ lastHistoryAt: null }).where(eq(healthLinks.personId, personId)).run();
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

/** Ce que l'on colle dans le Raccourci (via le presse-papiers) : tout ce qu'il lui faut, pour une personne. */
export function installCode(o: { url: string; person: string; key: string; clientId: string; clientSecret: string }) {
  return JSON.stringify({ app: CODE_TAG, person: o.person, url: o.url, key: o.key, id: o.clientId, secret: o.clientSecret });
}
