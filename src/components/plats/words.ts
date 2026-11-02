// Les mots des plats : date limite, grammes d’une portion, nombre de portions. Sans état.
import { daysBetween, gramsLabel } from "@/lib/boxes/core";
import type { GramLine } from "@/lib/reserve/store";
import { firstOfMonth } from "@/lib/typo";

const fmt = (d: string, o: Intl.DateTimeFormatOptions) => firstOfMonth(new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { ...o, timeZone: "UTC" }));

/** La date limite : un mot d’étiquette et une date ; proche, le jour de la semaine. `tone` : la couleur du verdict. */
export function limitWords(limit: string, freshness: "ok" | "soon" | "past", today: string): { label: string; big: string; tone: string } {
  if (freshness === "past") return { label: "À jeter depuis", big: fmt(limit, { day: "numeric", month: "short" }), tone: "text-ko-ink" };
  if (limit === today) return { label: "À finir", big: "aujourd’hui", tone: "text-warn-ink" };
  if (freshness === "soon") return { label: "À finir", big: "demain", tone: "text-warn-ink" };
  const near = daysBetween(today, limit) <= 6;
  return { label: "Jusqu’au", big: near ? fmt(limit, { weekday: "long", day: "numeric" }) : fmt(limit, { day: "numeric", month: "short" }), tone: "" };
}

/** « plat 210 g · riz 160 g · haricots verts 90 g » ; un seul groupe : « 480 g ». */
export const gramsLine = (grams: GramLine[]) => (grams.length === 1 ? gramsLabel(grams[0].g) : grams.map((g) => `${g.label} ${gramsLabel(g.g)}`).join(" · "));

export const portions = (n: number) => `${n} portion${n > 1 ? "s" : ""}`;
