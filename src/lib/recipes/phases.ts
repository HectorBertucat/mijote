// Sous-étapes chronométrées obligatoires : toute étape de cuisson qui demande plus d'un geste
// (saisie, mijotage, cuisson à l'eau, four) porte ses sous-étapes, quelle que soit l'origine de
// la recette (fiche du dépôt, Ajuster, Atelier). Pur et testé (tests/phases.test.ts).
//   - phaseIssues : ce qui manque ou ne tient pas (test des fiches, import, vérification de l'IA) ;
//   - fallbackPhases : filet de sécurité quand l'IA les oublie, tirées du texte de l'étape.
import type { StepPhase } from "./format";

type Step = {
  kind: string;
  text: string;
  durationMin?: number | null;
  activeMin?: number | null;
  hobLevel?: number | null;
  bowls?: string[] | null;
  phases?: StepPhase[] | null;
};

const HEAT = new Set(["sear", "braise", "boil", "bake"]);

/** Une étape de cuisson de 2 min de geste ou plus, ou une saisie (préchauffe et test de la goutte), a ses sous-étapes. */
export function needsPhases(s: Step): boolean {
  if (!HEAT.has(s.kind)) return false;
  const active = s.activeMin ?? s.durationMin ?? 0;
  return active >= 2 || (s.kind === "sear" && (s.durationMin ?? 0) >= 2);
}

export const phasesTotal = (s: Step) => (s.phases ?? []).reduce((x, p) => x + p.min, 0);

const bowlLetters = (t: string) => [...t.matchAll(/\b[Bb]ols? ([A-Z])\b/g)].map((m) => m[1]);

export interface PhaseIssue {
  step: number; // rang dans la fiche, à partir de 1
  text: string;
  issue: string;
}

/** Ce qui manque ou ne tient pas dans les sous-étapes d'une recette (vide : tout va bien). */
export function phaseIssues(r: { steps: Step[] }): PhaseIssue[] {
  const out: PhaseIssue[] = [];
  r.steps.forEach((s, i) => {
    const at = (issue: string) => out.push({ step: i + 1, text: s.text.slice(0, 70), issue });
    const ph = s.phases ?? [];
    if (!ph.length) {
      if (needsPhases(s)) at("étape de cuisson sans sous-étapes");
      return;
    }
    if (needsPhases(s) && ph.length < 2) at("une seule sous-étape : découpe le geste (préchauffe, ajout, cuisson…)");
    const total = phasesTotal(s);
    const dur = s.durationMin ?? 0;
    // Le temps qui reste après les sous-étapes est le minuteur d'attente de l'étape : jamais négatif.
    if (dur && total > dur + 0.05) at(`sous-étapes (${total} min) plus longues que l'étape (${dur} min)`);
    const active = s.activeMin ?? 0;
    if (active >= 2 && total < active * 0.5) at(`sous-étapes (${total} min) bien plus courtes que le geste (${active} min)`);
    for (const p of ph) {
      if (!p.text.trim()) at("sous-étape sans texte");
      if (!(p.min > 0)) at(`« ${p.text.slice(0, 40)} » sans durée`);
      for (const l of bowlLetters(p.text)) if (!(s.bowls ?? []).includes(l)) at(`bol ${l} cité dans une sous-étape mais absent des bols de l'étape`);
    }
    // Fournées : 1, 2, 3… dans l'ordre.
    const batches = ph.map((p) => p.batch).filter((b): b is number => b != null);
    if (batches.length) {
      if (batches[0] !== 1) at("les fournées commencent à 1");
      if (batches.some((b, k) => k > 0 && (b < batches[k - 1] || b > batches[k - 1] + 1))) at("fournées dans le désordre");
    }
  });
  return out;
}

// ─── Filet de sécurité : sous-étapes tirées du texte ───

const minutesIn = (t: string): number | null => {
  // « 10 à 12 min » → 11 ; « 2 min 30 » → 2,5 ; « 30 s » → 0,5 ; « 1 h » → 60.
  const range = t.match(/(\d+(?:[.,]\d+)?)\s*(?:à|-)\s*(\d+(?:[.,]\d+)?)\s*min/);
  if (range) return (parseFloat(range[1].replace(",", ".")) + parseFloat(range[2].replace(",", "."))) / 2;
  const ms = t.match(/(\d+)\s*min\s*(\d+)\b/);
  if (ms) return +ms[1] + +ms[2] / 60;
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*min/);
  if (m) return parseFloat(m[1].replace(",", "."));
  const h = t.match(/(\d+(?:[.,]\d+)?)\s*h\b/);
  if (h) return parseFloat(h[1].replace(",", ".")) * 60;
  const s = t.match(/(\d+)\s*s\b/);
  if (s) return Math.max(0.5, +s[1] / 60);
  return null;
};

const levelIn = (t: string): number | null => {
  const m = t.match(/(?:niveau|à)\s+([1-9])(?:\s*-\s*[1-9])?\b(?!\s*(?:°|min|h\b|cm|g\b|ml|s\b))/);
  return m ? +m[1] : null;
};

const round = (n: number) => Math.max(0.5, Math.round(n * 2) / 2);

/**
 * Sous-étapes d'une étape qui n'en a pas, découpées dans son texte (une phrase ou un geste par
 * sous-étape, la durée et le niveau qui y sont écrits). Leur somme est ramenée au geste de l'étape
 * (activeMin), sans jamais dépasser sa durée. Seulement quand l'IA les a oubliées : une fiche
 * écrite à la main les porte (test des fiches).
 */
export function fallbackPhases(s: Step): StepPhase[] {
  // « c. à s. » n'est pas une fin de phrase : ses points sont mis de côté le temps du découpage.
  const DOT = "\u2024";
  const parts = s.text
    .replace(/\bc\. à ([sc])\./g, `c${DOT} à $1${DOT}`)
    .split(/(?<=[.;!?])\s+/)
    .map((x) => x.trim().replace(/[.;]$/, "").replaceAll(DOT, "."))
    .filter((x) => x.length >= 3);
  const chunks = parts.length >= 2 ? parts.slice(0, 6) : [s.text.trim(), "Termine et vérifie le repère"];
  const raw = chunks.map((c) => minutesIn(c));
  const dur = s.durationMin ?? s.activeMin ?? 2;
  const budget = Math.min(dur, Math.max(s.activeMin ?? 0, 1));
  // Sans durée écrite, une sous-étape vaut sa part du geste ; le tout ramené au budget.
  const known = raw.reduce<number>((x, m) => x + (m ?? 0), 0);
  const unknown = raw.filter((m) => m == null).length;
  const share = unknown ? Math.max(0.5, (budget - Math.min(known, budget)) / unknown) : 0;
  let mins = raw.map((m) => m ?? share);
  const sum = mins.reduce((x, m) => x + m, 0);
  if (sum > budget && sum > 0) mins = mins.map((m) => (m * budget) / sum);
  let level = s.hobLevel ?? null;
  const phases = chunks.map((c, k) => {
    level = levelIn(c) ?? level;
    return { text: c.length > 140 ? `${c.slice(0, 137)}…` : c, min: round(mins[k]), hobLevel: level, batch: null };
  });
  // Arrondis : jamais plus long que l'étape.
  while (phases.reduce((x, p) => x + p.min, 0) > dur + 0.05) {
    const big = phases.reduce((a, b) => (b.min > a.min ? b : a));
    if (big.min <= 0.5) break;
    big.min -= 0.5;
  }
  return phases;
}

/** Les étapes de la recette, chacune avec ses sous-étapes (complétées par le code si elles manquent). */
export function withPhases<S extends Step>(steps: S[]): { steps: S[]; filled: number[] } {
  const filled: number[] = [];
  const out = steps.map((s, i) => {
    if (s.phases?.length || !needsPhases(s)) return s;
    filled.push(i + 1);
    return { ...s, phases: fallbackPhases(s) };
  });
  return { steps: out, filled };
}
