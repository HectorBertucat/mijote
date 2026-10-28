// Audit du planificateur : toutes les paires de recettes du seed, seul et à deux.
// pnpm plan:audit → temps total, temps actif, temps morts, borne basse et écart, erreurs.
import fs from "fs";
import { planSession, validatePlan, type SessionMode, type SessionPlan } from "@/lib/session/planner";
import { load, RES } from "../tests/helpers";

const R = fs.readdirSync("src/seed/recipes").filter((f) => f.endsWith(".json")).sort().map(load);
// Le récipient le plus tenu : somme des durées des étapes qui l'utilisent (sans les lavages).
const vesselBound = (rs: typeof R) => {
  const m = new Map<string, number>();
  for (const r of rs) for (const s of r.steps) if (s.equipmentId && s.kind !== "prep") m.set(s.equipmentId, (m.get(s.equipmentId) ?? 0) + (s.durationMin ?? 0));
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
};
const rows: Record<string, string | number>[] = [];
for (let i = 0; i < R.length; i++)
  for (let j = i + 1; j < R.length; j++)
    for (const mode of ["solo", "duo"] as SessionMode[]) {
      const rs = [R[i], R[j]];
      const p: SessionPlan = planSession(rs, RES, { mode });
      const alone = rs.map((r) => planSession([r], RES, { mode }));
      const persons = mode === "duo" ? 2 : 1;
      const [vessel, held] = vesselBound(rs);
      // Borne basse : travail actif réparti sur les personnes, recette la plus longue seule, récipient le plus tenu.
      const longest = mode === "solo" ? Math.max(...alone.map((a) => a.cookingMin)) + Math.min(...alone.map((a) => a.prep.minutes)) : Math.max(...alone.map((a) => a.totalMin));
      const lb = Math.max(p.activeMin / persons, longest, held);
      rows.push({
        paire: `${R[i].slug.slice(0, 12)} + ${R[j].slug.slice(0, 12)}`,
        mode,
        prep: p.prep.minutes,
        total: Math.round(p.totalMin),
        actif: Math.round(p.activeMin),
        morts: Math.round(p.totalMin * persons - p.activeMin),
        borne: Math.round(lb),
        ecart: `${Math.round(((p.totalMin - lb) / lb) * 100)} %`,
        "à la suite": Math.round(alone.reduce((s, a) => s + a.totalMin, 0)),
        tenu: `${vessel} ${held}`,
        erreurs: p.errors.length + validatePlan(p, RES).length,
      });
    }
console.table(rows);
