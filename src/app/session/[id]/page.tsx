import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { db } from "@/lib/db/client";
import { dayPlan, eventsAfter, getSession } from "@/lib/session/store";
import { SessionApp } from "@/components/session/SessionApp";
import { modeOf, type SessionPlan } from "@/lib/session/planner";
import type { DayChoice } from "@/components/session/SessionApp";

const busy = (plan: SessionPlan, p: "A" | "B") =>
  plan.prep.tasks.filter((t) => t.person === p).reduce((x, t) => x + t.minutes, 0) + plan.steps.filter((x) => x.person === p).reduce((x, st) => x + st.activeMin, 0);

export const dynamic = "force-dynamic";

export default async function SessionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ vue?: string; personne?: string }> }) {
  const { id } = await params;
  const { vue, personne } = await searchParams;
  const s = getSession(db, id);
  if (!s) notFound();
  const view = vue === "telephone" ? "phone" : "full";
  // L'adresse vue par le navigateur (derrière Caddy et le tunnel : en-têtes transmis).
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3010";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") || /^\d+\.\d+\.\d+\.\d+/.test(host) ? "http" : "https");
  const phoneUrl = `${proto}://${host}/session/${id}?vue=telephone`;
  const qrSvg = view === "full" ? await QRCode.toString(phoneUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) : null;
  // À deux : un QR code par personne, qui ouvre son fil sur son téléphone.
  const duo = modeOf(s.plan) === "duo";
  const personQrs =
    duo && view === "full"
      ? await Promise.all(
          (["A", "B"] as const).map(async (person) => {
            const url = `${phoneUrl}&personne=${person}`;
            return { person, url, svg: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
          })
        )
      : undefined;
  const person = personne === "A" || personne === "B" ? personne : null;
  const events = eventsAfter(db, id, 0);
  // Prep la veille, bols au frigo : ce que donnerait le jour J à deux (le plan n'est enregistré qu'à la reprise).
  let dayChoice: DayChoice | null = null;
  if (modeOf(s.plan) === "veille" && s.status === "fridge") {
    const d = dayPlan(db, id, events);
    dayChoice = {
      solo: { prepMin: s.plan.prep.minutes, cookingMin: s.plan.cookingMin, totalMin: s.plan.prep.minutes + s.plan.cookingMin },
      duo: d && d.errors.length === 0 ? { totalMin: d.totalMin, aMin: busy(d, "A"), bMin: busy(d, "B") } : null,
    };
  }
  return (
    <SessionApp
      id={id}
      plan={s.plan}
      startedAt={s.startedAt}
      initialStatus={s.status}
      initialEvents={events}
      view={view}
      phoneUrl={phoneUrl}
      qrSvg={qrSvg}
      serverNow={Date.now()}
      personQrs={personQrs}
      person={person}
      dayChoice={dayChoice}
      test={s.test}
    />
  );
}
