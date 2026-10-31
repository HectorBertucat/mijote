// Assistant : le calcul, sans base ni réseau (tests/assistant.test.ts).
//
// L'IA propose, le code vérifie :
// - le contexte donné au modèle est un résumé chiffré construit ici (buildContext), à partir d'un
//   instantané des vraies données (Snapshot, chargé par ./store) : pas de dump de base ;
// - le modèle ne peut qu'appeler des outils typés (ACTION_TOOLS, outils stricts) qui *proposent* une
//   action ; checkAction la revalide (schéma, existence, bornes, cohérence nutritionnelle via les
//   modules purs des mangeurs et des habitudes) et calcule les chiffres de la carte ;
// - la personne confirme d'un geste, et ./store exécute avec les mêmes fonctions que l'interface,
//   après une nouvelle vérification sur les données du moment.
import { z } from "zod";
import { portionOf, type DayTarget, type MealRef, type Outside } from "@/lib/eaters/core";
import { adviceOf, checkHabit, daysLabel, HABIT_FOODS, habitMacros, isShaker, macrosOf, outsideMean, outsideWeek, type HabitLike } from "@/lib/eaters/habits";
import { FOODS } from "@/lib/nutrition/foods";
import { recipeFit, weekFit, type FitEater } from "@/lib/week/fit";

// ─── Instantané des données ───

export interface SnapHabit {
  id: string;
  label: string;
  meal: string;
  weekdays: number[];
  items: { food: string; grams: number }[];
  kcal: number;
  proteinG: number;
  /** Habitude commune au foyer (sans personne) : comptée, mais retirée depuis Santé. */
  shared?: boolean;
}

export interface SnapPerson {
  id: string;
  name: string;
  goal: string | null; // libellé de l'objectif de Santé
  dayTarget: DayTarget | null;
  ref: MealRef | null;
  baseUnits: number;
  /** Hors batch d'un jour moyen ; null = rien de dit. */
  outside: Outside | null;
  outsideSource: "habitudes" | "chiffre" | null;
  habits: SnapHabit[];
  /** Un repas moyen du batch pour cette personne (semaine en cours, sinon bibliothèque). */
  batchMeal: { kcal: number; protein: number } | null;
  dislikes: string[];
  missing: string[];
}

export interface SnapRecipe {
  slug: string;
  name: string;
  kcalUnit: number | null;
  proteinUnit: number | null;
  status: string;
  /** Personnes à qui la recette n'est pas servie (goûts). */
  excludedFor: string[];
}

export interface SnapBox {
  id: string;
  name: string;
  personId: string | null;
  kcal: number | null;
  proteinG: number | null;
  place: "fridge" | "freezer";
  limit: string;
  freshness: "ok" | "soon" | "past";
}

export interface Snapshot {
  today: string;
  /** Qui parle (profil actif de l'appareil). */
  speakerId: string;
  people: SnapPerson[];
  week: {
    start: string;
    days: number;
    label: string;
    selected: string[]; // slugs, dans l'ordre
    list: { status: string; changed: boolean; ordered: boolean } | null;
  };
  recipes: SnapRecipe[];
  boxes: SnapBox[];
}

/** La page d'où la question est posée : son chemin et ce qu'on y regarde. */
export interface PageContext {
  path: string;
  recipeSlug?: string | null;
}

// ─── Actions proposées ───

/** Plus de recettes que ça dans une semaine : la session ne tient pas (comme addRecipe). */
export const MAX_WEEK_RECIPES = 4;
/** Une habitude ajoutée ne doit pas pousser la journée au-delà de la cible de plus que ça. */
export const OVER_KCAL = 300;
/** Trois propositions au plus par réponse. */
export const MAX_ACTIONS = 3;

const why = z.string().describe("En une phrase courte : pourquoi cette action, pour la personne concernée");

export const ACTION_TOOLS = {
  ajouter_recette: {
    description: "Proposer d'ajouter une recette de la bibliothèque à la semaine en cours (4 recettes au plus). La personne confirme d'un bouton.",
    schema: z.object({ slug: z.string().describe("slug exact d'une recette de la bibliothèque"), why }),
  },
  retirer_recette: {
    description: "Proposer de retirer une recette retenue pour la semaine en cours.",
    schema: z.object({ slug: z.string().describe("slug d'une recette retenue"), why }),
  },
  ajouter_habitude: {
    description: "Proposer d'ajouter une habitude hors batch à une personne (shaker, petit-déjeuner, en-cas), composée d'aliments de la table nutritionnelle. Les kcal et protéines sont calculés par l'appli.",
    schema: z.object({
      personId: z.string(),
      label: z.string().describe("nom court, ex. « Shaker du matin »"),
      meal: z.enum(["breakfast", "snack"]),
      weekdays: z.array(z.number()).describe("jours, 0 = lundi … 6 = dimanche"),
      items: z.array(z.object({ food: z.string().describe("id d'aliment de la liste donnée"), grams: z.number() })),
      why,
    }),
  },
  retirer_habitude: {
    description: "Proposer de retirer une habitude hors batch d'une personne.",
    schema: z.object({ personId: z.string(), habitId: z.string(), why }),
  },
  manger_boite: {
    description: "Proposer de marquer une boîte du frigo ou du congélo comme mangée par une personne (elle va à son journal).",
    schema: z.object({ boxId: z.string(), personId: z.string(), why }),
  },
  faire_courses: {
    description: "Proposer de lancer la liste de courses des recettes retenues pour la semaine en cours.",
    schema: z.object({ why }),
  },
} as const;

export type ActionKind = keyof typeof ACTION_TOOLS;

/** Le nom d'une action, quand la vérification l'a écartée (pas de carte). */
export const KIND_LABEL: Record<ActionKind, string> = {
  ajouter_recette: "Ajouter une recette",
  retirer_recette: "Retirer une recette",
  ajouter_habitude: "Ajouter une habitude",
  retirer_habitude: "Retirer une habitude",
  manger_boite: "Manger une boîte",
  faire_courses: "Faire les courses",
};
export const ACTION_KINDS = Object.keys(ACTION_TOOLS) as ActionKind[];
export type ActionInput<K extends ActionKind = ActionKind> = { [P in K]: { kind: P } & z.infer<(typeof ACTION_TOOLS)[P]["schema"]> }[K];

/** Les outils tels qu'envoyés à l'API (schéma JSON strict, sans bornes : le code borne). */
export function toolDefinitions() {
  return ACTION_KINDS.map((name) => {
    const { $schema: _s, ...input_schema } = z.toJSONSchema(ACTION_TOOLS[name].schema) as Record<string, unknown>;
    return { name, description: ACTION_TOOLS[name].description, input_schema };
  });
}

/** Un appel d'outil brut → une action typée, ou null (outil inconnu, entrée non conforme). */
export function parseToolCall(call: { name: string; input: unknown }): ActionInput | null {
  if (!(ACTION_KINDS as string[]).includes(call.name)) return null;
  const kind = call.name as ActionKind;
  const r = ACTION_TOOLS[kind].schema.safeParse(call.input);
  return r.success ? ({ kind, ...r.data } as ActionInput) : null;
}

/** Ce que la carte montre : chiffres calculés ici, jamais repris du texte du modèle. */
export interface ActionCard {
  title: string;
  lines: { label: string; value: string }[];
  notes: string[];
}

export type Checked = ({ ok: true } & ActionCard) | { ok: false; reason: string };

/** Une action gardée dans la conversation, avec sa vérification et son sort. */
export interface AssistantAction {
  input: ActionInput;
  why: string;
  check: Checked;
  status: "proposed" | "applied" | "dismissed" | "refused";
  /** Ce que l'exécution a dit (ou pourquoi elle a échoué). */
  result?: string;
  /** La période à laquelle l'action s'applique (recettes, courses). */
  weekStart?: string;
  /** Où aller ensuite (la liste de courses créée). */
  href?: string;
}

const fr = (n: number) => Math.round(n).toLocaleString("fr-FR");
const kcal = (n: number) => `${fr(n)} kcal`;
const g = (n: number) => `${fr(n)} g`;
const unitsFr = (u: number) => `${u.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} u`;

/** Ce qui manque (ou dépasse) par jour : cible − deux repas du batch − hors batch. */
export function dayGap(p: Pick<SnapPerson, "dayTarget" | "batchMeal">, outside: Outside): { kcal: number; protein: number } | null {
  if (!p.dayTarget || !p.batchMeal) return null;
  return { kcal: Math.round(p.dayTarget.kcal - 2 * p.batchMeal.kcal - outside.kcal), protein: Math.round(p.dayTarget.proteinG - 2 * p.batchMeal.protein - outside.protein) };
}

const gapLabel = (x: number, unit: (n: number) => string) => (x > 0 ? `il manque ${unit(x)}` : x < 0 ? `${unit(-x)} de trop` : "pile");

/** Hors batch d'un jour moyen avec ces habitudes (repli : le chiffre libre, sinon rien). */
function outsideWith(p: SnapPerson, habits: HabitLike[]): Outside {
  if (habits.length || p.outsideSource === "habitudes") return outsideMean(outsideWeek(habits));
  return p.outside ?? { kcal: 0, protein: 0 };
}

const habitLike = (h: SnapHabit): HabitLike => ({ weekdays: h.weekdays, items: h.items, kcal: h.kcal, proteinG: h.proteinG });

/** Avant → après pour la journée d'une personne (lignes de carte). */
function gapLines(p: SnapPerson, before: Outside, after: Outside): ActionCard["lines"] {
  const b = dayGap(p, before);
  const a = dayGap(p, after);
  if (!b || !a) return [];
  return [
    { label: "Protéines du jour", value: `${gapLabel(b.protein, g)} → ${gapLabel(a.protein, g)}` },
    { label: "Énergie du jour", value: `${gapLabel(b.kcal, kcal)} → ${gapLabel(a.kcal, kcal)}` },
  ];
}

/** Vérifie une action proposée sur l'instantané : refus motivé, ou carte chiffrée. */
export function checkAction(a: ActionInput, s: Snapshot): Checked {
  const person = (id: string) => s.people.find((p) => p.id === id);
  switch (a.kind) {
    case "ajouter_recette": {
      const r = s.recipes.find((x) => x.slug === a.slug);
      if (!r || r.status === "archived") return { ok: false, reason: "Cette recette n'est pas dans la bibliothèque." };
      if (s.week.selected.includes(r.slug)) return { ok: false, reason: `${r.name} est déjà dans la semaine.` };
      if (s.week.selected.length >= MAX_WEEK_RECIPES) return { ok: false, reason: `La semaine a déjà ${MAX_WEEK_RECIPES} recettes : retires-en une d'abord.` };
      const lines: ActionCard["lines"] = [];
      const notes: string[] = [];
      for (const p of s.people) {
        if (r.excludedFor.includes(p.id)) {
          lines.push({ label: p.name, value: "pas servie (goûts)" });
          continue;
        }
        const part = portionOf({ baseUnits: p.baseUnits, ref: p.ref }, r);
        if (part.kcal == null) {
          lines.push({ label: p.name, value: `${unitsFr(part.units)}, macros inconnues` });
          continue;
        }
        lines.push({ label: p.name, value: `${unitsFr(part.units)} · ${kcal(part.kcal)} · ${g(part.protein!)} de protéines` });
        if (part.verdict?.protein === "low") notes.push(`Pour ${p.name}, la part reste sous son repère de protéines (${g(p.ref!.proteinMin)} au moins).`);
        if (part.capped) notes.push(`Pour ${p.name}, la part ne peut pas viser son repère : le plat est ${part.verdict!.kcal === "low" ? "trop léger" : "trop riche"}.`);
      }
      if (r.kcalUnit == null) notes.push("Macros de la recette inconnues : la part suit la part de base.");
      return { ok: true, title: `Ajouter ${r.name} à la semaine`, lines, notes };
    }
    case "retirer_recette": {
      const r = s.recipes.find((x) => x.slug === a.slug);
      if (!r || !s.week.selected.includes(a.slug)) return { ok: false, reason: "Cette recette n'est pas dans la semaine." };
      const left = s.week.selected.length - 1;
      return { ok: true, title: `Retirer ${r.name} de la semaine`, lines: [{ label: "Reste", value: `${left} recette${left > 1 ? "s" : ""}` }], notes: s.week.list?.ordered ? ["La commande de la semaine est déjà passée."] : [] };
    }
    case "ajouter_habitude": {
      const p = person(a.personId);
      if (!p) return { ok: false, reason: "Personne inconnue du foyer." };
      const weekdays = [...new Set(a.weekdays)];
      if (weekdays.some((d) => !Number.isInteger(d))) return { ok: false, reason: "Jours invalides." };
      const items = a.items.map((i) => ({ food: i.food, grams: Math.round(i.grams) }));
      const err = checkHabit({ label: a.label, meal: a.meal, weekdays, items });
      if (err) return { ok: false, reason: err };
      if (isShaker({ items }) && p.habits.some(isShaker)) return { ok: false, reason: `${p.name} a déjà un shaker : modifie-le plutôt que d'en ajouter un deuxième.` };
      const m = habitMacros(items);
      const before = outsideWith(p, p.habits.map(habitLike));
      const after = outsideWith(p, [...p.habits.map(habitLike), { weekdays, items, kcal: m.kcal, proteinG: m.proteinG }]);
      const gap = dayGap(p, after);
      if (gap && gap.kcal < -OVER_KCAL) return { ok: false, reason: `Avec cette habitude, la journée de ${p.name} dépasserait sa cible de ~${kcal(-gap.kcal)}.` };
      const notes: string[] = [];
      if (!p.dayTarget) notes.push(`${p.name} n'a pas encore de cible : l'effet sur sa journée n'est pas chiffré.`);
      const before0 = dayGap(p, before);
      if (before0 && before0.protein < 15 && before0.kcal < 250) notes.push(`Les repas du batch couvraient déjà la journée de ${p.name}.`);
      return {
        ok: true,
        title: `${a.label.trim()} pour ${p.name}`,
        lines: [
          { label: "Composition", value: items.map((i) => `${FOODS[i.food as keyof typeof FOODS].name.toLowerCase()} ${g(i.grams)}`).join(", ") },
          { label: "Apporte", value: `${kcal(m.kcal)} · ${g(m.proteinG)} de protéines, ${daysLabel(weekdays)}` },
          ...gapLines(p, before, after),
        ],
        notes,
      };
    }
    case "retirer_habitude": {
      const p = person(a.personId);
      const h = p?.habits.find((x) => x.id === a.habitId);
      if (!p || !h) return { ok: false, reason: "Habitude introuvable pour cette personne." };
      if (h.shared) return { ok: false, reason: "Habitude commune au foyer : retire-la depuis Santé › Habitudes." };
      const m = macrosOf(habitLike(h));
      const before = outsideWith(p, p.habits.map(habitLike));
      const rest = p.habits.filter((x) => x.id !== h.id).map(habitLike);
      const after = rest.length ? outsideWith(p, rest) : { kcal: 0, protein: 0 };
      return { ok: true, title: `Retirer « ${h.label} » de ${p.name}`, lines: [{ label: "Apportait", value: `${kcal(m.kcal)} · ${g(m.protein)} de protéines, ${daysLabel(h.weekdays)}` }, ...gapLines(p, before, after)], notes: [] };
    }
    case "manger_boite": {
      const b = s.boxes.find((x) => x.id === a.boxId);
      const p = person(a.personId);
      if (!b) return { ok: false, reason: "Cette boîte n'est plus au frigo." };
      if (!p) return { ok: false, reason: "Personne inconnue du foyer." };
      if (b.place === "freezer") return { ok: false, reason: "Cette boîte est au congélo : sors-la d'abord." };
      const notes: string[] = [];
      const owner = b.personId ? person(b.personId) : null;
      if (owner && owner.id !== p.id) notes.push(`Boîte prévue pour ${owner.name}.`);
      if (b.freshness === "past") notes.push(`À manger avant le ${b.limit} : la date est passée.`);
      return { ok: true, title: `${p.name} mange ${b.name}`, lines: [{ label: "Au journal", value: b.kcal != null ? `${kcal(b.kcal)} · ${g(b.proteinG ?? 0)} de protéines` : "macros inconnues" }], notes };
    }
    case "faire_courses": {
      if (!s.week.selected.length) return { ok: false, reason: "Aucune recette retenue pour la semaine." };
      if (s.week.list && !s.week.list.changed) return { ok: false, reason: "La liste de cette semaine est déjà faite et à jour." };
      const names = s.week.selected.map((slug) => s.recipes.find((r) => r.slug === slug)?.name ?? slug);
      return {
        ok: true,
        title: "Faire la liste de courses",
        lines: [{ label: s.week.label, value: names.join(", ") }],
        notes: s.week.list?.ordered ? ["Une commande est déjà passée pour cette semaine : la nouvelle liste s'y ajoute."] : [],
      };
    }
  }
}

/** Les appels d'outils d'une réponse → actions vérifiées (trois au plus, doublons écartés). */
export function reviewToolCalls(calls: { name: string; input: unknown }[], s: Snapshot): AssistantAction[] {
  const out: AssistantAction[] = [];
  const seen = new Set<string>();
  for (const c of calls) {
    if (out.length >= MAX_ACTIONS) break;
    const input = parseToolCall(c);
    if (!input) continue;
    const { why: w, ...rest } = input as ActionInput & { why: string };
    const key = JSON.stringify(rest);
    if (seen.has(key)) continue;
    seen.add(key);
    const check = checkAction(input, s);
    out.push({ input, why: w.trim().slice(0, 200), check, status: check.ok ? "proposed" : "refused" });
  }
  return out;
}

// ─── Modèle ───

/**
 * Haiku par défaut : répondre, conseiller, proposer une ou deux actions sur un contexte déjà
 * chiffré. Sonnet seulement pour planifier (composer la semaine entière pour tout le foyer, ou un
 * long message) : plusieurs recettes à arbitrer entre les cibles de chacun, comme la règle 1.
 */
export const PLANNING = /(toute la semaine|semaine enti[eè]re|planifi|compose[rz]? (la|ma|notre) semaine|menu de la semaine|organise[rz]? (la|ma|notre) semaine)/i;
export const pickModel = (text: string): "small" | "plan" => (PLANNING.test(text) || text.length > 600 ? "plan" : "small");

// ─── Contexte ───

/** Ce que l'assistant sait du foyer, en texte compact. Tous les chiffres viennent de l'appli. */
export function buildContext(s: Snapshot): string {
  const L: string[] = [`Aujourd'hui : ${s.today}.`];
  const fitters: FitEater[] = s.people.map((p) => ({ id: p.id, name: p.name, baseUnits: p.baseUnits, ref: p.ref, dayTarget: p.dayTarget, outside: outsideWith(p, p.habits.map(habitLike)), hasShaker: p.habits.some(isShaker) }));
  L.push("", "## Foyer");
  for (const p of s.people) {
    const head = `- ${p.name} (personId ${p.id})${p.id === s.speakerId ? " — c'est la personne qui te parle" : ""}`;
    L.push(head);
    L.push(`  objectif : ${p.goal ?? "aucun"} ; cible du jour : ${p.dayTarget ? `${kcal(p.dayTarget.kcal)}, ${g(p.dayTarget.proteinG)} de protéines` : `aucune (${p.missing.join(", ") || "profil incomplet"})`}`);
    if (p.ref) L.push(`  repère d'un repas du batch : ${fr(p.ref.kcalMin)}–${kcal(p.ref.kcalMax)}, ${fr(p.ref.proteinMin)}–${g(p.ref.proteinMax)} de protéines`);
    if (p.batchMeal) L.push(`  repas moyen du batch : ${kcal(p.batchMeal.kcal)}, ${g(p.batchMeal.protein)} de protéines (2 repas par jour)`);
    const habits = p.habits.length
      ? p.habits.map((h) => {
          const m = macrosOf(habitLike(h));
          return `« ${h.label} » (habitId ${h.id}, ${daysLabel(h.weekdays)}, ${kcal(m.kcal)}, ${g(m.protein)} de protéines)`;
        })
      : [];
    L.push(`  hors batch : ${habits.length ? habits.join(" ; ") : p.outside ? `${kcal(p.outside.kcal)}, ${g(p.outside.protein)} de protéines par jour (chiffre libre)` : "rien de dit"}`);
    const gap = dayGap(p, outsideWith(p, p.habits.map(habitLike)));
    if (gap && p.dayTarget && p.batchMeal) {
      const a = adviceOf(p.dayTarget, p.batchMeal, outsideWith(p, p.habits.map(habitLike)), p.habits.some(isShaker));
      L.push(`  bilan d'un jour moyen : protéines ${gapLabel(gap.protein, g)}, énergie ${gapLabel(gap.kcal, kcal)}. Conseil de l'appli : ${a.text}`);
    }
    if (p.dislikes.length) L.push(`  n'aime pas : ${p.dislikes.join(", ")}`);
  }

  L.push("", `## Semaine en cours (${s.week.label})`);
  if (s.week.selected.length) {
    L.push(`Recettes retenues (${s.week.selected.length}/${MAX_WEEK_RECIPES}) : ${s.week.selected.map((slug) => s.recipes.find((r) => r.slug === slug)?.name ?? slug).join(", ")}.`);
    // Adéquation aux repères (src/lib/week/fit.ts), recettes à parts égales : le constat et la suggestion de l'appli.
    const live = s.recipes.filter((r) => r.status !== "archived");
    const fit = weekFit(fitters, s.week.selected.map((slug) => live.find((r) => r.slug === slug)).filter((r) => !!r), { library: live, excluded: new Map(live.map((r) => [r.slug, new Set(r.excludedFor)])) });
    for (const p of fit.people) if (p.perMeal && p.ref) L.push(`- ${p.name} : un repas moyen de la sélection fait ${kcal(p.perMeal.kcal)}, ${g(p.perMeal.protein)} de protéines (${p.level === "loin" ? "loin du repère" : p.level === "juste" ? "juste" : "dans le repère"})`);
    for (const w of fit.warnings) L.push(`  Écart pour ${w.name} : ${w.text}. Suggestion de l'appli : ${w.suggestion.text}`);
  } else L.push("Aucune recette retenue.");
  L.push(s.week.list ? `Liste de courses : ${s.week.list.ordered ? "commandée" : "faite"}${s.week.list.changed ? ", mais la sélection a changé depuis" : ", à jour"}.` : "Pas encore de liste de courses.");

  L.push("", "## Bibliothèque (slug — nom : part de chacun et adéquation à son repère, calculées par l'appli)");
  for (const r of s.recipes) {
    if (r.status === "archived") continue;
    const parts = s.people.map((p) => {
      if (r.excludedFor.includes(p.id)) return `${p.name} pas servie`;
      const x = portionOf({ baseUnits: p.baseUnits, ref: p.ref }, r);
      if (x.kcal == null) return `${p.name} ?`;
      const f = recipeFit(fitters.find((e) => e.id === p.id)!, r);
      return `${p.name} ${kcal(x.kcal)}/${g(x.protein!)} prot.${f.level ? ` (${f.level}${f.level !== "bien" ? ` : ${FIT_ISSUE[f.issue!]}` : ""})` : ""}`;
    });
    L.push(`- ${r.slug} — ${r.name}${s.week.selected.includes(r.slug) ? " [retenue]" : ""}${r.status === "liked" ? " [aimée]" : ""} : ${parts.join(", ")}`);
  }

  L.push("", "## Frigo et congélo");
  if (s.boxes.length) {
    for (const b of s.boxes) {
      const who = b.personId ? s.people.find((p) => p.id === b.personId)?.name : null;
      L.push(`- ${b.name} (boxId ${b.id}${who ? `, pour ${who}` : ""}, ${b.place === "freezer" ? "congélo" : "frigo"}, avant le ${b.limit}${b.freshness === "past" ? ", date passée" : b.freshness === "soon" ? ", à manger vite" : ""}) : ${b.kcal != null ? `${kcal(b.kcal)}, ${g(b.proteinG ?? 0)} de protéines` : "macros inconnues"}`);
    }
  } else L.push("Vide.");

  L.push("", "## Aliments pour une habitude (id : nom, pour 100 g)");
  L.push(HABIT_FOODS.map((id) => `${id} : ${FOODS[id].name} (${kcal(FOODS[id].kcal)}, ${g(FOODS[id].protein)} prot.)`).join(" ; "));
  return L.join("\n");
}

const FIT_ISSUE = { proteines: "peu protéiné", "trop-riche": "trop riche", "trop-leger": "trop léger" } as const;

/** Ce qu'on regarde : « fiche de … », « la semaine », etc. (ajouté au message, pas au contexte en cache). */
export function pageLine(page: PageContext, s: Snapshot): string {
  const r = page.recipeSlug ? s.recipes.find((x) => x.slug === page.recipeSlug) : null;
  if (r) return `La personne regarde la fiche de la recette ${r.name} (slug ${r.slug}).`;
  const where: [RegExp, string][] = [
    [/^\/semaine/, "la semaine"],
    [/^\/courses/, "les courses"],
    [/^\/frigo/, "le frigo"],
    [/^\/sante\/objectifs/, "ses objectifs de Santé"],
    [/^\/sante\/habitudes/, "ses habitudes hors batch"],
    [/^\/sante/, "sa page Santé"],
    [/^\/recettes/, "la bibliothèque de recettes"],
    [/^\/session/, "une session de cuisine"],
  ];
  const hit = where.find(([re]) => re.test(page.path));
  return `La personne est sur ${hit ? hit[1] : "l'accueil"}.`;
}
