import { openDb } from "@/lib/db/open";
import { reserves } from "@/lib/db/schema";
import { targetsOf, listDishes } from "@/lib/reserve/store";
import fs from "fs";
const f = fs.readdirSync("/tmp/mijote-demo/demo").find((x) => x.startsWith("modele"))!;
const { db } = openDb("/tmp/mijote-demo/demo/" + f);
for (const r of db.select().from(reserves).all()) {
  console.log(r.name, r.status, r.counts, r.groups.map((g) => [g.key, g.g, g.kcalG?.toFixed(2)]));
  console.log(targetsOf(db, { kcalUnit: r.kcalUnit, proteinUnit: r.proteinUnit }).map((t) => [t.name, Math.round(t.kcal!), t.kcalMax]));
}
console.log(listDishes(db, "alex").filter(d=>d.status==="cooked").map((d) => [d.name, d.rest, d.short, d.people.map((p) => [p.name, p.left, p.inBoxes, p.portion?.kcal])]));
