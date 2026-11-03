// « Où j'en suis » vu par la base : le bilan de la semaine, les pesées, le journal et le repère d'un repas.
// Le calcul est dans ./status (pur, testé).
import type { Db } from "@/lib/db/open";
import { eaterOf } from "@/lib/eaters/store";
import { addDays } from "@/lib/week/propose";
import { whereIAm, type Status } from "./status";
import { currentReview, intakeDays, listWeighIns, todayParis, toProfile, type Person } from "./store";

export interface StatusView extends Status {
  person: { id: string; name: string };
  /** Les jours de la fenêtre du lundi, d'aujourd'hui en arrière : ce qui est noté, et s'il est complet. */
  days: { date: string; kcal: number | null; proteinG: number | null; complete: boolean }[];
}

export function statusFor(db: Db, p: Person, now = new Date()): StatusView {
  const today = todayParis(now);
  const e = eaterOf(db, p, now);
  const review = currentReview(db, p, now);
  const intake = intakeDays(db, p.id, addDays(today, -35));
  const s = whereIAm({
    today,
    profile: toProfile(p),
    targetWeightKg: p.targetWeightKg,
    review,
    weighIns: listWeighIns(db, p.id),
    intake,
    meal: { mode: e.refMode, ref: e.ref, targetRef: e.targetRef, limited: e.refLimited },
  });
  const byDate = new Map(intake.map((d) => [d.date, d]));
  const days: StatusView["days"] = [];
  for (let d = today; d >= s.update.window.start; d = addDays(d, -1)) {
    const x = byDate.get(d);
    days.push({ date: d, kcal: x ? Math.round(x.kcal) : null, proteinG: x?.proteinG != null ? Math.round(x.proteinG) : null, complete: !!x?.complete });
  }
  return { ...s, person: { id: p.id, name: p.name }, days };
}
