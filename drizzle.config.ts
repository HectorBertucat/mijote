import { defineConfig } from "drizzle-kit";
import path from "path";

const dataDir = process.env.MIJOTE_DATA_DIR ?? path.join(process.cwd(), "data");

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "sqlite",
  dbCredentials: { url: path.join(dataDir, "mijote.db") },
});
