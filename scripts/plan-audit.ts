// Audit du planificateur : toutes les paires et tous les triplets de recettes du seed, seul et à deux,
// dans des cuisines fictives variées (src/lib/session/audit.ts : récipients assez grands, bols en nombre,
// bases regroupées, quantités partout, jamais deux tâches « mains » à la fois).
//
// pnpm plan:audit              → paires dans chaque cuisine, triplets dans la cuisine standard
// pnpm plan:audit --tout       → triplets dans chaque cuisine aussi (plusieurs minutes)
// pnpm plan:audit --paires     → le tableau détaillé des paires (temps total, actif, morts, borne basse)
import fs from "fs";
import { auditPlan, WARNED, type AuditIssue } from "@/lib/session/audit";
import { planSession, type PlannerResources, type PlannerRecipe, type SessionMode, type SessionPlan } from "@/lib/session/planner";
import { DEFAULT_KITCHEN, kitchenEquipment, type KitchenConfig } from "@/lib/kitchen/presets";
import { load, RES } from "../tests/helpers";

const args = new Set(process.argv.slice(2));
const R = fs.readdirSync("src/seed/recipes").filter((f) => f.endsWith(".json")).sort().map(load);

const resOf = (k: KitchenConfig): PlannerResources => {
  const { equipment, fits } = kitchenEquipment(k);
  return {
    equipment: equipment.map((e) => ({ id: e.id, kind: e.kind, name: e.name, maxBatchG: e.maxBatchG ?? null, dimsJson: e.dimsJson ?? null, count: e.count ?? 1, capacityL: e.capacityL ?? null })),
    fits: fits.map((f) => ({ equipmentId: f.equipmentId, hobId: f.hobId, preferred: f.preferred ?? true })),
  };
};

// Cuisines fictives : la standard, une petite (deux foyers, peu de casseroles et de bols), une grande.
const KITCHENS: { name: string; res: PlannerResources }[] = [
  { name: "standard", res: RES },
  {
    name: "petite",
    res: resOf({
      ...DEFAULT_KITCHEN,
      hobSizes: [21, 16],
      pans: [{ material: "inox", cm: 26 }],
      casseroles: [{ cm: 16, liters: 1.5 }, { cm: 20, liters: 3 }],
      faitout: { liters: 5, ovenSafe: false },
      cocotte: { liters: 4, ovenSafe: true },
      plats: 2,
      containers: { bowls: { petit: { count: 2, liters: 0.4 }, moyen: { count: 2, liters: 1.5 }, grand: { count: 1, liters: 3 } }, prepBoxes: { count: 2, liters: 1 }, storageBoxes: { count: 6, liters: 1 }, ovenTrays: 1 },
    }),
  },
  {
    name: "grande",
    res: resOf({
      ...DEFAULT_KITCHEN,
      hobSizes: [28, 21, 18, 18, 14.5],
      pans: [{ material: "inox", cm: 28 }, { material: "fonte", cm: 26 }],
      casseroles: [{ cm: 14, liters: 1 }, { cm: 18, liters: 2.5 }, { cm: 22, liters: 4 }],
      faitout: { liters: 8, ovenSafe: true },
      cocotte: { liters: 7, ovenSafe: true },
      containers: { bowls: { petit: { count: 6, liters: 0.5 }, moyen: { count: 4, liters: 2 }, grand: { count: 3, liters: 4 } }, prepBoxes: { count: 6, liters: 1.2 }, storageBoxes: { count: 16, liters: 1 }, ovenTrays: 2 },
    }),
  },
];

const combos = (k: number): PlannerRecipe[][] => {
  const out: PlannerRecipe[][] = [];
  const rec = (from: number, acc: PlannerRecipe[]) => {
    if (acc.length === k) return void out.push(acc);
    for (let i = from; i < R.length; i++) rec(i + 1, [...acc, R[i]]);
  };
  rec(0, []);
  return out;
};

if (args.has("--paires")) {
  // Le tableau d'origine : la durée des paires face à leur borne basse.
  const vesselBound = (rs: PlannerRecipe[]) => {
    const m = new Map<string, number>();
    for (const r of rs) for (const s of r.steps) if (s.equipmentId && s.kind !== "prep") m.set(s.equipmentId, (m.get(s.equipmentId) ?? 0) + (s.durationMin ?? 0));
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  };
  const rows: Record<string, string | number>[] = [];
  for (const rs of combos(2))
    for (const mode of ["solo", "duo"] as SessionMode[]) {
      const p: SessionPlan = planSession(rs, RES, { mode });
      const alone = rs.map((r) => planSession([r], RES, { mode }));
      const persons = mode === "duo" ? 2 : 1;
      const [vessel, held] = vesselBound(rs);
      const longest = mode === "solo" ? Math.max(...alone.map((a) => a.cookingMin)) + Math.min(...alone.map((a) => a.prep.minutes)) : Math.max(...alone.map((a) => a.totalMin));
      const lb = Math.max(p.activeMin / persons, longest, held);
      rows.push({
        paire: `${rs[0].slug.slice(0, 12)} + ${rs[1].slug.slice(0, 12)}`,
        mode,
        prep: p.prep.minutes,
        total: Math.round(p.totalMin),
        actif: Math.round(p.activeMin),
        morts: Math.round(p.totalMin * persons - p.activeMin),
        borne: Math.round(lb),
        ecart: `${Math.round(((p.totalMin - lb) / lb) * 100)} %`,
        "à la suite": Math.round(alone.reduce((s, a) => s + a.totalMin, 0)),
        tenu: `${vessel} ${held}`,
        bols: `${p.containers?.peak ?? "?"}/${p.containers?.owned ?? "?"}`,
      });
    }
  console.table(rows);
  process.exit(0);
}

const summary: Record<string, string | number>[] = [];
const examples: string[] = [];
let failed = 0;
for (const k of KITCHENS)
  for (const size of [2, 3]) {
    if (size === 3 && k.name !== "standard" && !args.has("--tout")) continue;
    for (const mode of ["solo", "duo"] as SessionMode[]) {
      const counts = new Map<AuditIssue["kind"], number>();
      let plans = 0;
      let total = 0;
      let bowls = 0;
      let peak = 0;
      const t0 = Date.now();
      for (const rs of combos(size)) {
        const p = planSession(rs, k.res, { mode });
        plans++;
        total += p.totalMin;
        bowls += p.bowls.length;
        peak += p.containers?.peak ?? 0;
        for (const i of auditPlan(p, k.res)) {
          counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
          if (!WARNED.includes(i.kind) && examples.length < 25) examples.push(`${k.name} · ${mode} · ${rs.map((r) => r.slug).join(" + ")} : [${i.kind}] ${i.message}`);
        }
      }
      const issues = [...counts.entries()].reduce((x, [kind, n]) => x + (WARNED.includes(kind) ? 0 : n), 0);
      failed += issues;
      summary.push({
        cuisine: k.name,
        recettes: size,
        mode,
        plans,
        "durée moy.": Math.round(total / plans),
        "groupes moy.": Math.round((bowls / plans) * 10) / 10,
        "bols moy.": Math.round((peak / plans) * 10) / 10,
        erreurs: counts.get("error") ?? 0,
        "trop petit": counts.get("vessel_small") ?? 0,
        "trop petit, signalé": counts.get("vessel_warned") ?? 0,
        "bols en trop": counts.get("bowls_over") ?? 0,
        "bols en trop, signalé": counts.get("bowls_warned") ?? 0,
        "bases à part": counts.get("bases_apart") ?? 0,
        "sans quantité": counts.get("no_quantities") ?? 0,
        "mains doubles": counts.get("hands") ?? 0,
        s: Math.round((Date.now() - t0) / 100) / 10,
      });
    }
  }
console.table(summary);
if (examples.length) console.log(examples.join("\n"));
console.log(failed ? `${failed} écart(s).` : "Aucun écart.");
process.exitCode = failed ? 1 : 0;
