// La session en cours (pour le bandeau « Session en cours » des autres pages).
import { db } from "@/lib/db/client";
import { activeSession } from "@/lib/session/store";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ session: activeSession(db) });
}
