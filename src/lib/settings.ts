// Réglages de l'instance (table app_settings) : ce que la mise en route (/bienvenue) a choisi.
// Une clé = une valeur texte ; les valeurs structurées sont en JSON.
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { appSettings } from "@/lib/db/schema";

export function getSetting(db: Db, key: string): string | null {
  return db.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).get()?.v ?? null;
}

export function setSetting(db: Db, key: string, value: string | null) {
  if (value == null || value === "") return db.delete(appSettings).where(eq(appSettings.key, key)).run();
  db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date().toISOString() } })
    .run();
}

/** Clés connues. */
export const SETTING = {
  /** Date de fin de la mise en route : sans elle, l'appli ouvre /bienvenue. */
  setupDone: "setup.done",
  /** Nom du magasin, montré dans la liste et donné à l'IA (« Carrefour de Lyon 7e »). */
  storeLabel: "store.label",
  /** Nom de l'instance (« La cuisine des Martin »), en tête de l'appli. */
  homeName: "home.name",
  /** Date à laquelle la visite guidée a été finie ou passée : elle ne se propose plus d’elle-même. */
  tourSeen: "tour.seen",
  /** Liste « Premiers pas » masquée sur l’accueil (Réglages la remet). */
  firstStepsHidden: "tour.firststeps.hidden",
} as const;

export const storeLabel = (db: Db) => getSetting(db, SETTING.storeLabel);
export const isSetupDone = (db: Db) => getSetting(db, SETTING.setupDone) != null;
