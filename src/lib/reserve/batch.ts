// Le bilan d'un batch (pur, testé : tests/batch.test.ts) : ce qu'une session a cuit, plat par plat, ses
// groupes et les portions de chacun, pesés ou pas encore.
//
// Règles :
// - une session finie qui a vraiment cuisiné (une étape faite) met chaque plat en réserve, même sans
//   pesée : les groupes sont estimés d'après le cru (grammes de la session × rendement, groups.ts) et
//   les portions de chacun sont celles de la Semaine plus la marge (core.ts, defaultCounts) ;
// - une recette déjà en réserve depuis la veille de la cuisson (rangée par une autre session, une
//   session relancée) ne l'est pas deux fois ; seule la dernière session qui la cuisine compte, et
//   une session terminée sans rien cuire (ouverte pour ranger) ne compte pas ;
// - au-delà de 7 jours, une session oubliée ne crée plus rien ;
// - un plat est « estimé » tant qu'aucun groupe n'est pesé, « en partie pesé » ensuite, « pesé » quand
//   tous le sont ; la pesée peut venir plus tard (le bilan reste ouvert) et ne change pas les kcal de
//   la marmite, seulement ses grammes ;
// - le premier pas « Peser et ranger » est fait quand un plat a été pesé en entier (ou des boîtes
//   rangées avant la réserve).
import { addDays } from "@/lib/week/propose";
import { firstOfMonth } from "@/lib/typo";
import { defaultCounts, weighedGroups, type CalcModel, type ReserveGroup } from "./core";

/** Au-delà, une session finie sans réserve ne crée plus de plats estimés. */
export const ESTIMATE_WINDOW_DAYS = 7;

export type WeighState = "estimated" | "partial" | "weighed";

/** Estimé (aucun groupe pesé), en partie pesé, ou pesé ; une base du foyer se pèse dans son récipient, à part. */
export function weighState(all: Pick<ReserveGroup, "estimated" | "base">[]): WeighState {
  const groups = all.filter((g) => !g.base);
  const est = groups.filter((g) => g.estimated).length;
  if (!groups.length || est === 0) return "weighed";
  return est === groups.length ? "estimated" : "partial";
}

/** La réserve d'une marmite pas pesée : ses groupes estimés d'après le cru, les portions de chacun par défaut. */
export function estimatedReserve(m: CalcModel, at: string): { groups: ReserveGroup[]; counts: Record<string, number> } {
  return { groups: weighedGroups(m, {}, at), counts: defaultCounts(m) };
}

export interface SessionIn {
  id: string;
  /** Jour de cuisson (AAAA-MM-JJ). */
  cookedOn: string;
  /** Fin de la session (ISO) : la plus récente compte. */
  endedAt: string;
  /** Une étape au moins a été faite. */
  cooked: boolean;
  recipeIds: string[];
}

export interface ReserveIn {
  recipeId: string | null;
  cookedOn: string;
}

/**
 * Les plats à mettre en réserve, estimés, faute de pesée : pour chaque recette, la dernière session finie
 * qui l'a cuisinée (dans la fenêtre), si aucune réserve de cette recette n'existe depuis la veille.
 */
export function toEstimate(sessions: SessionIn[], reserves: ReserveIn[], today: string): { sessionId: string; recipeId: string }[] {
  const since = addDays(today, -ESTIMATE_WINDOW_DAYS);
  const seen = new Set<string>();
  const out: { sessionId: string; recipeId: string }[] = [];
  // Une session finie sans rien cuire (ouverte pour ranger, terminée d'emblée) ne compte pas.
  for (const s of sessions.filter((x) => x.cooked).sort((a, b) => b.endedAt.localeCompare(a.endedAt))) {
    for (const r of s.recipeIds) {
      if (seen.has(r)) continue;
      seen.add(r);
      if (s.cookedOn < since || s.cookedOn > today) continue;
      if (reserves.some((x) => x.recipeId === r && x.cookedOn >= addDays(s.cookedOn, -1))) continue;
      out.push({ sessionId: s.id, recipeId: r });
    }
  }
  return out;
}

/** Un plat du bilan, tel que le résume la liste. */
export interface BatchDishIn {
  open: boolean;
  weigh: WeighState;
  /** Portions de tout le foyer : en tout, et restantes. */
  total: number;
  left: number;
}

export interface BatchSummary {
  dishes: number;
  /** Plats encore en réserve pas entièrement pesés. */
  toWeigh: number;
  portions: number;
  left: number;
  /** Des portions en réserve sont estimées. */
  estimated: boolean;
}

export function batchSummary(dishes: BatchDishIn[]): BatchSummary {
  const toWeigh = dishes.filter((d) => d.open && d.weigh !== "weighed").length;
  return {
    dishes: dishes.length,
    toWeigh,
    portions: dishes.reduce((s, d) => s + d.total, 0),
    left: dishes.reduce((s, d) => s + d.left, 0),
    estimated: toWeigh > 0,
  };
}

/** « Le batch du 1er novembre ». */
export function batchTitle(cookedOn: string): string {
  return `Le batch du ${firstOfMonth(new Date(`${cookedOn}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" }))}`;
}

/** Le batch d'une période : cuit de trois jours avant son premier jour à son dernier. */
export const batchInPeriod = (cookedOn: string, start: string, days: number) => cookedOn >= addDays(start, -3) && cookedOn <= addDays(start, days - 1);

/** Premier pas « Peser et ranger » : un plat pesé en entier, ou des boîtes rangées avant la réserve. */
export const weighedOnce = (reserves: { groups: Pick<ReserveGroup, "estimated" | "base">[] }[], legacyBoxes: boolean) => legacyBoxes || reserves.some((r) => r.groups.length > 0 && weighState(r.groups) === "weighed");
