// Le foyer : les personnes qui mangent (et s'entraînent), créées à la mise en route (/bienvenue)
// puis modifiables dans les réglages. Une personne = une ligne de `people` ; son profil santé,
// ses goûts et ce qu'elle mange hors batch se règlent ensuite dans /sante/demarrer.
import { eq, max } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { people, preferences, trainingPrograms } from "@/lib/db/schema";
import type { Activity, Goal, Sex } from "@/lib/health/core";
import { addWeighIn } from "@/lib/health/store";

export interface NewPerson {
  name: string;
  /** Part de base : 3 (petite), 4 (moyenne), 5 (grande) unités. */
  portionUnits: number;
  sex?: Sex | null;
  birthDate?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  activity?: Activity | null;
  goal?: Goal | null;
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "personne";

/** Id stable et lisible tiré du prénom (« Léa » → « lea », puis « lea-2 »). */
export function personId(db: Db, name: string): string {
  const base = slug(name);
  let id = base;
  for (let i = 2; db.select({ id: people.id }).from(people).where(eq(people.id, id)).get(); i++) id = `${base}-${i}`;
  return id;
}

export function addPerson(db: Db, p: NewPerson): string {
  const name = p.name.trim().slice(0, 40);
  if (!name) throw new Error("Il faut un prénom.");
  const id = personId(db, name);
  const rank = (db.select({ m: max(people.rank) }).from(people).get()?.m ?? -1) + 1;
  db.insert(people)
    .values({
      id,
      name,
      rank,
      portionUnits: Math.max(2, Math.min(8, Math.round(p.portionUnits))),
      sex: p.sex ?? null,
      birthDate: p.birthDate ?? null,
      heightCm: p.heightCm ?? null,
      activity: p.activity ?? null,
      goal: p.goal ?? null,
    })
    .run();
  if (p.weightKg) addWeighIn(db, id, p.weightKg);
  return id;
}

export function renamePerson(db: Db, id: string, name: string, portionUnits?: number) {
  const n = name.trim().slice(0, 40);
  if (!n) throw new Error("Il faut un prénom.");
  db.update(people)
    .set({ name: n, ...(portionUnits ? { portionUnits: Math.max(2, Math.min(8, Math.round(portionUnits))) } : {}) })
    .where(eq(people.id, id))
    .run();
}

/** Retire une personne tant qu'elle n'a pas d'historique (semaines, pesées, carnet) ; sinon on le dit. */
export function removePerson(db: Db, id: string): { ok: boolean; error?: string } {
  try {
    db.transaction((tx) => {
      tx.delete(preferences).where(eq(preferences.personId, id)).run();
      tx.delete(trainingPrograms).where(eq(trainingPrograms.personId, id)).run();
      tx.delete(people).where(eq(people.id, id)).run();
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "Cette personne a déjà un historique (semaines, pesées, séances) : on la garde." };
  }
}
