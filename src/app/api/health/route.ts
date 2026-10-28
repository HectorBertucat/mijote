import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { recipes } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function release(): string {
  try {
    return (JSON.parse(fs.readFileSync(path.join(process.cwd(), "release.json"), "utf8")) as { release: string }).release;
  } catch {
    return "dev";
  }
}

/** Santé de l'appli, lue par le script de release : base ouverte, migrée, et sha servi. */
export function GET() {
  try {
    const n = db.select({ n: sql<number>`count(*)` }).from(recipes).get()?.n ?? 0;
    return NextResponse.json({ ok: true, release: release(), recipes: n });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
