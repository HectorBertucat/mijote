// Registre des programmes : qui suit quel programme (table training_programs). Un programme part
// d'un modèle (KB_TEMPLATE, RENFO_TEMPLATE), du générateur (generate.ts) ou de l'IA (ai.ts) ; une
// fois choisi, c'est une copie à la personne, qu'on peut remplacer (l'ancien est archivé, le carnet reste).
import { randomUUID } from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { trainingPrograms } from "@/lib/db/schema";
import { LIBRARY } from "./library";
import { KB_TEMPLATE, type Exercise, type Program } from "./program";
import { RENFO_TEMPLATE } from "./renfo";

export const TEMPLATES: Program[] = [RENFO_TEMPLATE, KB_TEMPLATE].map((p) => ({ ...p, source: "modele" as const }));
export const templateById = (id: string) => TEMPLATES.find((p) => p.id === id) ?? null;

const asProgram = (row: { id: string; personId: string; program: Program; source: Program["source"] }): Program => ({ ...row.program, id: row.id, people: [row.personId], source: row.source });

/** Le programme en cours d'une personne, ou null si elle n'en suit pas. */
export function programFor(db: Db, personId: string): Program | null {
  const row = db
    .select()
    .from(trainingPrograms)
    .where(and(eq(trainingPrograms.personId, personId), isNull(trainingPrograms.archivedAt)))
    .orderBy(desc(trainingPrograms.createdAt))
    .get();
  return row ? asProgram(row) : null;
}

/** Un programme par id (même archivé : une séance commencée le garde jusqu'au bout). */
export function programById(db: Db, id: string): Program | null {
  const row = db.select().from(trainingPrograms).where(eq(trainingPrograms.id, id)).get();
  return row ? asProgram(row) : templateById(id);
}

/** Donne un programme à une personne : il devient son programme en cours, le précédent est archivé. */
export function assignProgram(db: Db, personId: string, program: Program, source: NonNullable<Program["source"]>, request: unknown = null, id: string = randomUUID()): Program {
  db.transaction((tx) => {
    tx.update(trainingPrograms).set({ archivedAt: new Date().toISOString() }).where(and(eq(trainingPrograms.personId, personId), isNull(trainingPrograms.archivedAt))).run();
    tx.insert(trainingPrograms).values({ id, personId, program: { ...program, id, people: [personId], source }, source, request }).run();
  });
  return { ...program, id, people: [personId], source };
}

/** Arrête le programme en cours (le carnet reste). */
export function stopProgram(db: Db, personId: string) {
  db.update(trainingPrograms).set({ archivedAt: new Date().toISOString() }).where(and(eq(trainingPrograms.personId, personId), isNull(trainingPrograms.archivedAt))).run();
}

/** Exercices connus (bibliothèque et exercices inventés des programmes de la personne) : le carnet garde les ids. */
export function exerciseLookup(db: Db, personId?: string): (id: string) => Exercise | null {
  const extra: Record<string, Exercise> = {};
  const rows = db.select({ program: trainingPrograms.program }).from(trainingPrograms).where(personId ? eq(trainingPrograms.personId, personId) : undefined).all();
  for (const r of rows) Object.assign(extra, r.program.exercises);
  return (id) => (Object.hasOwn(LIBRARY, id) ? LIBRARY[id] : Object.hasOwn(extra, id) ? extra[id] : null);
}
