// Estimation déterministe d'une session à plusieurs recettes : durée, conflits
// d'équipement, et recettes qui s'accordent avec la sélection. Pas d'IA ici.
// C'est une première approche avant le vrai planificateur (étape 4) : une seule
// personne cuisine, ses gestes actifs s'enchaînent, et les attentes (mijotage,
// four) se recouvrent avec le travail sur les autres recettes.

import { joinFr } from "@/lib/week/tastes";

export interface StepLike {
  kind: "prep" | "sear" | "braise" | "boil" | "bake" | "rest" | "cool";
  durationMin: number | null;
  activeMin: number | null;
  equipmentId: string | null;
  ovenTemp: number | null;
}

export interface RecipeLike {
  slug: string;
  name: string;
  tags: string[];
  fridgeDays: number | null;
  steps: StepLike[];
}

// Équipement unique : deux recettes qui en ont besoin longtemps doivent s'enchaîner.
const SINGLE = new Set(["cocotte", "faitout", "poele-28"]);
const LONG_USE_MIN = 25; // au-delà, l'occupation compte comme un conflit
const PROTEINS = ["porc", "poulet", "boeuf", "bœuf", "dinde", "saumon", "thon", "saucisse", "lieu", "espadon", "oeuf", "œuf"];

/** Minutes où il faut être devant : la valeur saisie, sinon une estimation par type d'étape. */
export function activeOf(s: StepLike): number {
  if (s.activeMin != null) return s.activeMin;
  const d = s.durationMin ?? 0;
  return s.kind === "prep" || s.kind === "sear" ? d : Math.min(d, Math.max(2, d * 0.2));
}

function isOven(s: StepLike) {
  return s.kind === "bake" || s.equipmentId === "oven" || (s.ovenTemp != null && s.kind !== "prep");
}

export interface RecipeEstimate {
  slug: string;
  activeMin: number;
  longestWaitMin: number; // plus longue attente d'un seul tenant (mijotage, four)
  ovenMin: number;
  ovenTemps: number[];
  equipmentMin: Record<string, number>;
  protein: string | null;
  usesOven: boolean;
}

export function estimateRecipe(r: RecipeLike): RecipeEstimate {
  const equipmentMin: Record<string, number> = {};
  let active = 0;
  let longestWait = 0;
  let ovenMin = 0;
  const temps = new Set<number>();
  for (const s of r.steps) {
    const a = activeOf(s);
    active += a;
    longestWait = Math.max(longestWait, (s.durationMin ?? 0) - a);
    if (s.equipmentId) equipmentMin[s.equipmentId] = (equipmentMin[s.equipmentId] ?? 0) + (s.durationMin ?? 0);
    if (isOven(s)) {
      ovenMin += s.durationMin ?? 0;
      if (s.ovenTemp) temps.add(s.ovenTemp);
    }
  }
  const text = (r.name + " " + r.tags.join(" ")).toLowerCase();
  const protein = PROTEINS.find((p) => text.includes(p)) ?? null;
  return {
    slug: r.slug,
    activeMin: active,
    longestWaitMin: longestWait,
    ovenMin,
    ovenTemps: [...temps],
    equipmentMin,
    protein: protein === "bœuf" ? "boeuf" : protein === "œuf" ? "oeuf" : protein,
    usesOven: ovenMin > 0,
  };
}

export interface Conflict {
  kind: "oven_temp" | "single_equipment";
  message: string;
  extraMin: number; // temps ajouté parce qu'il faut enchaîner
}

export interface SessionEstimate {
  totalMin: number;
  activeMin: number;
  conflicts: Conflict[];
  fridgeDays: number | null;
  perRecipe: RecipeEstimate[];
}

const EQUIPMENT_NAMES: Record<string, string> = {
  "cocotte": "la cocotte",
  faitout: "le faitout",
  "poele-28": "la poêle",
};

export function estimateSession(recipes: RecipeLike[]): SessionEstimate {
  const per = recipes.map(estimateRecipe);
  const conflicts: Conflict[] = [];

  // Four : un seul, donc une seule température à la fois.
  const ovenUsers = per.filter((p) => p.usesOven && p.ovenTemps.length > 0);
  const temps = [...new Set(ovenUsers.flatMap((p) => p.ovenTemps))].sort((a, b) => a - b);
  if (temps.length > 1) {
    const extra = Math.min(...ovenUsers.map((p) => p.ovenMin));
    conflicts.push({
      kind: "oven_temp",
      message: `Le four est demandé à ${joinFr(temps.map((t) => `${t}\u00a0°C`))} : les cuissons au four s'enchaînent, elles ne peuvent pas se faire en même temps.`,
      extraMin: extra,
    });
  }

  // Récipients uniques utilisés longtemps par plusieurs recettes.
  for (const eq of SINGLE) {
    const users = per.filter((p) => (p.equipmentMin[eq] ?? 0) >= LONG_USE_MIN);
    if (users.length > 1) {
      const names = users.map((u) => recipes.find((r) => r.slug === u.slug)!.name);
      conflicts.push({
        kind: "single_equipment",
        message: `${capitalize(EQUIPMENT_NAMES[eq])} sert longtemps à ${joinFr(names)} : il faut les enchaîner (ou la laver entre ${names.length > 2 ? "chaque plat" : "les deux"}).`,
        extraMin: Math.min(...users.map((u) => u.equipmentMin[eq])),
      });
    }
  }

  const activeMin = per.reduce((s, p) => s + p.activeMin, 0);
  // Une personne : le travail actif s'additionne ; la plus longue attente d'une recette
  // ne se recouvre qu'avec le travail des autres.
  const critical = Math.max(0, ...per.map((p) => p.activeMin + p.longestWaitMin));
  const extra = conflicts.reduce((s, c) => s + c.extraMin, 0);
  // Borne basse max(actif, chemin critique), plus 25 % de l'autre terme : on n'arrive
  // jamais à caser tout le travail actif dans les attentes (gestes à heure fixe, lavage).
  const totalMin = Math.max(activeMin, critical) + 0.25 * Math.min(activeMin, critical) + extra;
  const days = recipes.map((r) => r.fridgeDays).filter((d): d is number => d != null);

  return { totalMin, activeMin, conflicts, fridgeDays: days.length ? Math.min(...days) : null, perRecipe: per };
}

export interface Pairing {
  slug: string;
  addedMin: number;
  conflicts: number;
  reasons: string[];
}

/** Classe les recettes candidates selon ce qu'elles ajoutent à la sélection. */
export function suggestPairings(selected: RecipeLike[], candidates: RecipeLike[], limit = 5): Pairing[] {
  if (selected.length === 0) return [];
  const base = estimateSession(selected);
  const usedProteins = new Set(base.perRecipe.map((p) => p.protein).filter(Boolean));
  const ovenBusy = base.perRecipe.some((p) => p.usesOven);
  const scored = candidates
    .filter((c) => !selected.some((s) => s.slug === c.slug))
    .map((c) => {
      const est = estimateSession([...selected, c]);
      const me = est.perRecipe[est.perRecipe.length - 1];
      const added = est.totalMin - base.totalMin;
      const newConflicts = est.conflicts.length - base.conflicts.length;
      const reasons: string[] = [];
      if (newConflicts === 0) reasons.push("aucun conflit d'équipement");
      if (me.usesOven && !ovenBusy) reasons.push("utilise le four, libre pour l'instant");
      if (!me.usesOven && ovenBusy) reasons.push("tout sur les plaques, le four reste aux autres");
      if (me.protein && !usedProteins.has(me.protein)) reasons.push(`varie la protéine (${me.protein})`);
      if (me.protein && usedProteins.has(me.protein)) reasons.push(`même protéine (${me.protein})`);
      const variety = me.protein && !usedProteins.has(me.protein) ? 1 : 0;
      const score = added + newConflicts * 45 - variety * 15 - (me.usesOven !== ovenBusy ? 10 : 0);
      return { slug: c.slug, addedMin: Math.round(added), conflicts: newConflicts, reasons, score };
    })
    .sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map(({ score: _score, ...p }) => p);
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
