// Ce que l'écran de session dit à chaque instant, déduit du plan et du journal (pur, testé :
// tests/session-guide.test.ts). Rien ne se lance tout seul : le bouton principal fait une seule
// chose et la nomme (« Lance 8 min : beurre + bol E », « Fait : bol G versé ») ; le retour défait
// la dernière action encore visible, pour chaque personne à deux ; un minuteur qui sonne dit de quoi
// il s'agit, ce qu'il touche, quoi faire maintenant et ce qui suit ; le fil range les étapes en
// « mains » (ce qui t'occupe), « en fond » (surveille, libre) et « ensuite ».
//
// Le plan du moteur (docs/session.md) dit l'attention de chaque moment (`attention`, `hands`,
// `reminders`, `phase.reminder`), ce qui entre dans chaque étape (`ingredients`, quantités mises à
// l'échelle), où attend chaque groupe (`holder` : au moment, bol, boîte, assiette) et la part de chaque
// recette d'une cuisson commune (`shared`). Un plan d'avant ne les porte pas : l'attention et les
// rappels se déduisent alors du texte, et les bols de l'étape tiennent lieu d'ingrédients.
import type { EventKind, SessionEvent, SessionState, TimerState } from "./state";
import { article, formatQty, type Person, type PlanBowl, type PlanBowlItem, type PlanStep, type PrepTask, type SessionPlan, type StepIngredient } from "./planner";
import { currentPhase, isReady, liveTimer, needsLeft, nextTodo, passiveMin, phaseIds, phaseTimer, stepStatus, stepTimer, withDone, type NeedLeft } from "./state";
import { waitAttention, type Attention } from "./attention";
import type { Holder } from "./containers";
import { parseGesture } from "./gestures";
import { bowlParts, clip, stepTitleOf } from "./text";

export type { Attention };
export const ATTENTION_LABELS: Record<Attention, string> = { mains: "mains prises", surveille: "à surveiller", libre: "libre" };

/** Un rappel pendant une attente : toutes les `everyMin` minutes, ou une fois à `atMin`. */
export interface Reminder {
  text: string;
  everyMin?: number;
  atMin?: number;
}

/** Un événement à écrire (forme de `send`). */
export interface Ev {
  id?: string;
  kind: EventKind;
  ref?: string | null;
  payload?: Record<string, unknown> | null;
}

// ─── Formats ───

export const fmtMin = (m: number) => (m < 1 ? `${Math.round(m * 60)} s` : `${Number.isInteger(m) ? m : m.toFixed(1).replace(".", ",")} min`);
const cap = (s: string) => s.charAt(0).toLocaleUpperCase("fr") + s.slice(1);

const HOB_NAMES = ["grand foyer", "foyer moyen", "petit foyer"];
/** « grand foyer · 28 » : le rang du foyer dans la cuisine, et son diamètre. */
export const hobName = (plan: Pick<SessionPlan, "hobs">, id: string) => {
  const i = plan.hobs.findIndex((x) => x.id === id);
  const h = plan.hobs[i];
  return `${HOB_NAMES[i] ?? h?.name ?? id}${h?.diameterCm ? ` · ${String(h.diameterCm).replace(".", ",")}` : ""}`;
};

/** Ce qui se passe pendant l'attente d'une étape, en deux mots (« mijotage », « préchauffage »). */
export function passiveLabel(step: Pick<PlanStep, "kind">): string {
  switch (step.kind) {
    case "preheat":
      return "préchauffage";
    case "bake":
      return "cuisson au four";
    case "braise":
      return "mijotage";
    case "rest":
      return "repos";
    case "cool":
      return "refroidissement";
    default:
      return "cuisson";
  }
}

// ─── Attention et rappels ───

const isAttention = (x: unknown): x is Attention => x === "mains" || x === "surveille" || x === "libre";
const field = (o: unknown, k: string): unknown => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined);

/** Le plan dit-il l'attention de ses étapes (moteur du 01/11/2026) ? */
const planned = (step: PlanStep) => isAttention(step.attention);

/** Plan d'avant : l'attention devinée au texte. */
function guess(step: PlanStep, text: string, waiting: boolean): Attention {
  if (step.kind === "preheat") return "libre";
  if (!waiting) return /de temps en temps/i.test(text) ? "surveille" : "mains";
  if (/remue|surveille|mélange|écume|retourne/i.test(text)) return "surveille";
  if (/hors du feu|repos|refroidi|tiédi/i.test(text) || step.kind === "rest" || step.kind === "cool") return "libre";
  if (step.hobId) return "surveille";
  return "libre";
}

/** L'attente qui finit une étape (après ses sous-étapes) : la même règle que le planificateur. */
function tail(step: PlanStep) {
  return waitAttention(step.text, step, Boolean(step.hobId) && !step.oven && step.kind !== "sear");
}

/**
 * Niveau d'attention de la sous-étape `n` (ou, sans sous-étape, du geste ; `passive` : de l'attente
 * qui suit) : « mains » occupe, « surveille » laisse faire autre chose en jetant un œil, « libre » non.
 */
export function attentionOf(step: PlanStep, n: number | null, passive = false): Attention {
  const ph = n != null ? step.phases?.[n] : undefined;
  if (ph && isAttention(ph.attention)) return ph.attention;
  if (!ph && planned(step)) {
    if (passive) return step.kind === "preheat" ? "libre" : tail(step).attention;
    // Le geste d'une étape sans sous-étape : les mains, s'il y en a.
    return step.hands?.length || step.activeMin > 0 ? "mains" : "libre";
  }
  if (ph) return guess(step, ph.text, ph.wait === true);
  return guess(step, step.text, passive);
}

function readReminders(raw: unknown): Reminder[] {
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  return list.flatMap((r): Reminder[] => {
    if (typeof r === "string") return r.trim() ? [{ text: r.trim(), everyMin: 5 }] : [];
    const text = field(r, "text") ?? field(r, "label");
    if (typeof text !== "string" || !text.trim()) return [];
    const every = Number(field(r, "everyMin") ?? field(r, "every") ?? NaN);
    const at = Number(field(r, "atMin") ?? field(r, "at") ?? NaN);
    if (every > 0) return [{ text: text.trim(), everyMin: every }];
    if (at >= 0) return [{ text: text.trim(), atMin: at }];
    return [{ text: text.trim(), everyMin: 5 }];
  });
}

/**
 * Les rappels d'une attente. Plan du moteur : ceux de la sous-étape (`reminder`), ou pour l'attente qui
 * finit l'étape, ceux de `reminders` qui la couvrent ; aucun, c'est qu'il n'y a rien à faire. Plan
 * d'avant : « remue » quand la consigne le demande ou qu'un mijotage est long.
 */
export function remindersOf(step: PlanStep, n: number | null, minutes = 0): Reminder[] {
  const ph = n != null ? step.phases?.[n] : undefined;
  if (ph && isAttention(ph.attention)) return ph.reminder ? readReminders(ph.reminder) : [];
  if (!ph && planned(step) && Array.isArray(step.reminders)) {
    const from = (step.phases ?? []).reduce((x, p) => x + p.min, 0);
    const mine = step.reminders.filter((r) => r.untilMin > from + 0.5);
    if (mine.length) return readReminders(mine);
    // Les sous-étapes ne couvrent pas l'attente de la fin : la règle du planificateur pour elle.
    const t = tail(step);
    return t.attention === "surveille" && t.reminder && minutes >= t.reminder.everyMin ? [{ text: t.reminder.text, everyMin: t.reminder.everyMin }] : [];
  }
  const given = readReminders(ph ? (field(ph, "reminders") ?? field(ph, "reminder")) : field(step, "reminders"));
  if (given.length) return given;
  const text = ph?.text ?? step.text;
  if (/ne touche pas|sans ouvrir|couvert(?!e)/i.test(text)) return [];
  if (/(remue|mélange).*(temps en temps|souvent|régulièrement)|de temps en temps/i.test(text)) return [{ text: "Remue", everyMin: 4 }];
  if (attentionOf(step, n, n == null) === "surveille" && step.kind === "braise" && minutes >= 8) return [{ text: "Remue, vérifie le feu", everyMin: 5 }];
  return [];
}

/** Ce que l'attention laisse faire, en une phrase (sous le bouton) : « à surveiller : remue la sauce toutes les 5 min ». */
export function attentionHint(a: Attention, rems: Reminder[]): string {
  const r = rems.find((x) => x.everyMin);
  if (a === "mains") return "Tes mains y sont.";
  if (a === "surveille") return r ? `À surveiller : ${r.text.charAt(0).toLocaleLowerCase("fr")}${r.text.slice(1)} toutes les ${r.everyMin} min, tu peux faire autre chose entre-temps.` : "À surveiller : tu peux faire autre chose en y jetant un œil.";
  return "Rien à faire d’ici la sonnerie : tu peux faire autre chose.";
}

/** Le rappel qui tombe maintenant (dans la minute qui suit son heure) et le prochain, comptés depuis `since`. */
export function reminderAt(rems: Reminder[], since: number, now: number, until = Infinity): { due: { text: string; at: number } | null; next: { text: string; at: number } | null } {
  let due: { text: string; at: number } | null = null;
  let next: { text: string; at: number } | null = null;
  for (const r of rems) {
    const ticks: number[] = [];
    if (r.everyMin) {
      const every = r.everyMin * 60000;
      const k = Math.floor((now - since) / every);
      if (k >= 1) ticks.push(since + k * every);
      ticks.push(since + (k + 1) * every);
    } else if (r.atMin != null) ticks.push(since + r.atMin * 60000);
    for (const at of ticks) {
      // Un rappel qui tombe à la fin du minuteur n'a pas lieu d'être : c'est la sonnerie qui parle.
      if (at >= until - 30000) continue;
      if (at <= now && now - at < 60000 && (!due || at > due.at)) due = { text: r.text, at };
      if (at > now && (!next || at < next.at)) next = { text: r.text, at };
    }
  }
  return { due, next };
}

// ─── Repères sur l'étape ───

/** Rang de l'étape dans sa recette : « étape 2 sur 5 » du butter chicken. */
export function recipeStep(plan: Pick<SessionPlan, "steps">, step: PlanStep): { n: number; of: number } | null {
  if (!step.recipeSlug) return null;
  const mine = plan.steps.filter((s) => s.recipeSlug === step.recipeSlug).sort((a, b) => a.order - b.order);
  return { n: mine.findIndex((s) => s.id === step.id) + 1, of: mine.length };
}

/** Ce que pèse une pesée (à deux) : les ingrédients du bol avec leur quantité, ceux que la consigne cite. */
export function weighItems(plan: Pick<SessionPlan, "bowls">, task: Pick<PrepTask, "bowls" | "text">): PlanBowlItem[] {
  const out: PlanBowlItem[] = [];
  for (const l of task.bowls ?? []) {
    const b = plan.bowls.find((x) => x.letter === l);
    if (!b) continue;
    const cited = b.items.filter((i) => (task.text ?? "").toLowerCase().includes(parseGesture(i.item).base.toLowerCase()));
    out.push(...(cited.length ? cited : b.items));
  }
  return out;
}

/** Les bols cités dans un texte (dans l'ordre), parmi ceux du plan. */
export const bowlsIn = (plan: Pick<SessionPlan, "bowls">, text: string) => bowlParts(text, plan.bowls.map((b) => b.letter)).flatMap((p) => (p.t === "bowl" ? [p.v] : []));

/** Une sous-étape chronométrée : une attente, ou un geste d'au moins 2 min (« 3 min sans toucher »). */
export const timedPhase = (ph: { min: number; wait?: boolean | null }) => ph.wait === true || ph.min >= 2;

// ─── Ce qu'une étape demande : les bols, ce qui se pèse au moment, le placard ───

/** Un ingrédient à l'écran, quantité mise à l'échelle ; d'une cuisson commune, la part de chaque recette. */
export interface TakeItem {
  item: string;
  /** Le nom sans le geste (« Oignons »). */
  name: string;
  food: string | null;
  qty: string | null;
  optional: boolean;
  recipeSlug: string;
  bowl: string | null;
  /** Rang de la sous-étape où il entre (null : dès le début). */
  phase: number | null;
  parts?: { recipeSlug: string; bowl: string | null; qty: string | null }[];
}

/** Un bol (ou une boîte, une assiette) à prendre pour l'étape : sa lettre, son contenant, son contenu. */
export interface TakeBowl {
  letter: string;
  recipeSlug: string;
  holder: Exclude<Holder, "moment">;
  /** Le contenant de la cuisine (« Grand bol », « Boîte »), s'il est connu. */
  container: string | null;
  items: TakeItem[];
  phase: number | null;
}

export interface Take {
  /** Préparés d'avance : à prendre (ou, pour un geste glissé, à remplir). */
  bowls: TakeBowl[];
  /** Rien à préparer : à peser et verser au moment (« Pèse et verse : pulpe de tomate 800 g »). */
  moment: TakeItem[];
  /** Hors bol, au placard (l'huile pour saisir). */
  loose: TakeItem[];
}

const bowlOfPlan = (plan: Pick<SessionPlan, "bowls">, l: string | null) => (l ? plan.bowls.find((b) => b.letter === l) : undefined);
const holderOf = (plan: Pick<SessionPlan, "bowls">, i: Pick<StepIngredient, "bowl" | "holder">): Holder | null => (i.bowl ? (i.holder ?? bowlOfPlan(plan, i.bowl)?.holder ?? "bol") : null);
const fromIngredient = (i: StepIngredient): TakeItem => ({ item: i.item, name: i.name, food: i.food, qty: i.qty, optional: Boolean(i.optional), recipeSlug: i.recipeSlug, bowl: i.bowl, phase: i.phase });
const fromBowlItem = (b: PlanBowl, i: PlanBowlItem, phase: number | null): TakeItem => ({ item: i.item, name: parseGesture(i.item).base, food: i.food ?? null, qty: i.qty, optional: i.optional, recipeSlug: b.recipeSlug, bowl: b.letter, phase });

/** Un même aliment de plusieurs recettes (le riz d'une cuisson commune) : une ligne, la somme, et la part de chacune. */
function mergeSame(list: StepIngredient[]): TakeItem[] {
  const out: (TakeItem & { g: number | null; u: number | null })[] = [];
  for (const i of list) {
    const key = `${i.food ?? ""}|${i.name.toLowerCase()}`;
    const same = out.find((x) => `${x.food ?? ""}|${x.name.toLowerCase()}` === key && x.recipeSlug !== i.recipeSlug);
    if (!same) {
      out.push({ ...fromIngredient(i), g: i.grams, u: i.units });
      continue;
    }
    same.parts ??= [{ recipeSlug: same.recipeSlug, bowl: same.bowl, qty: same.qty }];
    same.parts.push({ recipeSlug: i.recipeSlug, bowl: i.bowl, qty: i.qty });
    same.g = same.g != null && i.grams != null ? same.g + i.grams : (same.g ?? i.grams);
    same.u = same.u != null && i.units != null ? same.u + i.units : (same.u ?? i.units);
    same.qty = formatQty(same.g, same.u);
    same.phase = same.phase == null ? i.phase : i.phase == null ? same.phase : Math.min(same.phase, i.phase);
  }
  return out.map(({ g: _g, u: _u, ...x }) => x);
}

/**
 * Ce que demande l'étape : ses bols (avec leur contenant), ce qui se pèse et se verse au moment, et
 * ce qui vient du placard. Plan d'avant (sans `ingredients`) : les bols de l'étape, en entier.
 */
export function takeOf(plan: Pick<SessionPlan, "bowls">, step: Pick<PlanStep, "bowls" | "ingredients">): Take {
  const take: Take = { bowls: [], moment: [], loose: [] };
  const ings = step.ingredients;
  if (!ings) {
    for (const l of step.bowls) {
      const b = bowlOfPlan(plan, l);
      if (!b) continue;
      if (b.holder === "moment") take.moment.push(...b.items.map((i) => fromBowlItem(b, i, null)));
      else take.bowls.push({ letter: b.letter, recipeSlug: b.recipeSlug, holder: b.holder ?? "bol", container: b.containerLabel ?? null, items: b.items.map((i) => fromBowlItem(b, i, null)), phase: null });
    }
    return take;
  }
  const order = (l: string | null) => (l ? step.bowls.indexOf(l) : -1);
  const byBowl = new Map<string, StepIngredient[]>();
  const moment: StepIngredient[] = [];
  for (const i of ings) {
    const h = holderOf(plan, i);
    if (h == null) take.loose.push(fromIngredient(i));
    else if (h === "moment") moment.push(i);
    else byBowl.set(i.bowl!, [...(byBowl.get(i.bowl!) ?? []), i]);
  }
  take.bowls = [...byBowl.entries()]
    .sort(([a], [b]) => order(a) - order(b))
    .map(([l, list]) => {
      const b = bowlOfPlan(plan, l);
      const h = holderOf(plan, list[0]) as Exclude<Holder, "moment">;
      const phases = list.map((i) => i.phase).filter((x): x is number => x != null);
      return { letter: l, recipeSlug: b?.recipeSlug ?? list[0].recipeSlug, holder: h, container: b?.containerLabel ?? null, items: list.map(fromIngredient), phase: phases.length ? Math.min(...phases) : null };
    });
  // Les bols cités que les ingrédients n'ont pas vus (un plan qui ne les relie pas) : en entier.
  for (const l of step.bowls) {
    const b = bowlOfPlan(plan, l);
    if (!b || byBowl.has(l) || ings.some((i) => i.bowl === l)) continue;
    if (b.holder === "moment") take.moment.push(...b.items.map((i) => fromBowlItem(b, i, null)));
    else take.bowls.push({ letter: l, recipeSlug: b.recipeSlug, holder: b.holder ?? "bol", container: b.containerLabel ?? null, items: b.items.map((i) => fromBowlItem(b, i, null)), phase: null });
  }
  take.moment.push(...mergeSame(moment));
  return take;
}

const lowerFirst = (s: string) => s.charAt(0).toLocaleLowerCase("fr") + s.slice(1);

/** « Pèse et verse : pulpe de tomate 800 g, concentré de tomate 30 g, miel 15 g » : la phrase d'une liste du moment. */
export function weighLine(items: Pick<TakeItem, "name" | "qty" | "optional">[]): string {
  return items.map((i) => `${lowerFirst(i.name)}${i.qty ? ` ${i.qty}` : ""}${i.optional && !/facultatif/i.test(i.name) ? " (facultatif)" : ""}`).join(", ");
}

/** Ce qui entre à la sous-étape `n` (pour la mettre en avant pendant qu'elle est en cours). */
export function takeAt(take: Take, n: number | null): { bowls: string[]; moment: TakeItem[]; loose: TakeItem[] } {
  if (n == null) return { bowls: [], moment: [], loose: [] };
  return { bowls: take.bowls.filter((b) => b.phase === n).map((b) => b.letter), moment: take.moment.filter((i) => i.phase === n), loose: take.loose.filter((i) => i.phase === n) };
}

// ─── Une cuisson commune, des fournées ───

export interface ShareLine {
  recipeSlug: string;
  name: string;
  color: string;
  bowl: string | null;
  /** « 1 kg cuit » */
  qty: string;
  cookedG: number;
  rawG: number;
  share: number;
}

/**
 * Le partage d'une cuisson commune (le riz de deux recettes cuit une fois) : ce qui cuit, le total, et
 * la part cuite de chaque recette, dans l'ordre du plan. null : l'étape n'est pas partagée.
 */
export function shareOf(plan: Pick<SessionPlan, "recipes">, step: Pick<PlanStep, "shared" | "base">): { label: string; the: string; total: string; lines: ShareLine[] } | null {
  if (!step.shared || step.shared.length < 2) return null;
  const label = step.base ?? "base";
  const lines = step.shared.map((p) => {
    const r = plan.recipes.find((x) => x.slug === p.recipeSlug);
    return { recipeSlug: p.recipeSlug, name: r?.name ?? p.recipeSlug, color: r?.color ?? "", bowl: p.bowl, qty: `${formatQty(p.cookedG, null)} cuit`, cookedG: p.cookedG, rawG: p.rawG, share: p.share };
  });
  const the = label === "riz" ? "le riz" : /^[aeéiouyh]/i.test(label) ? `l’${label}` : label.endsWith("s") ? `les ${label}` : `le ${label}`;
  return { label, the, total: `${formatQty(lines.reduce((x, l) => x + l.rawG, 0), null)} cru`, lines };
}

/** Les cuissons communes du plan (pour la pesée de fin) : l'étape, ce qui a cuit, la part de chaque recette. */
export function sharedBases(plan: Pick<SessionPlan, "recipes" | "steps">): { stepId: string; equipment: string | null; label: string; the: string; lines: ShareLine[] }[] {
  return plan.steps.flatMap((s) => {
    const sh = shareOf(plan, s);
    return sh ? [{ stepId: s.id, equipment: s.equipmentName ? article(s.equipmentName).toLocaleLowerCase("fr") : null, label: sh.label, the: sh.the, lines: sh.lines }] : [];
  });
}

/** La consigne d'une sous-étape en grand : le partage d'une cuisson commune se dit court (les parts sont listées dessous). */
export function phaseText(step: Pick<PlanStep, "phases" | "shared">, n: number): string {
  const text = step.phases?.[n]?.text ?? "";
  return step.shared?.length && n === step.phases!.length - 1 ? text.split(" : ")[0] : text;
}

/** Les fournées de l'étape, en clair : « en 3 fournées » (poêle), « en 2 fois, dans la même eau » (base à l'eau). */
export function batchesLabel(step: Pick<PlanStep, "batches" | "base">): string | null {
  const n = step.batches ?? 0;
  if (n < 2) return null;
  return step.base ? `En ${n} fois, dans la même eau` : `En ${n} fournées`;
}

// ─── Les contenants de la session ───

export interface ContainerNote {
  /** Il manque des bols : combien, lesquels, et quoi faire. */
  missing: { count: number; letters: string[]; peak: number; owned: number; liters: number[] } | null;
  /** Des bols se remplissent quand un autre se vide : l'ordre. */
  order: { letter: string; after: string }[];
  /** Les groupes du moment : pas de bol, l'étape dira quoi peser. */
  moment: { letters: string[]; names: string[] }[];
}

/** Ce que la session dit des contenants avant de commencer (plan du moteur ; null pour un plan d'avant). */
export function containerNote(plan: Pick<SessionPlan, "bowls" | "containers">): ContainerNote | null {
  const c = plan.containers;
  if (!c) return null;
  const missing = c.missing.length ? { count: c.missing.length, letters: c.missing, peak: c.peak, owned: c.owned, liters: c.missing.map((l) => plan.bowls.find((b) => b.letter === l)?.liters ?? 0) } : null;
  const order = plan.bowls.filter((b) => b.fillAfter).map((b) => ({ letter: b.letter, after: b.fillAfter! }));
  // Un même contenu dans plusieurs recettes (le riz de trois recettes) : une ligne, toutes ses lettres.
  const moment: ContainerNote["moment"] = [];
  for (const b of plan.bowls.filter((x) => x.holder === "moment")) {
    const names = b.items.map((i) => lowerFirst(parseGesture(i.item).base.replace(/\s*\(.*$/, "")));
    const same = moment.find((m) => m.names.join("|") === names.join("|"));
    if (same) same.letters.push(b.letter);
    else moment.push({ letters: [b.letter], names });
  }
  if (!missing && !order.length && !moment.length) return null;
  return { missing, order, moment };
}

/** « Il te faut 2 bols de plus » et la phrase qui suit (taille, ce qui fera l'affaire). */
export function missingText(m: NonNullable<ContainerNote["missing"]>): { title: string; body: string } {
  const big = Math.max(...m.liters);
  const size = big > 0 ? ` (jusqu’à ${String(Math.round(big * 10) / 10).replace(".", ",")} L)` : "";
  return {
    title: `Il te faut ${m.count} bol${m.count > 1 ? "s" : ""} de plus`,
    body: `La session en demande ${m.peak} en même temps, ta cuisine en a ${m.owned}${size}. Une boîte, un plat ou une casserole propre fera l’affaire, sinon remplis les bols ${m.letters.join(", ")} quand un autre se vide.`,
  };
}

/** Les contenants en une phrase pour l'écran d'ouverture : ce qui manque (rien d'autre, le détail vient à la prep). */
export function containerLine(plan: Pick<SessionPlan, "bowls" | "containers">): string | null {
  const m = containerNote(plan)?.missing;
  if (!m) return null;
  const t = missingText(m);
  return `${t.title} : la session en demande ${m.peak} en même temps, ta cuisine en a ${m.owned}.`;
}

/** La remarque du planificateur qui redit les bols manquants ou l'ordre de remplissage (ContainersNote le dit déjà, en clair). */
export const isContainerWarning = (w: string) => /^Il manque \d+ bols? \(bol|^Pas assez de bols pour tout préparer d'avance/.test(w);

// ─── Le fil : en cours (mains), en fond (surveille, libre), ensuite ───

export interface LaneItem {
  step: PlanStep;
  /** Sous-étape en cours, null sans sous-étape (ou toutes faites). */
  phase: number | null;
  /** Ce qui se fait là, en clair : la sous-étape, ou « mijotage » pendant l'attente. */
  doing: string;
  attention: Attention;
  timer: TimerState | null;
  reminders: Reminder[];
  /** Depuis quand ça dure (compte des rappels). */
  since: number | null;
}

export function laneItem(plan: SessionPlan, state: SessionState, step: PlanStep, now: number): LaneItem {
  const n = stepStatus(state, step.id) === "active" ? currentPhase(state, step) : null;
  const raw = (n != null ? phaseTimer(state, step.id, n) : undefined) ?? stepTimer(state, step.id);
  const timer = raw ? liveTimer(raw, now) : null;
  const passive = n == null && timer != null && timer.phase == null;
  const ph = n != null ? step.phases![n] : null;
  const doing = ph ? ph.text : passive && step.kind !== "preheat" ? `${cap(passiveLabel(step))} · ${stepTitleOf(step, 40)}` : stepTitleOf(step);
  return {
    step,
    phase: n,
    doing,
    attention: attentionOf(step, n, passive),
    timer,
    reminders: timer ? remindersOf(step, n, timer.minutes) : [],
    since: timer?.startedAt ?? state.phaseAt.get(step.id) ?? state.started.get(step.id) ?? null,
  };
}

export interface Lanes {
  now: LaneItem | null;
  background: LaneItem[];
  next: PlanStep[];
  /** L'étape en cours laisse les mains libres : on peut commencer la suivante en parallèle. */
  freeHands: boolean;
}

const ownStep = (s: PlanStep, person: Person | null | undefined) => !person || (s.person ?? "A") === person;

/** Le fil d'un écran (à deux : d'une personne) autour de l'étape montrée. */
export function lanesOf(plan: SessionPlan, state: SessionState, now: number, focus: PlanStep | null, person?: Person | null): Lanes {
  const nowItem = focus && stepStatus(state, focus.id) === "active" ? laneItem(plan, state, focus, now) : null;
  const background = plan.steps
    .filter((s) => s.id !== focus?.id && ownStep(s, person) && stepStatus(state, s.id) === "active")
    .map((s) => laneItem(plan, state, s, now))
    .sort((a, b) => (a.timer?.endsAt ?? Infinity) - (b.timer?.endsAt ?? Infinity));
  // Ce qui est prêt d'abord (ce qu'il reprend existe), dans l'ordre du plan ; puis ce qui attend encore.
  const todo = plan.steps.filter((s) => s.id !== focus?.id && ownStep(s, person) && stepStatus(state, s.id) === "todo");
  const next = [...todo.filter((s) => isReady(plan, state, s)), ...todo.filter((s) => !isReady(plan, state, s))].slice(0, 2);
  return { now: nowItem, background, next, freeHands: !nowItem || nowItem.attention !== "mains" };
}

// ─── Le bouton principal : une seule chose, nommée ───

export type MainKind = "start" | "phase-timer" | "phase" | "passive" | "finish";
export interface MainAction {
  kind: MainKind;
  /** Commencer clôt ces prérequis encore ouverts (le préchauffage) ; ou ils ne sont pas prêts (`blocked`). */
  closes?: string[];
  blocked?: string[];
  /** Le libellé du bouton : ce qu'il fait. */
  label: string;
  /** Ce qui se passe ensuite, en une phrase (sous le bouton, et en infobulle). */
  hint: string;
  minutes?: number;
  /** Le geste de rechange : finir sans minuteur. */
  alt?: { kind: "phase" | "finish"; label: string };
}

/** La question qu'on se pose avant de clore un prérequis (« Le four est chaud ? »). */
function closeQuestion(n: PlanStep): string {
  if (n.kind === "preheat") return "Le four est chaud ?";
  if (n.kind === "bake") return "C’est cuit ?";
  if (n.kind === "rest") return "C’est reposé ?";
  if (n.kind === "cool") return "C’est refroidi ?";
  return "C’est prêt ?";
}

/** Ce que fait le geste de clore (« Arrêter le préchauffage », « Finir l’étape 2 »). */
function closeVerb(n: PlanStep): string {
  if (n.kind === "preheat") return "arrêter le préchauffage";
  return `finir l’étape ${n.no}${n.kind === "bake" ? " (sors du four)" : ""}`;
}

/** Ce qu'une étape attend encore, en clair : « l’étape 8 (Saisis le poulet) n’est pas finie ». */
export function needsText(left: NeedLeft[]): string {
  const list = left.map((n) => `l’étape ${n.step.no} (${stepTitleOf(n.step, 40)})`);
  return `${cap(list.length > 1 ? `${list.slice(0, -1).join(", ")} et ${list[list.length - 1]}` : list[0])} ${list.length > 1 ? "ne sont pas finies" : "n’est pas finie"}`;
}

/**
 * La vraie suite d'une étape : celle que l'écran montrera une fois l'étape finie (la première prête du
 * plan, de la même personne à deux), jamais une étape qui attend encore ce qu'elle reprend.
 */
export function upNext(plan: SessionPlan, state: SessionState, step: PlanStep): PlanStep | null {
  return nextTodo(plan, withDone(state, step.id), step, plan.mode === "duo" ? (step.person ?? "A") : null);
}

/** Ce que fait le bouton principal sur l'étape `step`. */
export function mainAction(plan: SessionPlan, state: SessionState, step: PlanStep, _now?: number): MainAction {
  const st = stepStatus(state, step.id);
  const title = stepTitleOf(step, 34);
  const after = upNext(plan, state, step);
  if (st !== "active") {
    const left = needsLeft(plan, state, step);
    const hint = step.phases?.length ? `${step.phases.length} sous-étapes, une à la fois. Aucun minuteur ne part tout seul.` : "L’étape passe en cours. Aucun minuteur ne part tout seul.";
    const blocked = left.filter((n) => !n.closable);
    if (blocked.length) return { kind: "start", label: `Commencer quand même : ${title}`, hint: `${needsText(blocked)} : ce qu’elle reprend n’est pas prêt.`, blocked: blocked.map((n) => n.step.id) };
    if (left.length) {
      const verb = left.length === 1 ? closeVerb(left[0].step) : `finir ${left.map((n) => `l’étape ${n.step.no}`).join(" et ")}`;
      const go = step.oven || /enfourne/i.test(step.text) ? "enfourner" : "commencer";
      const timers = left.some((n) => [...state.timers.values()].some((t) => t.stepId === n.step.id && t.doneAt == null));
      return {
        kind: "start",
        label: `${closeQuestion(left[0].step)} ${cap(verb)} et ${go}`,
        hint: `${timers ? "Son minuteur s’arrête, " : ""}l’étape ${left.map((n) => n.step.no).join(" et ")} est close${left.length > 1 ? "s" : ""} ; le retour la rouvre. ${hint}`,
        closes: left.map((n) => n.step.id),
      };
    }
    return { kind: "start", label: `Commencer : ${title}`, hint };
  }
  const n = currentPhase(state, step);
  if (n != null) {
    const ph = step.phases![n];
    const nxt = step.phases![n + 1];
    const raw = phaseTimer(state, step.id, n);
    const then = nxt ? `Ensuite : ${clip(nxt.text, 60)}.` : passiveMin(step) >= 3 ? `Dernière sous-étape ; puis ${passiveLabel(step)} (${Math.round(passiveMin(step))} min).` : "Dernière sous-étape : l’étape sera finie.";
    if (raw) return { kind: "phase", label: `${ph.wait ? "C’est prêt" : "Fait"} : ${clip(ph.text, 34)}`, hint: `Arrête son minuteur. ${then}` };
    if (timedPhase(ph)) {
      const a = attentionOf(step, n);
      const free = a === "mains" ? "" : ` ${attentionHint(a, remindersOf(step, n, ph.min))}`;
      return { kind: "phase-timer", label: `Lance ${fmtMin(ph.min)} : ${clip(ph.text, 30)}`, hint: `Le minuteur sonnera à la fin, rien d’autre ne démarre.${free} ${then}`, minutes: ph.min, alt: { kind: "phase", label: "Fait, sans minuteur" } };
    }
    return { kind: "phase", label: `Fait : ${clip(ph.text, 34)}`, hint: then };
  }
  const later = after ? ` Ensuite, à commencer quand tu veux : ${stepTitleOf(after, 50)}.` : "";
  if (stepTimer(state, step.id)) return { kind: "finish", label: `Fini : ${title}`, hint: `Arrête son minuteur, l’étape est finie.${later}` };
  const wait = Math.round(passiveMin(step));
  if (wait >= 3) return { kind: "passive", label: `Lance ${wait} min : ${passiveLabel(step)}`, hint: `Le minuteur sonnera à la fin ; l’étape passe en fond. ${attentionHint(attentionOf(step, null, true), remindersOf(step, null, wait))}`, minutes: wait, alt: { kind: "finish", label: "Déjà fini" } };
  return { kind: "finish", label: `Fait : ${title}`, hint: `L’étape est finie.${later}` };
}

/** Seul, geste glissé dans la cuisson : fait, il finit ses bols (quand leurs autres gestes sont faits). */
export function fillBowls(plan: SessionPlan, state: SessionState, step: PlanStep): Ev[] {
  if (!step.tasks) return [];
  return step.bowls
    .filter((l) => !state.bowlsReady.has(l) && (plan.bowls.find((b) => b.letter === l)?.during ?? []).every((d) => d.stepId === step.id || state.done.has(d.stepId)))
    .map((l) => ({ kind: "bowl_ready" as const, ref: l, payload: { ready: true } }));
}

export interface EvOpts {
  sessionId: string;
  person?: Person | null;
  /** Ids d'événements (aléatoires dans l'appli, prévisibles dans les tests). */
  id: () => string;
}
const who = (o: EvOpts) => (o.person ? { person: o.person } : {});

/** Finir l'étape : ses sous-étapes restantes, son minuteur, puis l'étape. */
function finishEvents(plan: SessionPlan, state: SessionState, step: PlanStep, o: EvOpts): Ev[] {
  const out: Ev[] = [];
  const n = currentPhase(state, step);
  if (n != null)
    for (let i = n; i < step.phases!.length; i++) {
      const t = phaseTimer(state, step.id, i);
      if (t) out.push({ kind: "timer_done", ref: t.id });
      out.push({ id: o.id(), kind: "step_done", ref: `phase:${i}:${step.id}`, payload: o.person ? { person: o.person } : null });
    }
  const t = stepTimer(state, step.id);
  if (t) out.push({ kind: "timer_done", ref: t.id });
  return [...out, { kind: "step_done", ref: step.id, payload: o.person ? { person: o.person } : null }, ...fillBowls(plan, state, step)];
}

/** La sous-étape `n` faite (son minuteur arrêté) ; la dernière, sans attente derrière, finit l'étape. */
function phaseDoneEvents(plan: SessionPlan, state: SessionState, step: PlanStep, n: number, o: EvOpts): Ev[] {
  const out: Ev[] = [];
  const t = phaseTimer(state, step.id, n);
  if (t) out.push({ kind: "timer_done", ref: t.id });
  out.push({ id: o.id(), kind: "step_done", ref: `phase:${n}:${step.id}`, payload: o.person ? { person: o.person } : null });
  if (n === step.phases!.length - 1 && passiveMin(step) < 3 && !stepTimer(state, step.id)) out.push({ kind: "step_done", ref: step.id, payload: o.person ? { person: o.person } : null }, ...fillBowls(plan, state, step));
  return out;
}

/**
 * Clore d'avance un prérequis (le four est chaud, l'étape suivante commence) : ses minuteurs s'arrêtent, ses
 * sous-étapes et l'étape sont faites, marquées `early` (leur durée ne s'apprend pas) et `by` (le retour de
 * l'étape qui les a closes les rouvre).
 */
export function closeEvents(plan: SessionPlan, state: SessionState, need: PlanStep, by: PlanStep, o: EvOpts): Ev[] {
  const pay = { early: true, by: by.id, ...who(o) };
  const out: Ev[] = [];
  const n = currentPhase(state, need);
  if (n != null)
    for (let i = n; i < need.phases!.length; i++) {
      const t = phaseTimer(state, need.id, i);
      if (t) out.push({ kind: "timer_done", ref: t.id, payload: pay });
      out.push({ id: o.id(), kind: "step_done", ref: `phase:${i}:${need.id}`, payload: pay });
    }
  for (const t of state.timers.values()) if (t.stepId === need.id && t.phase == null && t.doneAt == null) out.push({ kind: "timer_done", ref: t.id, payload: pay });
  return [...out, { id: o.id(), kind: "step_done", ref: need.id, payload: pay }];
}

/** Commencer une étape : ses prérequis encore ouverts qu'il suffit de clore le sont d'abord (« Arrêter le préchauffage et enfourner »). */
export function startEvents(plan: SessionPlan, state: SessionState, step: PlanStep, o: EvOpts): Ev[] {
  const closes = needsLeft(plan, state, step).filter((n) => n.closable);
  return [...closes.flatMap((n) => closeEvents(plan, state, n.step, step, o)), { id: o.id(), kind: "step_start", ref: step.id, payload: o.person ? { person: o.person } : null }];
}

/**
 * Terminer maintenant (un minuteur qu'on n'attend plus : l'eau bout déjà, c'est doré) : celui d'une
 * sous-étape la finit, celui d'une attente d'étape finit l'étape. Un minuteur sans étape s'arrête.
 */
export function finishNowEvents(plan: SessionPlan, state: SessionState, t: TimerState, o: EvOpts): Ev[] {
  const step = t.stepId ? plan.steps.find((x) => x.id === t.stepId) : undefined;
  if (!step || stepStatus(state, step.id) !== "active") return [{ kind: "timer_done", ref: t.id }];
  if (t.phase != null) return currentPhase(state, step) === t.phase ? phaseDoneEvents(plan, state, step, t.phase, o) : [{ kind: "timer_done", ref: t.id }];
  return finishEvents(plan, state, step, o);
}

/** Les événements du bouton principal (ou de son geste de rechange, `alt`). Jamais l'étape suivante, jamais un minuteur non nommé. */
export function mainEvents(plan: SessionPlan, state: SessionState, step: PlanStep, now: number, o: EvOpts, alt = false): Ev[] {
  const a = mainAction(plan, state, step, now);
  const kind = alt ? a.alt?.kind : a.kind;
  const n = currentPhase(state, step);
  switch (kind) {
    case "start":
      return startEvents(plan, state, step, o);
    case "phase-timer": {
      const ph = step.phases![n!];
      return [{ id: o.id(), kind: "timer_start", ref: phaseIds(o.sessionId, step.id, n!).timer, payload: { label: ph.text, minutes: ph.min, stepId: step.id, phase: n, endsAt: new Date(now + ph.min * 60000).toISOString(), ...who(o) } }];
    }
    case "phase":
      return phaseDoneEvents(plan, state, step, n!, o);
    case "passive": {
      const min = a.minutes!;
      return [{ id: o.id(), kind: "timer_start", ref: o.id(), payload: { label: `${cap(passiveLabel(step))} · ${stepTitleOf(step, 40)}`, minutes: min, stepId: step.id, auto: true, passive: true, endsAt: new Date(now + min * 60000).toISOString(), ...who(o) } }];
    }
    case "finish":
      return finishEvents(plan, state, step, o);
    default:
      return [];
  }
}

/** Arrêter un minuteur : celui d'une sous-étape la finit (la suivante attend son geste) ; une attente finie finit l'étape. */
export function stopEvents(plan: SessionPlan, state: SessionState, t: TimerState, now: number, o: EvOpts & { auto: boolean; chain?: boolean }): Ev[] {
  const step = t.stepId ? plan.steps.find((x) => x.id === t.stepId) : undefined;
  if (step && t.phase != null && currentPhase(state, step) === t.phase) {
    const out = phaseDoneEvents(plan, state, step, t.phase, o);
    // « Arrêter · lancer 13 min » : la suite chronométrée part sur ce geste-là, nommé sur le bouton.
    const nxt = step.phases![t.phase + 1];
    if (o.chain && nxt && timedPhase(nxt))
      out.push({ id: o.id(), kind: "timer_start", ref: phaseIds(o.sessionId, step.id, t.phase + 1).timer, payload: { label: nxt.text, minutes: nxt.min, stepId: step.id, phase: t.phase + 1, endsAt: new Date(now + nxt.min * 60000).toISOString(), ...who(o) } });
    return out;
  }
  const out: Ev[] = [{ kind: "timer_done", ref: t.id }];
  if (step && o.auto && t.endsAt <= now && stepStatus(state, step.id) === "active") out.push({ kind: "step_done", ref: step.id, payload: o.person ? { person: o.person } : null }, ...fillBowls(plan, state, step));
  return out;
}

// ─── Le retour : la dernière action encore visible, par personne ───

/** À qui appartient ce qu'un événement touche (à deux) : la personne de l'étape, du geste ou du minuteur. */
export function ownerOf(plan: SessionPlan, state: SessionState, kind: EventKind, ref: string | null): Person | null {
  if (!ref) return null;
  const stepOwner = (id: string) => {
    const s = plan.steps.find((x) => x.id === id);
    return s ? (s.person ?? "A") : null;
  };
  if (kind === "timer_start") {
    const t = state.timers.get(ref);
    return t?.stepId ? stepOwner(t.stepId) : null;
  }
  if (ref.startsWith("prep:")) return plan.prep.tasks.find((t) => t.id === ref.slice(5))?.person ?? null;
  if (ref.startsWith("phase:")) return stepOwner(ref.slice(6).replace(/^\d+:/, ""));
  return stepOwner(ref);
}

export interface Undo {
  /** Le libellé du bouton (« Revenir à : beurre + bol E »). */
  label: string;
  /** Ce que ça défait, en une phrase. */
  detail: string;
  events: Ev[];
}

/**
 * Le retour : défait la dernière action (de cette personne, à deux) dont l'effet se voit encore :
 * un « Commencer », une sous-étape ou une étape faite, un geste de prep, un minuteur lancé.
 */
export function undoFor(plan: SessionPlan, state: SessionState, events: SessionEvent[], person: Person | null, now = Date.now()): Undo | null {
  const pay = (extra: Record<string, unknown> = {}) => ({ undo: true, ...extra, ...(person ? { person } : {}) });
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e.ref || e.payload?.undo === true) continue;
    if (!(e.kind === "step_start" || e.kind === "step_done" || (e.kind === "timer_start" && e.payload?.adjust !== true))) continue;
    if (person && ownerOf(plan, state, e.kind, e.ref) !== person) continue;
    const at = Date.parse(e.at);
    if (e.kind === "timer_start") {
      const t = state.timers.get(e.ref);
      if (!t || t.doneAt != null || t.startedAt !== at) continue;
      return { label: `Annuler le minuteur ${fmtMin(t.refMinutes)}`, detail: `Arrête « ${clip(t.label, 50)} » sans rien marquer fait.`, events: [{ kind: "timer_done", ref: t.id }] };
    }
    if (e.ref.startsWith("prep:")) {
      const id = e.ref.slice(5);
      if (!state.prepDone.has(id)) continue;
      const task = plan.prep.tasks.find((t) => t.id === id);
      const bowls = plan.bowls.filter((b) => b.tasks?.includes(id) && state.bowlsReady.has(b.letter));
      return {
        label: `Revenir à : ${task ? clip(task.kind === "weigh" ? `pesée du ${task.title.replace(/^Bol/, "bol")}` : task.title, 34) : "ce geste"}`,
        detail: "Le geste redevient à faire.",
        events: [{ kind: "step_done", ref: e.ref, payload: pay() }, ...bowls.map((b) => ({ kind: "bowl_ready" as const, ref: b.letter, payload: { ready: false, ...(person ? { person } : {}) } }))],
      };
    }
    if (e.ref.startsWith("phase:")) {
      const key = e.ref.slice(6);
      const n = Number(key.split(":")[0]);
      const stepId = key.replace(/^\d+:/, "");
      const step = plan.steps.find((s) => s.id === stepId);
      if (!step || !state.phasesDone.has(key) || state.phasesDone.has(`${n + 1}:${stepId}`) || state.done.has(stepId)) continue;
      const nextTimer = phaseTimer(state, stepId, n + 1);
      return {
        label: `Revenir à : ${clip(step.phases?.[n]?.text ?? stepTitleOf(step), 34)}`,
        detail: `La sous-étape ${n + 1} redevient celle en cours (étape ${step.no}).`,
        events: [...(nextTimer ? [{ kind: "timer_done" as const, ref: nextTimer.id }] : []), { kind: "step_done", ref: e.ref, payload: pay() }],
      };
    }
    const step = plan.steps.find((s) => s.id === e.ref);
    if (!step) continue;
    if (e.kind === "step_done") {
      if (state.done.get(step.id) !== at) continue;
      return { label: `Rouvrir : ${stepTitleOf(step, 34)}`, detail: `L’étape ${step.no} redevient en cours.`, events: [{ kind: "step_done", ref: step.id, payload: pay() }] };
    }
    if (state.started.get(step.id) !== at || state.done.has(step.id)) continue;
    const timers = [...state.timers.values()].filter((t) => t.stepId === step.id && t.doneAt == null);
    // Ce que son lancement avait clos (le préchauffage) se rouvre, son minuteur repart s'il n'avait pas fini.
    const closed = events.filter((x) => x.payload?.by === step.id && x.payload?.early === true && x.payload?.undo !== true);
    const reopen: Ev[] = [];
    const reopened = new Set<string>();
    for (const x of closed) {
      if (!x.ref) continue;
      if (x.kind === "step_done") {
        const on = x.ref.startsWith("phase:") ? state.phasesDone.has(x.ref.slice(6)) : state.done.has(x.ref);
        if (!on) continue;
        reopen.push({ kind: "step_done", ref: x.ref, payload: pay() });
        if (!x.ref.startsWith("phase:")) reopened.add(x.ref);
      } else if (x.kind === "timer_done") {
        const t = state.timers.get(x.ref);
        if (t && t.doneAt != null && t.endsAt > now) reopen.push({ kind: "timer_start", ref: t.id, payload: { label: t.label, minutes: t.minutes, stepId: t.stepId, ...(t.phase != null ? { phase: t.phase } : {}), endsAt: new Date(t.endsAt).toISOString(), ...(person ? { person } : {}) } });
      }
    }
    const names = [...reopened].map((id) => plan.steps.find((x) => x.id === id)).filter((x): x is PlanStep => Boolean(x));
    return {
      label: `Pas encore commencé : ${stepTitleOf(step, 26)}`,
      detail: `L’étape ${step.no} redevient à commencer${timers.length ? ", son minuteur s’arrête" : ""}${names.length ? ` ; ${names.map((n) => (n.kind === "preheat" ? "le préchauffage reprend" : `l’étape ${n.no} se rouvre`)).join(", ")}` : ""}.`,
      events: [...timers.map((t) => ({ kind: "timer_done" as const, ref: t.id })), { kind: "step_start", ref: step.id, payload: pay() }, ...reopen],
    };
  }
  return null;
}

// ─── Ça sonne : de quoi il s'agit, ce que ça touche, quoi faire ───

export interface RingInfo {
  recipe: { slug: string; name: string; color: string } | null;
  step: PlanStep | null;
  /** Ce qui vient de finir (« La sauce mijote »). */
  finished: string;
  /** Ce que ça touche : récipient, foyer et niveau, four. */
  where: string[];
  /** Les bols de l'action à faire. */
  bowls: string[];
  /** L'action à faire maintenant, en grand. */
  action: string;
  /** Le repère de la fiche (« la sauce nappe la cuillère »). */
  cue: string | null;
  /** Et après. */
  after: string | null;
  /** Le libellé du bouton qui arrête. */
  stop: string;
  /** La suite est chronométrée : arrêter et lancer son minuteur, d’un seul geste nommé. */
  chain: { label: string; minutes: number } | null;
}

const KIND_ACTION: Partial<Record<PlanStep["kind"], string>> = {
  preheat: "Le four est chaud : enfourne quand l’étape le demande",
  bake: "Sors du four, avec les gants",
  braise: "Vérifie la cuisson, puis coupe le feu",
  boil: "Vérifie la cuisson, puis coupe le feu et égoutte",
  sear: "Vérifie la cuisson",
  rest: "C’est reposé",
  cool: "C’est refroidi : ferme et range",
};

export function ringInfo(plan: SessionPlan, state: SessionState, t: TimerState): RingInfo {
  const step = t.stepId ? (plan.steps.find((x) => x.id === t.stepId) ?? null) : null;
  const recipe = step ? (plan.recipes.find((r) => r.slug === step.recipeSlug) ?? null) : null;
  if (!step) return { recipe: null, step: null, finished: t.label, where: [], bowls: [], action: "Le minuteur est fini", cue: null, after: null, stop: "Arrêter le minuteur", chain: null };
  const n = t.phase;
  const ph = n != null ? step.phases?.[n] : undefined;
  const nxt = n != null ? step.phases?.[n + 1] : undefined;
  const sameRecipe = plan.steps.find((s) => s.id !== step.id && s.recipeSlug && s.recipeSlug === step.recipeSlug && stepStatus(state, s.id) === "todo");
  const level = nxt?.hobLevel ?? ph?.hobLevel ?? null;
  const where = [
    step.kind !== "preheat" && step.equipmentName && !/^four$/i.test(step.equipmentName) ? step.equipmentName : null,
    step.hobId ? `${hobName(plan, step.hobId)}${level != null ? ` · niveau ${level}` : step.hobLevelLabel ? ` · niveau ${step.hobLevelLabel}` : step.hobLevel != null ? ` · niveau ${step.hobLevel}` : ""}` : null,
    step.oven ? `four ${step.oven.temp} °C${step.oven.levels.length ? ` · gradin${step.oven.levels.length > 1 ? "s" : ""} ${step.oven.levels.join(" et ")}` : ""}` : step.kind === "preheat" ? (step.text.match(/(\d+)\s*°C/) ? `four ${step.text.match(/(\d+)\s*°C/)![1]} °C` : "four") : null,
  ].filter((x): x is string => Boolean(x));
  const thenStep = sameRecipe ? `Étape suivante de la recette : ${stepTitleOf(sameRecipe, 60)}` : null;
  if (ph) {
    const lastNoWait = !nxt && passiveMin(step) < 3;
    return {
      recipe,
      step,
      finished: ph.text,
      where,
      bowls: nxt ? bowlsIn(plan, nxt.text) : [],
      action: nxt ? nxt.text : `L’étape ${step.no} est finie : ${KIND_ACTION[step.kind]?.toLowerCase() ?? "vérifie et passe à la suite"}`,
      cue: !nxt ? step.cue : null,
      after: step.phases?.[n! + 2]?.text ?? thenStep,
      stop: nxt ? (timedPhase(nxt) ? "Arrêter seulement" : `Arrêter · passer à : ${clip(nxt.text, 26)}`) : lastNoWait ? `Arrêter · étape ${step.no} finie` : "Arrêter la sonnerie",
      chain: nxt && timedPhase(nxt) ? { label: `Arrêter · lancer ${fmtMin(nxt.min)} : ${clip(nxt.text, 24)}`, minutes: nxt.min } : null,
    };
  }
  return {
    recipe,
    step,
    finished: `${cap(passiveLabel(step))} · ${stepTitleOf(step, 50)}`,
    where,
    bowls: [],
    action: KIND_ACTION[step.kind] ?? "Vérifie et passe à la suite",
    cue: step.cue,
    after: thenStep,
    stop: `Arrêter · étape ${step.no} finie`,
    chain: null,
  };
}
