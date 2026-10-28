// Génère une liste de courses depuis des slugs et l'affiche (critère de fin de l'étape 2).
//   pnpm list:demo chasseur-porc pasta-al-forno-saucisse-ricotta
import { asc, eq } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { shoppingItems } from "@/lib/db/schema";
import { buildShoppingList } from "@/lib/shopping/build";
import type { ResolvedProduct } from "@/lib/chronocatalog";

async function main() {
  const { db } = openDb();
  const id = await buildShoppingList(db, process.argv.slice(2));
  const rows = db.select().from(shoppingItems).where(eq(shoppingItems.listId, id)).orderBy(asc(shoppingItems.position)).all();
  for (const r of rows) {
    const p = r.productJson as ResolvedProduct | null;
    console.log(
      `${r.pantry ? "  " : { ok: "🟢", warn: "🟠", ko: "🔴" }[r.state ?? "warn"]} ${(r.aisle ?? "").padEnd(17)} ${r.pantry ? r.item : `${r.packs} × ${p?.name ?? r.item} ${p?.quantityLabel ?? ""} ${r.totalPrice ?? ""} €`}  [${r.line}]  ${r.warnings.join(" · ")}`
    );
  }
  console.log(`liste ${id}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
