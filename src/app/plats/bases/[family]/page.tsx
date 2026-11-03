// Une base du foyer (le riz, les haricots verts) : ses gros récipients, ce qui reste dans chacun, la pesée,
// « C’est fini » ; et « Refaire » : une mini-session simple (le cru, l’eau, la casserole de la cuisine, la
// durée, combien de gros récipients remplir), sans liste de courses si le placard en a.
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BaseSheet } from "@/components/plats/BaseSheet";
import { db } from "@/lib/db/client";
import { activeProfileId } from "@/lib/health/active";
import { todayParis } from "@/lib/health/store";
import { baseFamily } from "@/lib/reserve/bases";
import { listBases } from "@/lib/reserve/bases-store";
import { listDishes } from "@/lib/reserve/store";

export const dynamic = "force-dynamic";

export default async function Base({ params }: { params: Promise<{ family: string }> }) {
  const { family } = await params;
  const f = baseFamily(family);
  if (!f) notFound();
  const me = await activeProfileId();
  const now = new Date();
  const base = listBases(db, listDishes(db, me, now), now, f.key).find((b) => b.family === f.key);
  if (!base) notFound();
  return (
    <>
      <AutoRefresh />
      <BaseSheet base={base} today={todayParis(now)} raw={f.raw} some={f.some} />
    </>
  );
}
