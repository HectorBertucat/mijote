"use client";

// Santé > Entraînement : lancer la séance du jour (A/B alternées), la bibliothèque d’exercices animés,
// le carnet (où j’en suis, « prêt à monter ») et le programme. Les séances d’Apple Santé (natation…)
// apparaissent dans le carnet et dans « Cette semaine ».
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, EmptyState, Segmented, Sheet, Tabs } from "@/components/ui";
import { de, NB, NNB, Verdict } from "../carnet";
import { useToast } from "@/components/cart/Toast";
import { removeWorkout } from "@/app/sante/actions";
import { lastFor, levelFor, nextType, ready, type Exercise, type Program, type Workout } from "@/lib/training/program";
import { DuoSession } from "./DuoSession";
import { LoopingFigure, MotionsContext } from "./KbFigure";
import { ProgramBuilder, type TemplateInfo } from "./ProgramBuilder";
import { fmtDay, LiveSession, type LiveView } from "./LiveSession";
import type { LiveRowClient } from "./useLiveSync";

export type View = "seance" | "exercices" | "carnet" | "programme";
type AppleWorkout = { start: string; type: string; minutes: number; distanceM: number | null };
/** L’autre personne qui suit un programme (séance à deux). */
export type Partner = { id: string; name: string; programId: string; workouts: Workout[] };
/** Ce qu’il faut pour créer un programme (modèles, IA disponible). */
export type BuilderInfo = { templates: TemplateInfo[]; aiReady: boolean };

const VIEWS: { value: View; label: string }[] = [
  { value: "seance", label: "Séance" },
  { value: "exercices", label: "Exercices" },
  { value: "carnet", label: "Carnet" },
  { value: "programme", label: "Programme" },
];

const SPORT: Record<string, string> = { swimming: "Natation", swim: "Natation", natation: "Natation", pilates: "Pilates", walking: "Marche", running: "Course", cycling: "Vélo", functionalstrengthtraining: "Renforcement", traditionalstrengthtraining: "Musculation" };
const sportName = (t: string) => SPORT[t.toLowerCase().replace(/^hkworkoutactivitytype/, "").replace(/[\s_-]/g, "")] ?? t;

export function Training({ personId, personName, programId, programs, builder, workouts, apple, weekStart, view: view0, live: live0, liveView, pairLive, partner }: { personId: string; personName: string; programId: string | null; programs: Record<string, Program>; builder: BuilderInfo; workouts: Workout[]; apple: AppleWorkout[]; weekStart: string; view: View; live: LiveRowClient | null; liveView: LiveView; pairLive: LiveRowClient | null; partner: Partner | null }) {
  const programById = (id: string): Program | null => programs[id] ?? null;
  // La séance en cours (lue sur le serveur, partagée entre les écrans) ; ouverte depuis le QR d’un autre écran, elle peut être celle d’un autre profil.
  const [live, setLive] = useState<LiveRowClient | null>(live0);
  const [pair, setPair] = useState<LiveRowClient | null>(pairLive);
  const workoutsOf = (pid: string) => (pid === personId ? workouts : pid === partner?.id ? partner.workouts : []);
  const nameOf = (pid: string) => (pid === personId ? personName : pid === partner?.id ? partner.name : "");
  const program = live ? programById(live.live.program) : programId ? programById(programId) : null;
  const [view, setView] = useState<View>(view0);
  const [starting, setStarting] = useState(false);
  // La séance dépend de l’heure (chronos, rythme) : rendue seulement dans le navigateur.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const router = useRouter();
  const start = async (type: string) => {
    if (!program || starting) return;
    setStarting(true);
    const r = await fetch("/api/sante/seance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId, programId: program.id, type }) })
      .then((x) => (x.ok ? (x.json() as Promise<LiveRowClient>) : null))
      .catch(() => null);
    setStarting(false);
    if (r) {
      setPair(null);
      setLive(r);
    }
  };
  const startDuo = async (mine: string, theirs: string) => {
    if (!program || !partner || starting) return;
    setStarting(true);
    const body = { duo: [{ personId, programId: program.id, type: mine }, { personId: partner.id, programId: partner.programId, type: theirs }] };
    const r = await fetch("/api/sante/seance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((x) => (x.ok ? (x.json() as Promise<{ rows: [LiveRowClient, LiveRowClient] }>) : null))
      .catch(() => null);
    setStarting(false);
    if (r) {
      setPair(r.rows[1]);
      setLive(r.rows[0]);
    }
  };
  const ended = () => {
    setLive(null);
    setPair(null);
    router.replace("/sante/entrainement");
    router.refresh();
  };

  const pick = (v: View) => {
    setView(v);
    try {
      history.replaceState(null, "", v === "seance" ? "/sante/entrainement" : `/sante/entrainement?vue=${v}`);
    } catch {}
  };

  if (!program)
    return (
      <div className="grid gap-12">
        <EmptyState icon="kb" title={`Pas encore de programme pour ${personName}`}>
          Choisis un modèle ou crée un programme sur mesure : chaque exercice a sa figure animée, au bon tempo. Les séances notées dans Apple Santé (marche, vélo…) s’affichent aussi ici.
        </EmptyState>
        <ProgramBuilder personId={personId} personName={personName} templates={builder.templates} aiReady={builder.aiReady} />
        <AppleList apple={apple} />
      </div>
    );

  if (live && view === "seance" && !mounted) return <div className="kitchen-dark fixed inset-0 z-30 bg-bg" />;
  const pairProgram = pair ? programById(pair.live.program) : null;
  const partnerProgram = partner ? programById(partner.programId) : null;
  const motions = { ...partnerProgram?.motions, ...pairProgram?.motions, ...program.motions };
  if (live && pair && pairProgram && view === "seance" && liveView === "ecran")
    return (
      <MotionsContext value={motions}>
      <DuoSession
        key={`${live.id}+${pair.id}`}
        panes={[
          { row: live, program, workouts: workoutsOf(live.personId), name: nameOf(live.personId) },
          { row: pair, program: pairProgram, workouts: workoutsOf(pair.personId), name: nameOf(pair.personId) },
        ]}
        onEnd={ended}
      />
      </MotionsContext>
    );
  if (live && view === "seance")
    return (
      <MotionsContext value={motions}>
        <LiveSession key={live.id} program={program} initial={live} workouts={workoutsOf(live.personId)} view={liveView} onEnd={ended} />
      </MotionsContext>
    );

  return (
    <MotionsContext value={motions}>
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12">
      <Tabs items={VIEWS} value={view} onChange={pick} label="Entraînement" />
      {view === "seance" && <Start p={program} workouts={workouts} apple={apple} weekStart={weekStart} onStart={start} />}
      {view === "seance" && partner && partnerProgram && <DuoStart me={{ name: personName, p: program, workouts }} other={{ name: partner.name, p: partnerProgram, workouts: partner.workouts }} starting={starting} onStart={startDuo} />}
      {view === "exercices" && <Library p={program} workouts={workouts} />}
      {view === "carnet" && <Carnet p={program} workouts={workouts} apple={apple} />}
      {view === "programme" && <Programme p={program} />}
      {view === "programme" && <ChangeProgram personId={personId} personName={personName} builder={builder} />}
    </div>
    </MotionsContext>
  );
}

/** Changer de programme : le carnet reste, l’ancien programme est archivé. */
function ChangeProgram({ personId, personName, builder }: { personId: string; personName: string; builder: BuilderInfo }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <div className="flex flex-wrap gap-2">
        <Button icon="sliders" onClick={() => setOpen(true)}>
          Changer de programme
        </Button>
      </div>
    );
  return <ProgramBuilder personId={personId} personName={personName} templates={builder.templates} aiReady={builder.aiReady} onDone={() => setOpen(false)} />;
}

// ---------- Séance du jour ----------

function Start({ p, workouts, apple, weekStart, onStart }: { p: Program; workouts: Workout[]; apple: AppleWorkout[]; weekStart: string; onStart: (t: string) => void }) {
  const next = nextType(p, workouts);
  const last = workouts[0];
  const progWeek = workouts.filter((w) => w.date >= weekStart).length;
  const also = p.alsoTrack;
  const alsoWeek = also ? apple.filter((a) => a.start.slice(0, 10) >= weekStart && sportName(a.type) === also.sport).length : 0;
  return (
    <div className="grid gap-12">
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-6">
        <p className="text-lead lg:col-span-7">Pose le téléphone, lance la séance : chaque exercice s’anime au bon tempo, le rythme guidé compte tes répétitions avec un bip, et le repos se chronomètre seul.</p>
        <dl className="grid grid-cols-2 gap-6 lg:col-span-5 lg:border-l lg:border-line lg:pl-6">
          <div className="grid content-start gap-2">
            <dt className="label text-ink-2">{p.short} cette semaine</dt>
            <dd className="num-tight text-[48px] leading-[0.9]">
              {progWeek}
              <span className="text-[0.4em] text-ink-2">{`${NB}/${NB}${p.perWeek}`}</span>
            </dd>
            {progWeek >= p.perWeek && <Verdict tone="ok">semaine tenue</Verdict>}
          </div>
          {also && (
            <div className="grid content-start gap-2">
              <dt className="label text-ink-2">{also.sport}</dt>
              <dd className="num-tight text-[48px] leading-[0.9]">
                {alsoWeek}
                <span className="text-[0.4em] text-ink-2">{`${NB}/${NB}${also.target}`}</span>
              </dd>
              {alsoWeek >= also.target && <Verdict tone="ok">tenu</Verdict>}
            </div>
          )}
          {last && <p className="col-span-2 text-small text-ink-2">Dernière séance : {p.sessions[last.type]?.name ?? last.type}, {fmtDay(last.date)}</p>}
        </dl>
      </div>
      <div className="grid gap-12 sm:grid-cols-2 sm:gap-6">
        {Object.entries(p.sessions).map(([t, s]) => {
          const on = t === next;
          return (
            <section key={t} aria-labelledby={`seance-${t}`} className={`grid content-start gap-6 border-t-2 pt-4 ${on ? "border-ink" : "border-line-strong"}`}>
              <div className="flex items-baseline justify-between gap-4">
                <h2 id={`seance-${t}`} className="text-h2">
                  {s.name}
                </h2>
                {on && <span className="label text-accent">Celle du jour</span>}
              </div>
              <p className="text-ink-2">{s.sub}</p>
              <ol className="grid border-t border-line">
                {s.blocks.map((b, i) => (
                  <li key={b.label} className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-4 border-b border-line py-3">
                    <span className="num-tight text-[20px] leading-none text-ink-3">{i + 1}</span>
                    <span className="min-w-0">
                      <b>{b.label}</b>
                      <span className="block text-small text-ink-2">
                        {b.items.map((x) => p.exercises[x].short).join(" + ")}
                        {b.sets ? ` · ${b.sets}${NB}tours` : b.emom ? ` · ${b.emom.rounds}${NB}×${NB}${b.emom.reps}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
              <div>
                <Button variant={on ? "primary" : "secondary"} size="kitchen" icon="play" onClick={() => onStart(t)}>
                  Lancer la séance {t}
                </Button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Séance à deux ----------

/** Les deux côte à côte sur le MacBook, chacun sa séance (celle du jour par défaut) et son téléphone. */
function DuoStart({ me, other, starting, onStart }: { me: { name: string; p: Program; workouts: Workout[] }; other: { name: string; p: Program; workouts: Workout[] }; starting: boolean; onStart: (mine: string, theirs: string) => void }) {
  const [mine, setMine] = useState(() => nextType(me.p, me.workouts));
  const [theirs, setTheirs] = useState(() => nextType(other.p, other.workouts));
  const row = (x: typeof me, v: string, set: (t: string) => void) => (
    <div className="flex flex-wrap items-center gap-3">
      <b className="min-w-18 text-h3">{x.name}</b>
      <Segmented label={`Séance ${de(x.name)}`} value={v} onChange={set} options={Object.entries(x.p.sessions).map(([t, s]) => ({ value: t, label: s.name }))} />
    </div>
  );
  return (
    <section aria-labelledby="duo" className="grid content-start gap-6 border-t border-line-strong pt-4">
      <h2 id="duo" className="text-h2">Séance à deux</h2>
      <p className="max-w-[62ch] text-ink-2">L’écran se partage en deux : chacun sa séance, son rythme et ses repos. Chacun scanne le QR de sa moitié pour piloter depuis son téléphone.</p>
      <div className="grid gap-3">
        {row(me, mine, setMine)}
        {row(other, theirs, setTheirs)}
      </div>
      <div>
        <Button size="kitchen" icon="play" state={starting ? "loading" : "idle"} loadingLabel="Lancement…" onClick={() => onStart(mine, theirs)}>
          Lancer à deux
        </Button>
      </div>
    </section>
  );
}

// ---------- Bibliothèque ----------

function Library({ p, workouts }: { p: Program; workouts: Workout[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const e = open ? p.exercises[open] : null;
  const l = open ? lastFor(workouts, open) : null;
  return (
    <>
      <div className="reveal grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {p.order.map((id) => {
          const x = p.exercises[id];
          return (
            <button key={id} type="button" onClick={() => setOpen(id)} className="group grid content-start gap-2 rounded-[8px] text-left">
              <span className="block rounded-[8px] border border-line transition-colors duration-[var(--dur-1)] ease-[var(--ease-out)] group-hover:border-ink">
                <LoopingFigure ex={id} />
              </span>
              <b className="text-h3 leading-tight group-hover:underline group-hover:underline-offset-4">{x.name}</b>
              <span className="text-small text-ink-2">{x.muscles}</span>
              <span className="num text-small font-bold">{dose(p, id, x)}</span>
              {ready(p, workouts, id) && <Verdict tone="ok">prêt à monter</Verdict>}
            </button>
          );
        })}
      </div>
      <Sheet open={!!open} onClose={() => setOpen(null)} title={e?.name ?? ""} width={560}>
        {open && e && (
          <div className="grid gap-4">
            <LoopingFigure ex={open} className="mx-auto w-full max-w-[320px]" />
            <dl className="grid grid-cols-2 gap-6 border-y border-line py-4">
              <div className="grid gap-1">
                <dt className="label text-ink-2">Dose</dt>
                <dd className="num-tight text-[24px] leading-none">
                  {e.reps[0]}–{e.reps[1]}
                  <span className="text-small font-bold text-ink-2">{`${NB}${e.unit === "s" ? "s" : "reps"}${e.uni ? " par côté" : ""}`}</span>
                </dd>
              </div>
              <div className="grid gap-1">
                <dt className="label text-ink-2">Tempo</dt>
                <dd className="num-tight text-[24px] leading-none">{e.tempo}</dd>
              </div>
            </dl>
            <p className="text-small text-ink-2">{e.muscles}</p>
            {e.guide ? <Guide g={e.guide} /> : <Section title="Comment faire" items={e.cues} />}
            <Section title="Erreurs fréquentes" items={e.errors} />
            <div className="grid gap-2">
              <b className="label text-ink-2">Échelle de progression</b>
              <p className="text-small text-ink-2">Passe au cran suivant quand tu fais le haut de la fourchette sur toutes les séries.</p>
              <ol className="grid border-t border-line">
                {e.ladder.map((v, i) => {
                  const mine = l && i === levelFor(workouts, open);
                  return (
                    <li key={v} className={`grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 border-b border-line py-2 ${mine ? "font-bold" : ""}`}>
                      <span className="num text-ink-3">{i + 1}</span>
                      <span>
                        {v} {mine && <span className="label ml-2 text-accent">ton cran</span>}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
            {l && (
              <p className="text-small text-ink-2">
                <b className="text-ink">Dernière fois</b> ({fmtDay(l.date)}) : <span className="tabular-nums">{l.sets.join(" · ")}</span>
              </p>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}

/** « 8–12 reps / côté », ou « 8 × 10 swings » pour un exercice minuté au bip. */
function dose(p: Program, id: string, x: Exercise): string {
  for (const s of Object.values(p.sessions)) for (const b of s.blocks) if (b.emom && b.items.includes(id)) return `${b.emom.rounds} × ${b.emom.reps} ${x.short.toLowerCase()}`;
  return `${x.reps[0]}–${x.reps[1]} ${x.unit === "s" ? "s" : "reps"}${x.uni ? " / côté" : ""}`;
}

/** Consignes pas à pas, pour qui découvre le geste. */
function Guide({ g }: { g: NonNullable<Exercise["guide"]> }) {
  const rows: [string, string | undefined][] = [
    ["Position de départ", g.position],
    ["Le mouvement", g.movement],
    ["Où tu dois le sentir", g.feel],
    ["Respiration", g.breathing],
    ["Si c’est trop dur ou que ça gêne", g.easier],
  ];
  return (
    <div className="grid gap-3">
      {rows.map(([t, v]) =>
        v ? (
          <div key={t} className="grid gap-1">
            <b className="label text-ink-2">{t}</b>
            <p>{v}</p>
          </div>
        ) : null
      )}
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="grid gap-2">
      <b className="label text-ink-2">{title}</b>
      <ul className="grid list-disc gap-1 pl-6">
        {items.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Carnet ----------

function Carnet({ p, workouts, apple }: { p: Program; workouts: Workout[]; apple: AppleWorkout[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sure, setSure] = useState<string | null>(null);
  const { show, node } = useToast();
  const done = p.order.filter((id) => lastFor(workouts, id));
  if (!workouts.length && !apple.length)
    return (
      <EmptyState icon="book" title="Ton carnet est vide">
        Chaque séance terminée s’enregistre ici, avec tes répétitions et ta variante.
      </EmptyState>
    );
  return (
    <div className="grid gap-12 lg:gap-18">
      {done.length > 0 && (
        <section aria-labelledby="ou" className="grid gap-6 border-t border-line-strong pt-4">
          <h2 id="ou" className="text-h2">Où j’en suis</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="label text-ink-2">
                  <th className="py-2 pr-4 font-[inherit]">Exercice</th>
                  <th className="py-2 pr-4 font-[inherit]">Dernières séries</th>
                  <th className="hidden py-2 pr-4 font-[inherit] sm:table-cell">Variante</th>
                  <th className="py-2 font-[inherit]">Prochaine fois</th>
                </tr>
              </thead>
              <tbody>
                {done.map((id) => {
                  const l = lastFor(workouts, id)!;
                  return (
                    <tr key={id} className="border-t border-line">
                      <td className="py-3 pr-4 font-bold">{p.exercises[id].short}</td>
                      <td className="num whitespace-nowrap py-3 pr-4">
                        {l.sets.join(" · ")}
                        {p.exercises[id].unit === "s" ? " s" : ""}
                      </td>
                      <td className="hidden py-3 pr-4 text-small text-ink-2 sm:table-cell">{p.exercises[id].ladder[l.level]}</td>
                      <td className="py-3">{ready(p, workouts, id) ? <Verdict tone="ok">monte d’un cran</Verdict> : <span className="text-small text-ink-2">Continue</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {workouts.length > 0 && (
        <section aria-labelledby="seances" className="grid gap-6 border-t border-line-strong pt-4">
          <h2 id="seances" className="text-h2">Les séances</h2>
          <ul className="reveal grid border-t border-line">
          {workouts.map((w) => (
            <li key={w.id} className="grid gap-1 border-b border-line py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <b>
                  {p.sessions[w.type]?.name ?? w.type} · {fmtDay(w.date)}
                </b>
                <span className="num text-small text-ink-2">{`${w.minutes ?? "?"}${NB}min`}</span>
                <Button
                  size="sm"
                  variant={sure === w.id ? "danger" : "quiet"}
                  className="ml-auto"
                  disabled={pending}
                  onClick={() => {
                    if (sure !== w.id) return setSure(w.id);
                    start(async () => {
                      const r = await removeWorkout(w.id);
                      show(r.message, r.ok);
                      setSure(null);
                      router.refresh();
                    });
                  }}
                >
                  {sure === w.id ? "Confirmer" : "Supprimer"}
                </Button>
              </div>
              <p className="text-small text-ink-2">
                {w.entries.map((e, i) => (
                  <span key={e.ex}>
                    {i > 0 && " · "}
                    {(p.exercises[e.ex]?.short ?? e.ex)} <span className="tabular-nums">{e.sets.join("/")}</span>
                  </span>
                ))}
              </p>
              {w.note && <p className="text-small">«{NNB}{w.note}{NNB}»</p>}
            </li>
          ))}
          </ul>
        </section>
      )}
      <AppleList apple={apple} />
      {node}
    </div>
  );
}

function AppleList({ apple }: { apple: AppleWorkout[] }) {
  if (!apple.length) return null;
  return (
    <section aria-labelledby="apple" className="grid gap-6 border-t border-line-strong pt-4">
      <h2 id="apple" className="text-h2">Depuis Apple Santé</h2>
      <ul className="grid border-t border-line">
        {apple.map((a) => (
          <li key={a.start} className="flex items-baseline gap-4 border-b border-line py-3">
            <span className="w-28 shrink-0 text-small text-ink-2">{fmtDay(a.start.slice(0, 10))}</span>
            <b>{sportName(a.type)}</b>
            <span className="num ml-auto text-small text-ink-2">
              {`${Math.round(a.minutes)}${NB}min`}
              {a.distanceM ? ` · ${a.distanceM >= 1000 ? `${(a.distanceM / 1000).toFixed(1).replace(".", ",")}${NB}km` : `${Math.round(a.distanceM)}${NB}m`}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- Programme ----------

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function Programme({ p }: { p: Program }) {
  return (
    <div className="grid gap-12 lg:gap-18">
      <section aria-labelledby="semaine" className="grid gap-6 border-t border-line-strong pt-4">
        <h2 id="semaine" className="text-h2">La semaine</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-center text-small">
            <thead className="label text-ink-2">
              <tr>
                <th />
                {DAYS.map((d) => (
                  <th key={d} className="py-2 font-[inherit]">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.weekPlan.map((w, i) => (
                <tr key={i} className="border-t border-line">
                  <th className="py-3 pr-2 text-left font-bold text-ink-2">Semaine {i + 1}</th>
                  {w.map((v, j) => (
                    <td key={j} className="px-1 py-3">
                      <span className={`inline-block ${/repos/i.test(v) ? "text-faint" : p.alsoTrack && v.includes(p.alsoTrack.sport) ? "text-ink-2" : "num-tight text-[17px] text-ink"}`}>{v}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="max-w-[62ch] text-small text-ink-2">{p.weekNote}</p>
      </section>
      <section aria-labelledby="principes" className="grid gap-6 border-t border-line-strong pt-4">
        <h2 id="principes" className="text-h2">Les principes</h2>
        <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2">
          {p.principles.map((c, i) => (
            <div key={c.title} className={`grid content-start grid-cols-[32px_minmax(0,1fr)] gap-x-4 gap-y-2 ${c.wide ? "sm:col-span-2" : ""}`}>
              <span className="num-tight row-span-2 text-[24px] leading-none text-ink-3">{i + 1}</span>
              <h3 className="text-h3">{c.title}</h3>
              <p className="max-w-[62ch] text-ink-2">{c.text}</p>
            </div>
          ))}
        </div>
      </section>
      {p.checkpoint && (
        <p>
          <b>Point d’étape : {new Date(`${p.checkpoint}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}.</b> <span className="text-ink-2">Dis-le dans le projet : je lirai le carnet, le poids et le tour de taille directement ici.</span>
        </p>
      )}
    </div>
  );
}
