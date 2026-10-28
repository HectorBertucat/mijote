import { Training, type View } from "@/components/sante/training/Training";
import { db } from "@/lib/db/client";
import { activePerson } from "@/lib/health/active";
import { recentWorkouts } from "@/lib/health/samples";
import { listPeople, todayParis } from "@/lib/health/store";
import { programById, programFor, TEMPLATES } from "@/lib/training/programs";
import type { Program } from "@/lib/training/program";
import { activeLive, getLive } from "@/lib/training/live-store";
import { listWorkouts } from "@/lib/training/store";
import { addDays } from "@/lib/week/propose";
import { aiMockEnabled } from "@/lib/ai";

export const dynamic = "force-dynamic";

const VIEWS: View[] = ["seance", "exercices", "carnet", "programme"];

export default async function Entrainement({ searchParams }: { searchParams: Promise<{ vue?: string; seance?: string }> }) {
  const person = await activePerson();
  const { vue, seance } = await searchParams;
  // Séance en cours : celle du lien (QR d'un autre écran), sinon celle de la personne active.
  const linked = seance ? getLive(db, seance) : null;
  const live = linked && !linked.ended ? linked : activeLive(db, person.id);
  // Séance à deux : sur l'écran (pas la télécommande), la séance de l'autre s'affiche à côté.
  const pair = live?.live.pair && vue !== "telecommande" ? getLive(db, live.live.pair) : null;
  // L'autre personne qui suit un programme : pour lancer une séance à deux.
  const mine = programFor(db, person.id);
  const others = listPeople(db).filter((x) => x.id !== person.id).map((x) => ({ x, p: programFor(db, x.id) }));
  const other = others.find((o) => o.p);
  const partner = other ? { id: other.x.id, name: other.x.name, programId: other.p!.id, workouts: listWorkouts(db, other.x.id) } : null;
  // Les programmes dont l'écran peut avoir besoin : le mien, celui de l'autre, ceux des séances ouvertes.
  const programs: Record<string, Program> = {};
  for (const p of [mine, other?.p, live ? programById(db, live.live.program) : null, pair ? programById(db, pair.live.program) : null]) if (p) programs[p.id] = p;
  const builder = {
    templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name, perWeek: t.perWeek, weekNote: t.weekNote, sample: t.order[0] })),
    aiReady: Boolean(process.env.ANTHROPIC_API_KEY) || aiMockEnabled(),
  };
  const today = todayParis();
  // Lundi de la semaine en cours (heure de Paris).
  const weekStart = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const apple = recentWorkouts(db, person.id, 20).map((w) => ({
    start: w.start,
    type: String(w.meta?.type ?? "Séance"),
    minutes: w.value,
    distanceM: typeof w.meta?.distanceM === "number" ? w.meta.distanceM : null,
  }));
  return (
    <Training
      key={person.id}
      personId={person.id}
      personName={person.name}
      programId={mine?.id ?? null}
      programs={programs}
      builder={builder}
      workouts={listWorkouts(db, person.id)}
      apple={apple}
      weekStart={weekStart}
      view={VIEWS.includes(vue as View) ? (vue as View) : "seance"}
      live={live}
      pairLive={pair && !pair.ended ? pair : null}
      partner={partner}
      liveView={vue === "telecommande" ? "telecommande" : "ecran"}
    />
  );
}
