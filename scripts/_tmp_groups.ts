import fs from "fs";
import { load } from "../tests/helpers";
import { serveGroups } from "@/lib/reserve/groups";
for (const f of fs.readdirSync("src/seed/recipes")) {
  const r = load(f);
  const g = serveGroups(r);
  console.log(r.slug.padEnd(42), g.map((x) => `${x.key}[${x.kind}] ${x.estG}g {${x.items.map((n) => r.ingredients[n].item.split(/[\s,(]/)[0]).join(",")}}`).join("  |  "));
}
