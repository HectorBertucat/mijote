"use server";

// Programmes d'entraînement : partir d'un modèle, composer sans IA, créer avec l'IA, arrêter.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { userMessage } from "@/lib/atelier/errors";
import { ageOn } from "@/lib/health/core";
import { getPerson, todayParis } from "@/lib/health/store";
import { aiProgram } from "@/lib/training/ai";
import { generateProgram, type Focus, type ProgramRequest } from "@/lib/training/generate";
import { GEARS, type Gear } from "@/lib/training/library";
import { assignProgram, stopProgram, templateById } from "@/lib/training/programs";

export type ProgramResult = { ok: true; name: string; explanation?: string; warnings: string[] } | { ok: false; error: string };

const FOCI: Focus[] = ["equilibre", "bas", "haut", "gainage"];
const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d);

/** Demande relue côté serveur : rien ne passe tel quel du navigateur. */
function clean(r: Partial<ProgramRequest>): ProgramRequest {
  return {
    name: typeof r.name === "string" ? r.name.slice(0, 60) : undefined,
    gear: Array.isArray(r.gear) ? (r.gear.filter((g) => GEARS.includes(g as Gear)) as Gear[]) : [],
    perWeek: clamp(r.perWeek, 2, 4, 3),
    minutes: clamp(r.minutes, 15, 75, 30),
    level: clamp(r.level, 1, 3, 1) as 1 | 2 | 3,
    focus: FOCI.includes(r.focus as Focus) ? (r.focus as Focus) : "equilibre",
    notes: typeof r.notes === "string" ? r.notes.slice(0, 800) : undefined,
  };
}

const done = () => revalidatePath("/sante/entrainement");

export async function templateProgramAction(personId: string, templateId: string): Promise<ProgramResult> {
  const t = templateById(templateId);
  if (!t || !getPerson(db, personId)) return { ok: false, error: "Modèle ou personne inconnus." };
  const p = assignProgram(db, personId, t, "modele");
  done();
  return { ok: true, name: p.name, warnings: [] };
}

export async function generateProgramAction(personId: string, input: Partial<ProgramRequest>): Promise<ProgramResult> {
  if (!getPerson(db, personId)) return { ok: false, error: "Personne inconnue." };
  const req = clean(input);
  const p = assignProgram(db, personId, generateProgram(req, ""), "generateur", req);
  done();
  return { ok: true, name: p.name, warnings: [] };
}

export async function aiProgramAction(personId: string, input: Partial<ProgramRequest>): Promise<ProgramResult> {
  const person = getPerson(db, personId);
  if (!person) return { ok: false, error: "Personne inconnue." };
  const req = clean(input);
  try {
    const age = person.birthDate ? ageOn(person.birthDate, todayParis()) : null;
    const r = await aiProgram(db, req, { name: person.name, sex: person.sex, age }, "");
    const p = assignProgram(db, personId, r.program, "ia", req);
    done();
    return { ok: true, name: p.name, explanation: r.explanation, warnings: r.warnings };
  } catch (e) {
    console.error("[programme ia]", e);
    return { ok: false, error: userMessage(e) };
  }
}

export async function stopProgramAction(personId: string): Promise<void> {
  stopProgram(db, personId);
  done();
}
