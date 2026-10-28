import { openDb } from "@/lib/db/open";
import { seedBase } from "@/seed/seed";

const { db } = openDb();
console.log("[seed]", seedBase(db));
