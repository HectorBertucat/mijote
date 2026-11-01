// Assistant vu par la base : l'instantané des données (pour le contexte et la vérification), la
// conversation courte de chaque personne (assistant_messages), et l'exécution d'une action
// confirmée, avec les mêmes fonctions que l'interface. Le calcul est dans ./core (pur, testé).
import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { assistantMessages } from "@/lib/db/schema";
import { chat, MODELS } from "@/lib/ai";
import { eatBox, listStock } from "@/lib/boxes/store";
import { counts } from "@/lib/eaters/habits";
import { listDislikes, listHabits, removeHabit, saveHabit } from "@/lib/eaters/setup";
import { batchMealOf, loadEaters } from "@/lib/eaters/store";
import { GOAL_LABEL } from "@/lib/health/core";
import { listPeople, todayParis } from "@/lib/health/store";
import { editSession, getRunProfile, runContext, saveRunSettings, settingsOf, setWeekOverride } from "@/lib/running/store";
import { startShoppingList } from "@/lib/shopping/build";
import { defaultPeriod, isDay, periodLabel } from "@/lib/week/period";
import { addRecipe, library, loadSelection, loadTastes, loadWeek, periodPlans, removeRecipe, weekList } from "@/lib/week/store";
import { buildContext, checkAction, KIND_LABEL, pageLine, pickModel, reviewToolCalls, toolDefinitions, type ActionCard, type AssistantAction, type PageContext, type Snapshot } from "./core";

export type AssistantRow = typeof assistantMessages.$inferSelect;

/** La période dont on parle : celle de la page Semaine affichée, sinon celle par défaut. */
export function weekStartFor(db: Db, w?: string | null, now = new Date()): string {
  return w && isDay(w) ? w : defaultPeriod(periodPlans(db), now).start;
}

/** Les vraies données, résumées : foyer, semaine, bibliothèque, frigo. */
export function loadSnapshot(db: Db, speakerId: string, weekStart: string, now = new Date()): Snapshot {
  const w = loadWeek(db, weekStart);
  const sel = loadSelection(db, w.planId);
  const lib = library(db);
  const tastes = loadTastes(db, lib);
  const list = weekList(db, w.planId, sel);
  const goals = new Map(listPeople(db).map((p) => [p.id, p.goal]));
  const people = loadEaters(db, now).map((e) => {
    const goal = goals.get(e.id);
    return {
      id: e.id,
      name: e.name,
      goal: goal ? GOAL_LABEL[goal] : null,
      dayTarget: e.dayTarget,
      ref: e.ref,
      baseUnits: e.baseUnits,
      outside: e.outside,
      outsideSource: e.outsideSource,
      habits: listHabits(db, e.id)
        .filter(counts)
        .map((h) => ({ id: h.id, label: h.label, meal: h.meal, weekdays: h.weekdays, items: h.items, kcal: h.kcal, proteinG: h.proteinG, shared: h.personId == null })),
      batchMeal: batchMealOf(db, e, now),
      dislikes: listDislikes(db, e.id).map((d) => d.text),
      missing: e.missing,
    };
  });
  return {
    today: todayParis(now),
    speakerId,
    people,
    week: { start: w.start, days: w.days, label: periodLabel(w.start, w.days), selected: sel.map((x) => x.slug), list: list ? { status: list.status, changed: list.changed, ordered: list.ordered } : null },
    recipes: lib
      .filter((r) => r.status !== "archived")
      .map((r) => ({ slug: r.slug, name: r.name, kcalUnit: r.kcalUnit, proteinUnit: r.proteinUnit, status: r.status ?? "to_try", excludedFor: [...(tastes.excluded.get(r.slug) ?? [])] })),
    boxes: listStock(db, todayParis(now)).map((b) => ({ id: b.id, name: b.name, personId: b.personId, kcal: b.kcal, proteinG: b.proteinG, place: b.place, limit: b.limit, freshness: b.freshness })),
    running: runContext(db, speakerId, now),
  };
}

// ─── Conversation ───

/** Messages gardés par personne (les plus anciens partent) et envoyés au modèle. */
export const KEEP = 30;
export const HISTORY = 12;

export function listAssistant(db: Db, personId: string, limit = KEEP): AssistantRow[] {
  return db.select().from(assistantMessages).where(eq(assistantMessages.personId, personId)).orderBy(desc(assistantMessages.createdAt)).limit(limit).all().reverse();
}

export const clearAssistant = (db: Db, personId: string) => db.delete(assistantMessages).where(eq(assistantMessages.personId, personId)).run();

const actionsOf = (r: AssistantRow) => (r.actions ?? []) as unknown as AssistantAction[];

const STATUS_NOTE: Record<AssistantAction["status"], string> = { proposed: "en attente", applied: "appliquée", dismissed: "annulée", refused: "écartée par l'appli" };

/** L'historique pour le modèle : les textes, et ce qu'il est advenu des actions proposées. */
export function historyMessages(rows: AssistantRow[]): { role: "user" | "assistant"; content: string }[] {
  const out = rows.map((r) => ({
    role: r.role,
    content: r.role === "assistant" && actionsOf(r).length ? `${r.text}\n${actionsOf(r).map((a) => `[action ${a.check.ok ? a.check.title : KIND_LABEL[a.input.kind]} : ${STATUS_NOTE[a.status]}${!a.check.ok ? ` — ${a.check.reason}` : ""}]`).join("\n")}` : r.text,
  }));
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export const SYSTEM = `Tu es l'assistant de Mijote, une appli de batch cooking et de santé pour un foyer. Tu parles en français, tu tutoies, tu es concret et bref : 2 à 6 phrases, du texte simple (des tirets pour une courte liste, pas de titres, pas de gras).

Tu conseilles chaque personne du foyer selon ses objectifs, avec les données de l'appli données plus bas (cibles, repères par repas, repas du batch, habitudes hors batch, semaine, frigo, recettes et part de chacun). Tu ne calcules rien toi-même et tu n'inventes aucun chiffre : tu reprends ceux des données, et tu dis quand une donnée manque (profil, pesée, cible). Ce n'est pas un avis médical ; un risque se dit une fois, factuellement.

Tu peux proposer des actions avec les outils : ajouter ou retirer une recette de la semaine, ajouter ou retirer une habitude hors batch (shaker, petit-déjeuner, en-cas), marquer une boîte mangée, lancer la liste de courses ; et, si la personne qui te parle a un plan de course, déplacer, raccourcir ou alléger une séance, changer le nombre de sorties, poser une semaine de décharge ou enregistrer une FC qu'elle t'a donnée. Pour la course, tu expliques les analyses en mots simples et tu traduis ses contraintes de vie en déplacements ; jamais de diagnostic ni de conseil médical : une douleur qui dure, c'est l'avis d'un professionnel de santé. Un outil ne fait rien tout de suite : l'appli vérifie ta proposition et la montre en carte, la personne l'applique ou l'annule d'un geste. Propose une action seulement quand elle répond à la demande, trois au plus, avec les identifiants exacts des données (slug, personId, habitId, boxId, ids d'aliments de la liste). Écris d'abord ta réponse, puis appelle les outils.

Repères : deux repas du batch par jour ; le hors batch complète la journée. Pour choisir des recettes, appuie-toi sur l'adéquation de chaque recette au repère de chacun (bien, juste, loin) et sur les écarts et suggestions de la semaine, calculés par l'appli. Un manque de moins de 15 g de protéines ou 250 kcal par jour ne vaut pas un complément. Ne parle que du foyer, de la cuisine, des courses, de la nutrition et du sport ; pour le reste, dis que ce n'est pas ton rôle ici.`;

/**
 * Un échange : la question, la réponse en flux (onText), les actions proposées revérifiées par le
 * code. La question n'est gardée qu'avec sa réponse (en cas d'échec, on peut la renvoyer telle quelle).
 */
export async function askAssistant(db: Db, personId: string, text: string, page: PageContext & { week?: string | null }, onText?: (t: string) => void, now = new Date()): Promise<AssistantRow> {
  const msg = text.trim().slice(0, 1500);
  if (!msg) throw new Error("Message vide.");
  const weekStart = weekStartFor(db, page.week, now);
  const snap = loadSnapshot(db, personId, weekStart, now);
  const history = historyMessages(listAssistant(db, personId, HISTORY));
  const model = MODELS[pickModel(msg)];
  const res = await chat({
    db,
    screen: "assistant",
    model,
    effort: "low",
    maxTokens: 3000,
    system: [SYSTEM, `Données du foyer, calculées par l'appli :\n${buildContext(snap)}`],
    messages: [...history, { role: "user", content: `${pageLine(page, snap)}\n\n${msg}` }],
    tools: toolDefinitions(!!snap.running),
    onText,
    devMock: () => {
      const free = snap.recipes.find((r) => !snap.week.selected.includes(r.slug));
      return {
        text: `Réponse simulée (dev). Tu as écrit : « ${msg.slice(0, 80)} ». ${free ? `Je te propose d'ajouter ${free.name}.` : ""}`,
        toolCalls: free ? [{ name: "ajouter_recette", input: { slug: free.slug, why: "Simulé." } }] : [],
      };
    },
  });
  const actions = reviewToolCalls(res.toolCalls, snap).map((a) => ({ ...a, weekStart }));
  const t0 = now.getTime();
  db.insert(assistantMessages).values({ id: randomUUID(), personId, role: "user", text: msg, page: page.path.slice(0, 200), createdAt: new Date(t0).toISOString() }).run();
  const row = {
    id: randomUUID(),
    personId,
    role: "assistant" as const,
    text: res.text.trim() || (actions.length ? "Voici ce que je te propose." : "Je n'ai pas de réponse utile à ça."),
    actions: actions as unknown as Record<string, unknown>[],
    page: page.path.slice(0, 200),
    model: res.model,
    createdAt: new Date(t0 + 1).toISOString(),
  };
  db.insert(assistantMessages).values(row).run();
  prune(db, personId);
  return db.select().from(assistantMessages).where(eq(assistantMessages.id, row.id)).get()!;
}

/** Garde les KEEP derniers messages de la personne. */
function prune(db: Db, personId: string) {
  const old = db.select({ id: assistantMessages.id }).from(assistantMessages).where(eq(assistantMessages.personId, personId)).orderBy(desc(assistantMessages.createdAt)).all().slice(KEEP);
  for (const o of old) db.delete(assistantMessages).where(eq(assistantMessages.id, o.id)).run();
}

function setAction(db: Db, row: AssistantRow, index: number, patch: Partial<AssistantAction>) {
  const actions = actionsOf(row).map((a, i) => (i === index ? { ...a, ...patch } : a));
  db.update(assistantMessages).set({ actions: actions as unknown as Record<string, unknown>[] }).where(eq(assistantMessages.id, row.id)).run();
}

const findRow = (db: Db, personId: string, id: string) => db.select().from(assistantMessages).where(and(eq(assistantMessages.id, id), eq(assistantMessages.personId, personId))).get() ?? null;

/**
 * Applique une action confirmée : revérifiée sur les données du moment, puis exécutée par les
 * fonctions de l'interface (semaine, habitudes, frigo, courses). Jamais d'écriture directe.
 */
export function applyAssistantAction(db: Db, personId: string, id: string, index: number, now = new Date()): { ok: boolean; message: string; href?: string } {
  const row = findRow(db, personId, id);
  const a = row && actionsOf(row)[index];
  if (!row || !a) return { ok: false, message: "Proposition introuvable." };
  if (a.status !== "proposed") return { ok: false, message: a.status === "applied" ? "Déjà appliquée." : "Cette proposition n'est plus en attente." };
  const weekStart = a.weekStart ?? weekStartFor(db, null, now);
  const snap = loadSnapshot(db, personId, weekStart, now);
  const check = checkAction(a.input, snap);
  if (!check.ok) {
    setAction(db, row, index, { status: "refused", check });
    return { ok: false, message: check.reason };
  }
  try {
    let message = "Fait.";
    let href: string | undefined;
    const x = a.input;
    switch (x.kind) {
      case "ajouter_recette":
        addRecipe(db, weekStart, x.slug);
        message = "Recette ajoutée à la semaine : les parts sont recalculées.";
        href = `/semaine?w=${weekStart}`;
        break;
      case "retirer_recette":
        removeRecipe(db, weekStart, x.slug);
        message = "Recette retirée de la semaine.";
        href = `/semaine?w=${weekStart}`;
        break;
      case "ajouter_habitude":
        saveHabit(db, x.personId, { label: x.label, meal: x.meal, weekdays: [...new Set(x.weekdays)], items: x.items });
        message = "Habitude ajoutée : le repère des repas suit.";
        href = "/sante/habitudes";
        break;
      case "retirer_habitude":
        removeHabit(db, x.personId, x.habitId);
        message = "Habitude retirée.";
        href = "/sante/habitudes";
        break;
      case "manger_boite": {
        const e = eatBox(db, x.boxId, x.personId, now);
        message = `Noté au journal : ${Math.round(e.kcal)} kcal.`;
        href = "/frigo";
        break;
      }
      case "course_decaler":
        editSession(db, personId, x.sessionId, { date: x.date }, now);
        message = "Séance déplacée : la montre suit à la prochaine synchro.";
        href = "/sante/course";
        break;
      case "course_raccourcir":
        editSession(db, personId, x.sessionId, { minutes: Math.round(x.minutes) }, now);
        message = "Séance raccourcie.";
        href = "/sante/course";
        break;
      case "course_remplacer":
        editSession(db, personId, x.sessionId, { kind: x.type, minutes: Math.round(x.minutes) }, now);
        message = "Séance remplacée.";
        href = "/sante/course";
        break;
      case "course_sorties":
      case "course_fc": {
        const p = getRunProfile(db, personId);
        if (!p) throw new Error("Le module Course n'est pas activé.");
        const patch = x.kind === "course_sorties" ? { perWeek: Math.round(x.perWeek) } : { hrMax: x.hrMax != null ? Math.round(x.hrMax) : p.hrMax, hrRest: x.hrRest != null ? Math.round(x.hrRest) : p.hrRest, hrThreshold: x.hrThreshold != null ? Math.round(x.hrThreshold) : p.hrThreshold, thresholdSource: x.hrThreshold != null ? ("saisie" as const) : p.thresholdSource };
        saveRunSettings(db, personId, { ...settingsOf(p), ...patch }, todayParis(now));
        message = x.kind === "course_sorties" ? "Nombre de sorties changé : le plan est recalculé." : "Fréquences enregistrées : zones et alertes recalculées.";
        href = "/sante/course";
        break;
      }
      case "course_decharge":
        setWeekOverride(db, personId, { weekStart: x.weekStart, deload: true });
        message = "Semaine de décharge posée.";
        href = "/sante/course";
        break;
      case "faire_courses": {
        const w = loadWeek(db, weekStart);
        const sel = loadSelection(db, w.planId);
        const listId = startShoppingList(db, sel.map((s) => s.slug), { weekPlanId: w.planId, scales: Object.fromEntries(sel.map((s) => [s.slug, s.factor])), extras: Object.assign({}, ...sel.map((s) => s.extras)) });
        message = "Liste de courses lancée.";
        href = `/courses/${listId}`;
        break;
      }
    }
    setAction(db, row, index, { status: "applied", check, result: message, href });
    return { ok: true, message, href };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Action impossible." };
  }
}

export function dismissAssistantAction(db: Db, personId: string, id: string, index: number) {
  const row = findRow(db, personId, id);
  const a = row && actionsOf(row)[index];
  if (!row || !a || a.status !== "proposed") return false;
  setAction(db, row, index, { status: "dismissed" });
  return true;
}

// ─── Vue ───

export interface AssistantActionView extends Partial<ActionCard> {
  index: number;
  /** Le type d'action (les cartes de course ont leur repère). */
  kind: string;
  why: string;
  status: AssistantAction["status"];
  reason: string | null;
  result: string | null;
  href: string | null;
}

export interface AssistantView {
  id: string;
  role: "user" | "assistant";
  text: string;
  actions: AssistantActionView[];
}

export function toView(r: AssistantRow): AssistantView {
  return {
    id: r.id,
    role: r.role,
    text: r.text,
    actions: actionsOf(r).map((a, index) => ({
      index,
      kind: a.input.kind,
      why: a.why,
      status: a.status,
      ...(a.check.ok ? { title: a.check.title, lines: a.check.lines, notes: a.check.notes } : { title: KIND_LABEL[a.input.kind] }),
      reason: a.check.ok ? null : a.check.reason,
      result: a.result ?? null,
      href: a.href ?? null,
    })),
  };
}

export const viewsFor = (db: Db, personId: string) => listAssistant(db, personId).map(toView);
