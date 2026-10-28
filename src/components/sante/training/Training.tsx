"use client";

// Santé > Entraînement : lancer la séance du jour (A/B alternées), la bibliothèque d'exercices animés,
// le carnet (où j'en suis, « prêt à monter ») et le programme. Les séances d'Apple Santé (natation…)
// apparaissent dans le carnet et dans « Cette semaine ».
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, EmptyState, Pill, Segmented, Sheet, Tabs, type IconName } from "@/components/ui";
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
/** L'autre personne qui suit un programme (séance à deux). */
export type Partner = { id: string; name: string; programId: string; workouts: Workout[] };
/** Ce qu'il faut pour créer un programme (modèles, IA disponible). */
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
  // La séance en cours (lue sur le serveur, partagée entre les écrans) ; ouverte depuis le QR d'un autre écran, elle peut être celle d'un autre profil.
  const [live, setLive] = useState<LiveRowClient | null>(live0);
  const [pair, setPair] = useState<LiveRowClient | null>(pairLive);
  const workoutsOf = (pid: string) => (pid === personId ? workouts : pid === partner?.id ? partner.workouts : []);
  const nameOf = (pid: string) => (pid === personId ? personName : pid === partner?.id ? partner.name : "");
  const program = live ? programById(live.live.program) : programId ? programById(programId) : null;
  const [view, setView] = useState<View>(view0);
  const [starting, setStarting] = useState(false);
  // La séance dépend de l'heure (chronos, rythme) : rendue seulement dans le navigateur.
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
      <div className="grid gap-4">
        <EmptyState icon="kb" title={`Pas encore de programme pour ${personName}`}>
          Choisis un modèle ou crée un programme sur mesure : chaque exercice a sa figure animée, au bon tempo. Les séances notées dans Apple Santé (marche, vélo…) s'affichent aussi ici.
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
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
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

/** Changer de programme : le carnet reste, l'ancien programme est archivé. */
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
    <div className="grid gap-4">
      <p className="text-[17px] leading-snug">
        Pose le téléphone, lance la séance : chaque exercice s'anime au bon tempo, le rythme guidé compte tes répétitions avec un bip, et le repos se chronomètre tout seul.
      </p>
      <div className="flex flex-wrap gap-2">
        <Pill tone={progWeek >= p.perWeek ? "ok" : "idle"} icon="kb">
          {p.short} cette semaine : {progWeek}/{p.perWeek}
        </Pill>
        {also && (
          <Pill tone={alsoWeek >= also.target ? "ok" : "idle"} icon={also.icon as IconName}>
            {also.sport} : {alsoWeek}/{also.target}
          </Pill>
        )}
        {last && (
          <span className="self-center text-[14px] text-ink-2">
            Dernière séance : {p.sessions[last.type]?.name ?? last.type}, {fmtDay(last.date)}
          </span>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Object.entries(p.sessions).map(([t, s]) => {
          const on = t === next;
          return (
            <Card key={t} pad="md" className={`grid content-start gap-3 ${on ? "ring-2 ring-accent" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[22px] font-extrabold">{s.name}</h2>
                {on && <Pill tone="ok">Celle du jour</Pill>}
              </div>
              <p className="text-ink-2">{s.sub}</p>
              <ol className="grid list-decimal gap-1 pl-5 text-[15px]">
                {s.blocks.map((b) => (
                  <li key={b.label}>
                    <b>{b.label}</b> : {b.items.map((i) => p.exercises[i].short).join(" + ")}
                    {b.sets ? ` · ${b.sets} tours` : b.emom ? ` · ${b.emom.rounds} × ${b.emom.reps}` : ""}
                  </li>
                ))}
              </ol>
              <div>
                <Button variant={on ? "primary" : "secondary"} size="kitchen" icon="play" onClick={() => onStart(t)}>
                  Lancer la séance {t}
                </Button>
              </div>
            </Card>
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
      <b className="min-w-[70px] text-[17px]">{x.name}</b>
      <Segmented label={`Séance de ${x.name}`} value={v} onChange={set} options={Object.entries(x.p.sessions).map(([t, s]) => ({ value: t, label: s.name }))} />
    </div>
  );
  return (
    <Card pad="md" className="grid content-start gap-3">
      <h2 className="text-[22px] font-extrabold">Séance à deux</h2>
      <p className="text-ink-2">
        L'écran se partage en deux : chacun sa séance, son rythme et ses repos. Chacun scanne le QR de sa moitié pour piloter depuis son téléphone.
      </p>
      <div className="grid gap-2">
        {row(me, mine, setMine)}
        {row(other, theirs, setTheirs)}
      </div>
      <div>
        <Button size="kitchen" icon="play" state={starting ? "loading" : "idle"} loadingLabel="Lancement…" onClick={() => onStart(mine, theirs)}>
          Lancer à deux
        </Button>
      </div>
    </Card>
  );
}

// ---------- Bibliothèque ----------

function Library({ p, workouts }: { p: Program; workouts: Workout[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const e = open ? p.exercises[open] : null;
  const l = open ? lastFor(workouts, open) : null;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {p.order.map((id) => {
          const x = p.exercises[id];
          return (
            <button key={id} type="button" onClick={() => setOpen(id)} className="grid content-start gap-1.5 rounded-[16px] border border-line bg-surface p-3 text-left transition-[border-color,transform] duration-[var(--dur-quick)] hover:border-line-strong active:scale-[0.99]">
              <LoopingFigure ex={id} />
              <b className="text-[15px] leading-tight">{x.name}</b>
              <span className="text-[13px] text-ink-2">{x.muscles}</span>
              <span className="flex flex-wrap gap-1.5">
                <span className="text-[13px] font-semibold tabular-nums">{dose(p, id, x)}</span>
                {ready(p, workouts, id) && <Pill tone="ok">Prêt à monter</Pill>}
              </span>
            </button>
          );
        })}
      </div>
      <Sheet open={!!open} onClose={() => setOpen(null)} title={e?.name ?? ""} width={560}>
        {open && e && (
          <div className="grid gap-4">
            <LoopingFigure ex={open} className="mx-auto w-full max-w-[320px]" />
            <div className="flex flex-wrap gap-2">
              <Pill tone="idle">
                {e.reps[0]}–{e.reps[1]} {e.unit === "s" ? "s" : "reps"}
                {e.uni ? " par côté" : ""}
              </Pill>
              <Pill tone="idle" icon="clock">
                {e.tempo}
              </Pill>
            </div>
            <p className="text-[14px] text-ink-2">{e.muscles}</p>
            {e.guide ? <Guide g={e.guide} /> : <Section title="Comment faire" items={e.cues} />}
            <Section title="Erreurs fréquentes" items={e.errors} />
            <div className="grid gap-1.5">
              <b>Échelle de progression</b>
              <p className="text-[13px] text-ink-2">Passe au cran suivant quand tu fais le haut de la fourchette sur toutes les séries.</p>
              <ol className="grid list-decimal gap-1 pl-5 text-[15px]">
                {e.ladder.map((v, i) => (
                  <li key={v}>
                    {v} {l && i === levelFor(workouts, open) && <Pill tone="ok">Ton cran</Pill>}
                  </li>
                ))}
              </ol>
            </div>
            {l && (
              <p className="text-[14px] text-ink-2">
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
    ["Si c'est trop dur ou que ça gêne", g.easier],
  ];
  return (
    <div className="grid gap-3">
      {rows.map(([t, v]) =>
        v ? (
          <div key={t} className="grid gap-0.5">
            <b>{t}</b>
            <p className="text-[15px] leading-snug">{v}</p>
          </div>
        ) : null
      )}
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="grid gap-1.5">
      <b>{title}</b>
      <ul className="grid list-disc gap-1 pl-5 text-[15px] leading-snug">
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
        Chaque séance terminée s'enregistre ici, avec tes répétitions et ta variante.
      </EmptyState>
    );
  return (
    <div className="grid gap-5">
      {done.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-[20px] font-extrabold">Où j'en suis</h2>
          <Card pad="sm" className="overflow-x-auto">
            <table className="w-full text-left text-[15px]">
              <thead className="text-[13px] text-ink-2">
                <tr>
                  <th className="px-2 py-1.5 font-semibold">Exercice</th>
                  <th className="px-2 py-1.5 font-semibold">Dernières séries</th>
                  <th className="hidden px-2 py-1.5 font-semibold sm:table-cell">Variante</th>
                  <th className="px-2 py-1.5 font-semibold">Prochaine fois</th>
                </tr>
              </thead>
              <tbody>
                {done.map((id) => {
                  const l = lastFor(workouts, id)!;
                  return (
                    <tr key={id} className="border-t border-line">
                      <td className="px-2 py-1.5">{p.exercises[id].short}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                        {l.sets.join(" · ")}
                        {p.exercises[id].unit === "s" ? " s" : ""}
                      </td>
                      <td className="hidden px-2 py-1.5 text-ink-2 sm:table-cell">{p.exercises[id].ladder[l.level]}</td>
                      <td className="px-2 py-1.5">{ready(p, workouts, id) ? <Pill tone="ok">Monte d'un cran</Pill> : <span className="text-ink-2">Continue</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </section>
      )}
      {workouts.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-[20px] font-extrabold">Séances {p.short.toLowerCase()}</h2>
          {workouts.map((w) => (
            <Card key={w.id} pad="sm" className="grid gap-1 px-3">
              <div className="flex flex-wrap items-center gap-2">
                <b>
                  {p.sessions[w.type]?.name ?? w.type} · {fmtDay(w.date)}
                </b>
                <span className="text-[14px] tabular-nums text-ink-2">{w.minutes ?? "?"} min</span>
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
              <p className="text-[14px] text-ink-2">
                {w.entries.map((e, i) => (
                  <span key={e.ex}>
                    {i > 0 && " · "}
                    {(p.exercises[e.ex]?.short ?? e.ex)} <span className="tabular-nums">{e.sets.join("/")}</span>
                  </span>
                ))}
              </p>
              {w.note && <p className="text-[14px] italic">{w.note}</p>}
            </Card>
          ))}
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
    <section className="grid gap-2">
      <h2 className="text-[20px] font-extrabold">Depuis Apple Santé</h2>
      <Card pad="sm" className="grid gap-1 px-3">
        {apple.map((a) => (
          <div key={a.start} className="flex items-center gap-3 border-b border-line py-1.5 last:border-0">
            <span className="w-28 shrink-0 text-[14px] text-ink-2">{fmtDay(a.start.slice(0, 10))}</span>
            <b className="text-[15px]">{sportName(a.type)}</b>
            <span className="ml-auto text-[14px] tabular-nums text-ink-2">
              {Math.round(a.minutes)} min{a.distanceM ? ` · ${a.distanceM >= 1000 ? `${(a.distanceM / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(a.distanceM)} m`}` : ""}
            </span>
          </div>
        ))}
      </Card>
    </section>
  );
}

// ---------- Programme ----------

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function Programme({ p }: { p: Program }) {
  return (
    <div className="grid gap-5">
      <section className="grid gap-2">
        <h2 className="text-[20px] font-extrabold">La semaine</h2>
        <Card pad="sm" className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-center text-[14px]">
            <thead className="text-ink-2">
              <tr>
                <th />
                {DAYS.map((d) => (
                  <th key={d} className="py-1.5 font-semibold">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.weekPlan.map((w, i) => (
                <tr key={i} className="border-t border-line">
                  <th className="px-2 py-2 text-left font-semibold text-ink-2">Semaine {i + 1}</th>
                  {w.map((v, j) => (
                    <td key={j} className="px-1 py-2">
                      <span className={`inline-block rounded-[8px] px-1.5 py-0.5 ${v.includes(" · ") ? "bg-accent-soft font-bold text-ink" : p.alsoTrack && v.includes(p.alsoTrack.sport) ? "text-ink" : "text-faint"}`}>{v}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p className="text-[14px] text-ink-2">{p.weekNote}</p>
      </section>
      <section className="grid gap-3 sm:grid-cols-2">
        {p.principles.map((c) => (
          <Card key={c.title} pad="md" className={`grid content-start gap-1.5 ${c.wide ? "sm:col-span-2" : ""}`}>
            <h3 className="text-[17px] font-bold">{c.title}</h3>
            <p className="text-[15px] text-ink-2">{c.text}</p>
          </Card>
        ))}
      </section>
      {p.checkpoint && (
        <p className="text-[15px]">
          <b>Point d'étape : {new Date(`${p.checkpoint}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}.</b> <span className="text-ink-2">Dis-le dans le projet : je lirai le carnet, le poids et le tour de taille directement ici.</span>
        </p>
      )}
    </div>
  );
}
