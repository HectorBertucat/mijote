// Seed idempotent d'une instance : la cuisine standard tant qu'aucune n'est réglée, et les règles
// de la maison (ajoutées une fois : une règle retirée garde sa ligne avec le tag « retiré »).
import type { Db } from "@/lib/db/open";
import { equipment, equipmentFit, preferences } from "@/lib/db/schema";
import { ensureCatalog } from "@/lib/kitchen/store";
import { EQUIPMENT, EQUIPMENT_FIT, PREFERENCES } from "./base";

export function seedBase(db: Db) {
  let equipmentAdded = 0;
  db.transaction((tx) => {
    if (!tx.select({ id: equipment.id }).from(equipment).limit(1).get()) {
      for (const e of EQUIPMENT) tx.insert(equipment).values(e).run();
      tx.insert(equipmentFit).values(EQUIPMENT_FIT).run();
      equipmentAdded = EQUIPMENT.length;
    }
    for (const pref of PREFERENCES) tx.insert(preferences).values(pref).onConflictDoNothing().run();
  });
  ensureCatalog(db);
  return { equipment: equipmentAdded, preferences: PREFERENCES.length };
}
