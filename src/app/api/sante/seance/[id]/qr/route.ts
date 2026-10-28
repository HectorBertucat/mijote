// QR code de la télécommande d'une séance : le téléphone le scanne depuis l'écran du MacBook.
import QRCode from "qrcode";
import { headers } from "next/headers";
import { db } from "@/lib/db/client";
import { getLive } from "@/lib/training/live-store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getLive(db, id)) return new Response("séance inconnue", { status: 404 });
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3010";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") || /^\d+\.\d+\.\d+\.\d+/.test(host) ? "http" : "https");
  const url = `${proto}://${host}/sante/entrainement?seance=${id}&vue=telecommande`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return Response.json({ url, svg });
}
