// Frise des ressources du Composer (DA « Plan de travail », .lanes) tirée du plan du planificateur, en mode seul :
// la planche pendant la prep (gestes bout à bout, puis ceux glissés dans la cuisson), le four et chaque foyer.
// Une barre cernée de rouge = une étape citée dans une erreur du plan (conflit). Affichage seulement.
import type { Lane } from "@/components/ui";
import type { SessionPlan } from "@/lib/session/planner";

const NEUTRAL = "var(--c-ink-3)";

export function planLanes(plan: SessionPlan): { lanes: Lane[]; total: number } {
  const color = new Map(plan.recipes.map((r) => [r.slug, r.color]));
  const clash = new Set(plan.errors.flatMap((e) => e.stepIds));
  const colorOf = (slug: string | null | undefined) => (slug ? (color.get(slug) ?? NEUTRAL) : NEUTRAL);
  const prepMin = plan.mode === "duo" ? 0 : plan.prep.minutes;

  // Planche : les gestes de prep, à la suite (seul) ou à leur heure (à deux).
  let t = 0;
  const board = plan.prep.tasks
    .filter((k) => !k.eve)
    .map((k) => {
      const from = k.startMin ?? t;
      const to = k.endMin ?? from + k.minutes;
      t = to;
      return { from, to, color: colorOf(k.recipeSlug), title: `${k.title} · ${Math.round(k.minutes)} min` };
    });

  const at = (m: number) => prepMin + m;
  // Seul : les gestes glissés dans la cuisson, à leur heure.
  for (const s of plan.steps.filter((x) => x.tasks)) board.push({ from: at(s.startMin), to: at(s.endMin), color: colorOf(s.recipeSlug), title: `${s.tasks!.map((k) => k.title).join(", ")} · ${Math.round(s.durationMin)} min` });
  const oven = plan.steps
    .filter((s) => s.oven || s.kind === "preheat")
    .map((s) => ({ from: at(s.startMin), to: at(s.endMin), color: colorOf(s.recipeSlug), clash: clash.has(s.id), title: s.oven ? `${s.text} · ${s.oven.temp} °C` : s.text }));
  const hobs = plan.hobs.map((h) => ({
    label: h.name,
    bars: plan.steps
      .filter((s) => s.hobId === h.id)
      .map((s) => ({ from: at(s.startMin), to: at(s.hobUntilMin ?? s.endMin), color: colorOf(s.recipeSlug), clash: clash.has(s.id), title: `${s.text}${s.equipmentName ? ` · ${s.equipmentName}` : ""}` })),
  }));

  const lanes: Lane[] = [];
  if (board.length) lanes.push({ label: "Planche", bars: board });
  if (oven.length) lanes.push({ label: "Four", bars: oven });
  for (const h of hobs) if (h.bars.length) lanes.push(h);
  return { lanes, total: plan.totalMin };
}
