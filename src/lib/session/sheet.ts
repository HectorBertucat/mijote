// La fenêtre d'une recette pendant la session (pur, testé : tests/session-produits.test.ts) : tous ses
// ingrédients pour cette session, aux quantités mises à l'échelle (par bol, au moment, au placard, et sa
// part d'une cuisson commune), puis toutes ses étapes telles que le planificateur les a adaptées à la
// cuisine (récipient, foyer et niveau, four, fournées, durées), l'étape en cours repérée, les faites
// barrées. Et ce qu'une étape reprend d'une étape d'avant (« le poulet saisi », poêle, étape 8).
import { article, formatQty, type PlanStep, type SessionPlan, type StepUse } from "./planner";
import { currentPhase, stepStatus, type SessionState, type StepStatus } from "./state";
import { batchesLabel, hobName, shareOf } from "./guide";
import { parseGesture } from "./gestures";
import { bowlParts, stepHead, type TextPart } from "./text";
import { wordPattern } from "./products";
import type { Holder } from "./containers";

// ─── Ce qu'une étape reprend ───

export interface ProductLine extends StepUse {
  /** L'étape qui le fait : son numéro dans la session, son titre, où elle en est. */
  no: number;
  title: string;
  status: StepStatus;
  recipeSlug: string | null;
  /** « poêle, étape 8 » ou « dans la cocotte, étape 3 » (déjà là). */
  from: string;
}

const lower = (s: string) => s.charAt(0).toLocaleLowerCase("fr") + s.slice(1);

/** Ce que reprend l'étape, nommé, avec d'où il vient et s'il est prêt (`status` de l'étape qui le fait). */
export function productLines(plan: Pick<SessionPlan, "steps">, state: SessionState, step: Pick<PlanStep, "uses">): ProductLine[] {
  return (step.uses ?? []).flatMap((u) => {
    const from = plan.steps.find((x) => x.id === u.stepId);
    if (!from) return [];
    const where = u.where ? (u.inPlace ? `déjà dans ${article(u.where).toLocaleLowerCase("fr")}` : lower(u.where)) : null;
    return [{ ...u, no: from.no, title: stepHead(from).head, status: stepStatus(state, from.id), recipeSlug: from.recipeSlug, from: [where, `étape ${from.no}`].filter(Boolean).join(", ") }];
  });
}

/** « le poulet saisi (poêle, étape 8) et la sauce (déjà dans la cocotte, étape 3) » : pour un texte d'aide. */
export function usesText(lines: Pick<ProductLine, "name" | "from">[]): string {
  const l = lines.map((x) => `${x.name} (${x.from})`);
  return l.length > 1 ? `${l.slice(0, -1).join(", ")} et ${l[l.length - 1]}` : (l[0] ?? "");
}

/** Le mot d'une reprise dans une consigne (« Poulet »), pour en faire une pastille : sa position, ou -1. */
export function productAt(text: string, word: string): { at: number; len: number } | null {
  const m = text.match(wordPattern(word));
  return m && m.index != null ? { at: m.index, len: m[0].length } : null;
}

export type RichPart = TextPart | { t: "product"; v: string; step: string };

/**
 * Une consigne en morceaux : les bols cités (« bol G ») et, pour chaque produit repris, la première fois
 * que la consigne le nomme (« Poulet ») deviennent des pastilles ; le reste reste du texte.
 */
export function richParts(text: string, letters: Iterable<string>, uses: Pick<StepUse, "word" | "stepId">[] = []): RichPart[] {
  let parts: RichPart[] = bowlParts(text, letters);
  for (const u of uses) {
    const k = parts.findIndex((p) => p.t === "text" && productAt(p.v, u.word));
    if (k < 0) continue;
    const p = parts[k] as { t: "text"; v: string };
    const m = productAt(p.v, u.word)!;
    const pieces: RichPart[] = [
      ...(m.at ? [{ t: "text" as const, v: p.v.slice(0, m.at) }] : []),
      { t: "product", v: p.v.slice(m.at, m.at + m.len), step: u.stepId },
      ...(m.at + m.len < p.v.length ? [{ t: "text" as const, v: p.v.slice(m.at + m.len) }] : []),
    ];
    parts = [...parts.slice(0, k), ...pieces, ...parts.slice(k + 1)];
  }
  return parts;
}

// ─── La fenêtre d'une recette ───

export interface SheetItem {
  item: string;
  name: string;
  food: string | null;
  qty: string | null;
  optional: boolean;
}
export interface SheetGroup {
  /** Lettre de session (null : au placard). */
  letter: string | null;
  holder: Holder | "placard";
  /** « Bol A · grand bol », « au moment », « au placard ». */
  container: string | null;
  items: SheetItem[];
  /** L'étape qui le prend. */
  stepNo: number | null;
}
export interface SheetShare {
  /** « le riz ». */
  the: string;
  /** Cette recette : cru et cuit (« 450 g cru, 1,13 kg cuit »), et sa part de la cuisson. */
  mine: string;
  share: number;
  total: string;
  /** Les autres recettes de la cuisson. */
  with: string[];
  stepNo: number;
}
export interface SheetPhase {
  text: string;
  min: number;
  status: StepStatus;
}
export interface SheetStep {
  id: string;
  no: number;
  /** Rang dans la recette (« 2 sur 5 »), null pour une action commune (le four). */
  n: number | null;
  title: string;
  detail: string;
  /** Récipient, foyer et niveau, four, fournées : ce que le moteur a choisi pour cette cuisine. */
  where: string[];
  minutes: number;
  status: StepStatus;
  /** L'étape montrée à l'écran (ou en cours). */
  current: boolean;
  phases: SheetPhase[];
  uses: ProductLine[];
  makes: string | null;
  /** Une cuisson commune à plusieurs recettes, ou le four pour la session. */
  shared: boolean;
}
export interface RecipeSheet {
  slug: string;
  name: string;
  color: string;
  scale: number;
  groups: SheetGroup[];
  shares: SheetShare[];
  steps: SheetStep[];
  /** Étapes faites sur toutes. */
  done: number;
}

const itemOf = (x: { item: string; food?: string | null; qty: string | null; optional?: boolean }): SheetItem => ({ item: x.item, name: parseGesture(x.item).base, food: x.food ?? null, qty: x.qty, optional: Boolean(x.optional) });

/** Ce que le moteur a choisi pour l'étape, en clair : « Cocotte », « grand foyer · 28 · niveau 5 », « four 220 °C · gradins 2 et 4 », « en 3 fournées ». */
export function whereOf(plan: Pick<SessionPlan, "hobs">, s: PlanStep): string[] {
  const level = s.hobLevelLabel ?? (s.hobLevel != null ? String(s.hobLevel) : null);
  return [
    s.kind !== "preheat" && s.equipmentName && !/^four$/i.test(s.equipmentName) ? s.equipmentName : null,
    s.hobId ? `${hobName(plan, s.hobId)}${level ? ` · niveau ${level}` : ""}` : null,
    s.oven ? `four ${s.oven.temp} °C${s.oven.levels.length ? ` · gradin${s.oven.levels.length > 1 ? "s" : ""} ${s.oven.levels.join(" et ")}` : ""}` : null,
    batchesLabel(s)?.toLocaleLowerCase("fr") ?? null,
  ].filter((x): x is string => Boolean(x));
}

/**
 * La fenêtre d'une recette : ses groupes d'ingrédients (bols, au moment, placard ; quantités de la
 * session), sa part d'une cuisson commune, et ses étapes adaptées dans l'ordre du plan (le préchauffage
 * qu'elle attend compris), avec l'état de chacune. `focusId` : l'étape montrée à l'écran.
 */
export function recipeSheet(plan: SessionPlan, state: SessionState, slug: string, focusId: string | null = null): RecipeSheet | null {
  const r = plan.recipes.find((x) => x.slug === slug);
  if (!r) return null;
  const mine = plan.steps.filter((s) => s.recipeSlug === slug || s.shared?.some((p) => p.recipeSlug === slug));
  const ids = new Set(mine.map((s) => s.id));
  // Le four qu'elle attend (préchauffage, action commune) fait partie de sa recette à l'écran.
  const ovens = plan.steps.filter((s) => s.kind === "preheat" && mine.some((m) => m.needs?.includes(s.id)));
  const steps = [...mine, ...ovens.filter((s) => !ids.has(s.id))].sort((a, b) => a.no - b.no);
  const own = steps.filter((s) => s.recipeSlug === slug && !s.tasks).sort((a, b) => a.order - b.order);
  const stepNoOf = (letter: string) => plan.steps.find((s) => s.bowls.includes(letter) && !s.tasks)?.no ?? null;

  // Bols de la recette (lettres de session), dans l'ordre des lettres.
  const groups: SheetGroup[] = plan.bowls
    .filter((b) => b.recipeSlug === slug)
    .map((b) => ({
      letter: b.letter,
      holder: b.holder ?? "bol",
      container: b.holder === "moment" ? "au moment" : b.holder === "assiette" ? "sur une assiette" : (b.containerLabel ?? null),
      items: b.items.map(itemOf),
      stepNo: stepNoOf(b.letter),
    }));
  // Hors bol (la viande sur le plateau, l'huile, le sel) : ce que les étapes disent, sans doublon.
  const loose: SheetItem[] = [];
  for (const s of mine)
    for (const i of s.ingredients ?? [])
      if (i.recipeSlug === slug && !i.bowl && !loose.some((x) => x.item === i.item)) loose.push(itemOf({ item: i.item, food: i.food, qty: i.qty, optional: i.optional }));
  for (const t of plan.prep.tasks)
    for (const i of t.items)
      if (i.recipeSlug === slug && !i.bowl && !loose.some((x) => x.name === parseGesture(i.item).base || x.item === i.item)) loose.push(itemOf({ item: `${i.item}, ${i.gesture}`, food: i.food, qty: i.qty }));
  if (loose.length) groups.push({ letter: null, holder: "placard", container: "hors bol", items: loose, stepNo: null });

  // Sa part d'une cuisson commune.
  const shares: SheetShare[] = mine.flatMap((s) => {
    const sh = shareOf(plan, s);
    const me = sh?.lines.find((l) => l.recipeSlug === slug);
    if (!sh || !me) return [];
    return [{ the: sh.the, mine: `${formatQty(me.rawG, null)} cru, ${me.qty}`, share: me.share, total: sh.total, with: sh.lines.filter((l) => l.recipeSlug !== slug).map((l) => l.name), stepNo: s.no }];
  });

  const sheetSteps: SheetStep[] = steps.map((s) => {
    const st = stepStatus(state, s.id);
    const n = st === "active" ? currentPhase(state, s) : null;
    const { head, rest } = stepHead(s);
    const k = own.findIndex((x) => x.id === s.id);
    return {
      id: s.id,
      no: s.no,
      n: k >= 0 ? k + 1 : null,
      title: head,
      detail: rest,
      where: whereOf(plan, s),
      minutes: Math.round(s.durationMin),
      status: st,
      current: s.id === focusId || (focusId == null && st === "active"),
      phases: (s.phases ?? []).map((p, i) => ({ text: p.text, min: p.min, status: state.phasesDone.has(`${i}:${s.id}`) || st === "done" ? "done" : i === n ? "active" : "todo" })),
      uses: productLines(plan, state, s),
      makes: s.makes ?? null,
      shared: s.recipeSlug !== slug,
    };
  });
  return { slug, name: r.name, color: r.color, scale: r.scale, groups, shares, steps: sheetSteps, done: sheetSteps.filter((s) => s.status === "done").length };
}
