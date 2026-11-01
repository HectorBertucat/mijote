"use client";

// Séance guidée, plein écran et sombre (comme la cuisson sur téléphone), partagée entre les écrans :
// le MacBook posé à 2 m fait l’écran (barre espace = bouton principal), chaque téléphone peut servir
// de télécommande (?vue=telecommande, par le QR). L'état vit sur le serveur (src/lib/training/live.ts,
// useLiveSync) : un geste sur un écran s’affiche sur tous.
// Pendant l’effort, un chiffre héros (la répétition ou les secondes) et rien à saisir : « Série faite »
// en un geste, ou toute seule à la fin du rythme guidé. Le compte se corrige pendant le repos, qui
// montre aussi l’exercice suivant qui tourne. Le rythme guidé ne garde que son heure de départ : la
// figure, la phase, les bips et le compte en découlent, à la même seconde sur chaque écran. Il part après
// quelques secondes de mise en place ; « Pause » fige tout (rythme, repos, finisher) jusqu'à la reprise.
// Le mode automatique (réglé par personne, bouton Auto) enchaîne seul : chaque série démarre après la
// mise en place, se note à la fin, le repos défile, la suivante démarre.
import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react";
import { beep, Button, Check, Field, formatClock, Sheet, Stepper, Textarea } from "@/components/ui";
import { de, Verdict } from "../carnet";
import { guideMotion, motionOf } from "@/lib/training/figures";
import { AUTO_NEXT_MS, clockOf, entriesOf, guideAt, OPTS_BOUNDS, optsOf, suggestedReps, SWITCH_SEC, type Live, type LiveAction } from "@/lib/training/live";
import { cycleDuration, sample } from "@/lib/training/motion";
import { heightAt } from "@/lib/training/rhythm";
import { lastFor, levelFor, ready, type Exercise, type LiveStep, type Program, type Workout } from "@/lib/training/program";
import { frameAt, KbFigure, LoopingFigure, useMotionClock } from "./KbFigure";
import { MuscleMap } from "./MuscleMap";
import { RhythmGuide } from "./RhythmGuide";
import { useLiveSync, type LiveRowClient } from "./useLiveSync";

export type LiveView = "ecran" | "telecommande";

/** Séance à deux : chaque séance tient dans une moitié de l’écran, sans raccourcis clavier (on ne saurait pas à qui ils s’adressent). */
const PaneCtx = createContext(false);
type ExStep = Extract<LiveStep, { k: "ex" }>;
type Sound = (f: number, d: number) => void;
type Dispatch = (a: LiveAction) => void;

/** Bips : sur l’écran par défaut, coupés sur la télécommande (un seul appareil qui sonne, pas d’écho). */
function useSound(view: LiveView) {
  const key = `mijote.kb.sound.${view}`;
  const [on, setOn] = useState(view === "ecran");
  useEffect(() => {
    try {
      const v = localStorage.getItem(key);
      if (v) setOn(v === "on");
    } catch {}
  }, [key]);
  const toggle = () =>
    setOn((v) => {
      try {
        localStorage.setItem(key, v ? "off" : "on");
      } catch {}
      return !v;
    });
  return { on, toggle, beep: (f: number, d: number) => on && beep(f, d) };
}

/** Raccourcis clavier de l’écran affiché (Space, KeyG, ArrowLeft…), ignorés dans un champ. */
function useKeys(map: Partial<Record<string, () => void>>) {
  const ref = useRef(map);
  ref.current = map;
  const pane = useContext(PaneCtx);
  useEffect(() => {
    if (pane) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const fn = ref.current[e.code];
      if (!fn) return;
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      fn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pane]);
}

/** Lance un geste automatique (fin du repos, fin du rythme) une seule fois par écran quand `due` devient vrai. */
function useOnce(due: boolean, fn: () => void) {
  const done = useRef(false);
  const f = useRef(fn);
  f.current = fn;
  useEffect(() => {
    if (due && !done.current) {
      done.current = true;
      f.current();
    }
  }, [due]);
}

export function LiveSession({ program: p, initial, workouts, view, onEnd, pane }: { program: Program; initial: LiveRowClient; workouts: Workout[]; view: LiveView; onEnd: () => void; pane?: { name: string } }) {
  const sync = useLiveSync(p, initial, workouts);
  const { live, dispatch, now } = sync;
  const [details, setDetails] = useState<string | null>(null);
  const [phone, setPhone] = useState(false);
  const [rhythm, setRhythm] = useState(false);
  const sound = useSound(view);
  const remote = view === "telecommande";

  // Séance terminée sur un autre écran (enregistrée ou arrêtée) : on sort.
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => {
    if (sync.ended) endRef.current();
  }, [sync.ended]);

  // L’écran reste allumé pendant la séance (si le navigateur le permet).
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => (lock = l), () => {});
    return () => void lock?.release().catch(() => {});
  }, []);

  const step = live.steps[live.i];
  const at = live.i;
  const levelOf = (ex: string) => live.levels[ex] ?? levelFor(workouts, ex);
  const abandon = async () => {
    await fetch(`/api/sante/seance/${initial.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ abandon: true }) }).catch(() => null);
    onEnd();
  };
  const opts = optsOf(live);
  const paused = live.cur.paused != null;
  const toggleAuto = () => dispatch({ k: "opts", opts: { auto: !opts.auto } });
  useKeys({ ArrowLeft: () => dispatch({ k: "go", at, n: -1 }), KeyA: toggleAuto, KeyP: () => dispatch({ k: paused ? "resume" : "pause", at }) });

  const detailEx = details ? p.exercises[details] : null;
  const common = { p, live, workouts, dispatch, now, offset: sync.offset, sound: sound.beep, remote };

  return (
    <PaneCtx.Provider value={!!pane}>
    <div className={pane ? "h-full min-w-0 overflow-y-auto bg-bg text-ink" : "kitchen-dark fixed inset-0 z-30 overflow-y-auto bg-bg text-ink"}>
      <div className="mx-auto grid min-h-full max-w-[1440px] grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr] gap-4 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)] md:gap-6 md:px-8 md:pt-6">
        <header className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-body md:text-[19px]">
              {pane && <span className="text-accent">{pane.name} · </span>}
              {p.sessions[live.type]?.name ?? live.type}
              {remote && <span className="font-normal text-ink-2"> · télécommande</span>}
            </b>
            <Elapsed t0={live.t0} now={now} />
            {!sync.online && <Verdict tone="warn">hors ligne</Verdict>}
            <div className="ml-auto flex items-center gap-1">
              {!remote && (
                <Button size="sm" variant="quiet" icon="qr" onClick={() => setPhone(true)}>
                  Téléphone
                </Button>
              )}
              <Button size="sm" variant={opts.auto ? "primary" : "quiet"} icon="auto" onClick={toggleAuto} aria-pressed={opts.auto} title="Enchaîner seul : chaque série démarre après la mise en place (A)">
                Auto
              </Button>
              <Button size="sm" variant="quiet" icon="sliders" iconOnly onClick={() => setRhythm(true)} aria-label="Réglages du rythme guidé" />
              <Button size="sm" variant="quiet" icon="bell" onClick={sound.toggle} aria-pressed={sound.on}>
                {sound.on ? "Bips" : "Muet"}
              </Button>
              <QuitButton onQuit={abandon} />
            </div>
          </div>
          <SessionMap steps={live.steps} i={live.i} />
        </header>

        <main className="@container grid min-h-0 grid-cols-[minmax(0,1fr)] content-center">
          {step.k === "warm" && <Warmup items={p.warmup} remote={remote} onNext={() => dispatch({ k: "go", at, n: 1 })} />}
          {step.k === "ex" && <SetScreen key={at} {...common} step={step} level={levelOf(step.ex)} onDetails={() => setDetails(step.ex)} />}
          {step.k === "rest" && <Rest key={at} {...common} levelOf={levelOf} onDetails={setDetails} />}
          {step.k === "emom" && <Emom key={at} {...common} step={step} />}
          {step.k === "bonus" && <BonusOffer label={p.bonus?.label} items={(p.bonus?.items ?? []).map((x) => p.exercises[x].short)} onSkip={() => dispatch({ k: "go", at, n: 1 })} onAdd={() => dispatch({ k: "bonus", at })} />}
          {step.k === "end" && <EndScreen p={p} live={live} id={initial.id} now={now} onSaved={onEnd} onBack={() => dispatch({ k: "go", at, n: -1 })} />}
        </main>
      </div>

      <Sheet open={!!detailEx} onClose={() => setDetails(null)} title={detailEx?.name ?? ""} width={520}>
        {details && detailEx && <ExerciseDetails ex={detailEx} id={details} level={levelOf(details)} onLevel={(l) => dispatch({ k: "level", ex: details, level: l })} />}
      </Sheet>
      <Sheet open={rhythm} onClose={() => setRhythm(false)} title={pane ? `Le rythme ${de(pane.name)}` : "Rythme guidé"} width={420}>
        {rhythm && <RhythmSettings opts={opts} onChange={(o) => dispatch({ k: "opts", opts: o })} />}
      </Sheet>
      <Sheet open={phone} onClose={() => setPhone(false)} title={pane ? `Le téléphone ${de(pane.name)}` : "Piloter depuis le téléphone"} width={420}>
        {phone && <PhoneQr id={initial.id} />}
      </Sheet>
    </div>
    </PaneCtx.Provider>
  );
}

/** Réglages du rythme guidé de la personne : gardés pour ses prochaines séances. */
function RhythmSettings({ opts, onChange }: { opts: ReturnType<typeof optsOf>; onChange: (o: Partial<ReturnType<typeof optsOf>>) => void }) {
  return (
    <div className="grid gap-5">
      <Check checked={opts.auto} onChange={(e) => onChange({ auto: e.target.checked })} strike={false}>
        <span className="grid">
          <b>Enchaîner automatiquement</b>
          <span className="text-small text-ink-2">Chaque série démarre seule après la mise en place et se note à la fin ; le repos défile, la suivante démarre. Pause et reprise à tout moment.</span>
        </span>
      </Check>
      <div className="grid gap-2">
        <span className="label text-ink-2">Mise en place avant une série</span>
        <Stepper value={opts.lead} onChange={(n) => onChange({ lead: n })} min={OPTS_BOUNDS.lead[0]} max={OPTS_BOUNDS.lead[1]} unit="s" />
      </div>
      <div className="grid gap-2">
        <span className="label text-ink-2">Pour passer d’un exercice à l’autre</span>
        <Stepper value={opts.change} onChange={(n) => onChange({ change: n })} min={OPTS_BOUNDS.change[0]} max={OPTS_BOUNDS.change[1]} step={5} unit="s" />
        <span className="text-small text-ink-2">Dans un superset, sans repos entre les deux : le temps de changer de matériel ou de position.</span>
      </div>
      <p className="text-small text-ink-2">Gardés pour tes prochaines séances. Clavier : A pour l’automatique, P pour la pause.</p>
    </div>
  );
}

function PhoneQr({ id }: { id: string }) {
  const [qr, setQr] = useState<{ url: string; svg: string } | null>(null);
  useEffect(() => {
    fetch(`/api/sante/seance/${id}/qr`)
      .then((r) => r.json())
      .then(setQr, () => {});
  }, [id]);
  return (
    <div className="grid justify-items-center gap-4 text-center">
      <p className="text-ink-2">Scanne avec l’appareil photo du téléphone : il devient une télécommande (séries, rythme guidé, repos, corrections). Chacun peut scanner avec le sien.</p>
      {qr ? <span className="block w-[220px] rounded-[8px] bg-white p-2 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr.svg }} /> : <span className="h-[220px]" />}
      {qr && (
        <a href={qr.url} className="text-small text-ink-2 underline underline-offset-4 hover:text-ink">
          Ouvrir la télécommande ici
        </a>
      )}
    </div>
  );
}

function Elapsed({ t0, now }: { t0: number; now: () => number }) {
  const [t, setT] = useState(() => now());
  useEffect(() => {
    const id = setInterval(() => setT(now()), 1000);
    return () => clearInterval(id);
  }, [now]);
  return <span className="num-tight text-body text-ink-2">{formatClock(Math.max(0, (t - t0) / 1000))}</span>;
}

// ---------- Carte de la séance ----------

/** Blocs de la séance (dans l’ordre), avec leurs séries faites et le tour en cours. */
export function sessionMap(steps: LiveStep[], i: number) {
  const blocks: { label: string; total: number; done: number; set: number; sets: number; current: boolean }[] = [];
  steps.forEach((s, j) => {
    if (s.k !== "ex" && s.k !== "emom") return;
    let b = blocks.find((x) => x.label === s.block);
    if (!b) blocks.push((b = { label: s.block, total: 0, done: 0, set: 1, sets: s.k === "ex" ? s.sets : s.rounds, current: false }));
    b.total++;
    if (j < i) b.done++;
    if (j <= i && s.k === "ex") b.set = s.set;
  });
  const cur = steps.slice(i).find((s) => s.k === "ex" || s.k === "emom");
  for (const b of blocks) b.current = !!cur && "block" in cur && cur.block === b.label;
  return blocks;
}

function SessionMap({ steps, i }: { steps: LiveStep[]; i: number }) {
  const blocks = sessionMap(steps, i);
  return (
    <ol className="flex gap-2" aria-label="Avancement de la séance">
      {blocks.map((b) => (
        <li key={b.label} className="grid min-w-0 gap-2" style={{ flex: `${b.total} 1 0` }}>
          <span className={`h-1 overflow-hidden ${b.current ? "bg-line-strong" : "bg-line"}`} aria-hidden>
            <span className={`block h-full transition-[width] duration-[var(--dur-3)] ease-[var(--ease-out)] ${b.current ? "bg-accent" : "bg-ink-2"}`} style={{ width: `${Math.round((b.done / b.total) * 100)}%` }} />
          </span>
          <span className={`label truncate ${b.current ? "text-ink" : "text-ink-3"}`}>
            {b.label}
            {b.current && b.sets > 1 && !b.label.toLowerCase().includes("swing") ? ` · tour ${b.set}/${b.sets}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

function nextWork(steps: LiveStep[], from: number): ExStep | Extract<LiveStep, { k: "emom" }> | null {
  for (let j = from; j < steps.length; j++) {
    const s = steps[j];
    if (s.k === "ex" || s.k === "emom") return s;
  }
  return null;
}

/** Séries faites depuis le dernier repos (le superset qui vient de finir), à corriger pendant le repos. */
function doneSinceRest(steps: LiveStep[], i: number): ExStep[] {
  const out: ExStep[] = [];
  for (let j = i - 1; j >= 0; j--) {
    const s = steps[j];
    if (s.k === "ex") out.unshift(s);
    else if (s.k !== "emom") break;
  }
  return out;
}

function QuitButton({ onQuit }: { onQuit: () => void }) {
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const id = setTimeout(() => setSure(false), 4000);
    return () => clearTimeout(id);
  }, [sure]);
  return (
    <Button size="sm" variant={sure ? "danger" : "quiet"} onClick={() => (sure ? onQuit() : setSure(true))}>
      {sure ? "Sûr ? Arrêter" : "Arrêter"}
    </Button>
  );
}

const Eyebrow = ({ children }: { children: React.ReactNode }) => <span className="label text-ink-2 @2xl:text-[16px]">{children}</span>;
function KeyHint({ children }: { children: React.ReactNode }) {
  return useContext(PaneCtx) ? null : <span className="label hidden text-ink-3 @2xl:inline">{children}</span>;
}
// Le chiffre héros : Archivo serrée et très grasse, lisible à deux mètres.
const HERO = "num-tight font-[800] leading-[0.8] tracking-[-0.03em]";

function Warmup({ items, remote, onNext }: { items: string[]; remote: boolean; onNext: () => void }) {
  useKeys({ Space: onNext });
  return (
    <section className="mx-auto grid w-full max-w-[720px] gap-4">
      <Eyebrow>Échauffement · 4 minutes</Eyebrow>
      <h2 className="text-[38px] leading-[0.96] @2xl:text-[64px]">On chauffe les articulations</h2>
      {!remote && (
        <div className="grid gap-3 text-lead @2xl:text-[24px]">
          {items.map((w) => (
            <Check key={w}>{w}</Check>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button variant="primary" size="kitchen" onClick={onNext}>
          C’est parti
        </Button>
        <KeyHint>Espace</KeyHint>
      </div>
    </section>
  );
}

// ---------- Une série ----------

interface Common {
  p: Program;
  live: Live;
  workouts: Workout[];
  dispatch: Dispatch;
  now: () => number;
  offset: number;
  sound: Sound;
  remote: boolean;
}

function SetScreen({ p, live, workouts, dispatch, offset, sound, remote, step, level, onDetails }: Common & { step: ExStep; level: number; onDetails: () => void }) {
  const at = live.i;
  const ex = p.exercises[step.ex];
  const motion = guideMotion(p, step.ex);
  const last = lastFor(workouts, step.ex);
  const seconds = ex.unit === "s";
  const reps = live.cur.reps ?? suggestedReps(live, workouts, step.ex, step.set, ex.reps[0]);
  const since = live.cur.guide;
  const pausedAt = live.cur.paused;
  const paused = pausedAt != null;

  // Une seule horloge : celle du guidage (heure du serveur ramenée à celle de cet écran, figée en pause), sinon une boucle de démonstration.
  const demo = useMotionClock(since == null && !paused);
  const ticking = useMotionClock(since != null && !paused, since != null ? since - offset : undefined);
  const elapsed = since != null && pausedAt != null ? (pausedAt - since) / 1000 : ticking;
  const dur = seconds ? reps : reps * cycleDuration(motion);
  const g = since != null ? guideAt(elapsed, dur, ex.uni) : null;
  const t = g ? (g.phase === "run" ? g.t : 0) : demo;
  const frame = sample(motion, t);
  const count = g?.phase === "run" ? (seconds ? Math.floor(g.t) : frame.rep) : g?.phase === "done" ? reps : 0;
  const switchLeft = g?.phase === "switch" ? Math.max(0, SWITCH_SEC - g.t) : 0;
  const readyLeft = g?.phase === "ready" ? Math.ceil(-g.t) : 0;
  const changing = g?.phase === "ready" && live.steps[at - 1]?.k === "ex" && (live.steps[at - 1] as ExStep).ex !== step.ex;

  // Bips : le décompte de mise en place (3, 2, 1), une note à chaque changement de phase, plus aiguë au début de chaque répétition ; changement de côté et fin.
  const lastKey = useRef("");
  useEffect(() => {
    if (!g || paused) return;
    const key = g.phase === "ready" ? `ready-${readyLeft}` : g.phase !== "run" ? g.phase : seconds ? `s${g.side}-${Math.ceil(reps - g.t)}` : `r${g.side}-${frame.rep}-${frame.step}`;
    if (key === lastKey.current) return;
    const first = lastKey.current === "";
    lastKey.current = key;
    if (first && elapsed > 1) return; // écran qui arrive en cours de route : pas de rafale
    if (g.phase === "ready") {
      if (readyLeft <= 3) sound(660, 0.1);
    } else if (g.phase === "switch" || g.phase === "done") sound(990, 0.4);
    else if (!seconds && frame.rep < reps) sound(frame.step === 0 ? 990 : 660, frame.step === 0 ? 0.14 : 0.08);
    else if (seconds && Math.ceil(reps - g.t) <= 3) sound(660, 0.08);
  });

  // Rythme guidé terminé : la série est notée toute seule (correction possible pendant le repos).
  useOnce(!paused && g?.phase === "done" && elapsed >= (ex.uni ? 2 * dur + SWITCH_SEC : dur) + AUTO_NEXT_MS / 1000, () => dispatch({ k: "record", at, ex: step.ex, set: step.set, value: reps, level }));

  const running = g != null && g.phase !== "done";
  const partial = g?.phase === "run" && g.side === 1 && count > 0 ? count : reps;
  const startGuide = () => dispatch({ k: "guide", at, on: true, reps });
  const stopGuide = () => dispatch({ k: "guide", at, on: false, reps: partial });
  const finish = () => dispatch({ k: "record", at, ex: step.ex, set: step.set, value: partial, level });
  const pause = () => dispatch({ k: "pause", at });
  const resume = () => dispatch({ k: "resume", at });
  const goNow = () => dispatch({ k: "lead+", at, sec: -3600 });
  const more = () => dispatch({ k: "lead+", at, sec: 5 });
  useKeys({ Space: paused ? resume : g?.phase === "ready" ? goNow : finish, KeyG: () => (running ? stopGuide() : startGuide()), KeyD: onDetails, Equal: more, NumpadAdd: more });

  // Le chiffre héros : le décompte de mise en place, la répétition en cours, les secondes restantes, ou l’objectif avant de commencer.
  const hero = g?.phase === "ready" ? String(readyLeft) : g?.phase === "switch" ? String(Math.ceil(switchLeft)) : g?.phase === "done" ? "✓" : g ? (seconds ? String(Math.max(0, Math.ceil(reps - g.t))) : String(Math.min(reps, count + 1))) : String(reps);
  const target = `${reps} ${seconds ? "secondes" : "répétitions"}${ex.uni ? " par côté" : ""}`;
  const heroSub = g?.phase === "ready" ? target : g?.phase === "switch" ? "Change de côté" : g?.phase === "done" ? "Série terminée" : g ? (seconds ? `secondes${ex.uni ? ` · côté ${g.side}` : ""}` : `sur ${reps}${ex.uni ? ` · côté ${g.side}` : ""}`) : target;
  const phase = paused ? "En pause" : g?.phase === "ready" ? (changing ? "Change d’exercice" : "En place") : g?.phase === "switch" ? "Autre côté" : g?.phase === "done" ? "Bien" : frame.label;
  const phaseTone = paused ? "text-ink-2" : g?.phase === "switch" || g?.phase === "ready" ? "text-hot" : g?.phase === "run" ? "text-accent" : "text-ink-2";
  // Effort de l'instant (0 en haut, 1 dans la position la plus dure) : les muscles s'allument au rythme du geste.
  const effort = g?.phase === "run" ? 1 - heightAt(motion, g.t, seconds ? null : dur) : g ? 0 : 1 - heightAt(motion, demo);

  return (
    <section className={`grid grid-cols-[minmax(0,1fr)] items-center gap-4 @2xl:gap-10 ${remote ? "mx-auto w-full max-w-[640px]" : "@2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"}`}>
      {/* La figure ; à côté (colonne du duo) ou dessous (grand écran seul), les muscles qui travaillent. */}
      <div className={`grid items-center gap-x-6 gap-y-3 ${remote ? "" : "@xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @2xl:grid-cols-[minmax(0,1fr)]"}`}>
        <div className={`grid gap-2 transition-opacity duration-[var(--dur-2)] ${paused ? "opacity-50" : ""}`}>
          <KbFigure ex={step.ex} t={t} label={`${ex.name} : ${phase}`} className={`mx-auto w-auto max-w-full ${remote ? "max-h-[24vh]" : "max-h-[28vh] @2xl:max-h-[46vh]"}`} />
          {!remote && <p className="label text-center text-ink-2 @2xl:text-[15px]">Tempo {ex.tempo}</p>}
        </div>
        {!remote && <MuscleMap ex={step.ex} exercise={ex} effort={effort} active={g?.phase === "run" && !paused} className="mx-auto hidden w-full max-w-[440px] @xl:grid" />}
      </div>

      <div className="grid content-center gap-3 @2xl:gap-4">
        <Eyebrow>
          {step.block} · tour {step.set}/{step.sets}
          {optsOf(live).auto && " · auto"}
        </Eyebrow>
        <h2 className="text-[30px] leading-[0.96] @2xl:text-[clamp(36px,4cqw,56px)]">{ex.name}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body text-ink-2 @2xl:text-[19px]">{ex.ladder[level] ?? ex.ladder[0]}</span>
          {ready(p, workouts, step.ex) && <Verdict tone="ok">prêt à monter d’un cran</Verdict>}
        </div>

        <div className="flex items-end gap-6" aria-live="polite">
          <span className={`${HERO} text-[clamp(112px,min(26vh,34cqw),300px)] ${g?.phase === "switch" || g?.phase === "ready" ? "text-hot" : ""} ${paused ? "text-ink-2" : ""}`}>{hero}</span>
          <span className="grid gap-2 pb-3">
            <span className={`font-display text-[26px] font-extrabold leading-none tracking-[-0.02em] [font-stretch:115%] @2xl:text-[40px] ${phaseTone}`}>{phase}</span>
            <span className="text-body text-ink-2 @2xl:text-[21px]">{heroSub}</span>
          </span>
        </div>

        {/* La bille qui suit le tempo : on voit venir chaque phase, au même instant que la figure et les bips. */}
        {!seconds && <RhythmGuide motion={motion} t={g?.phase === "ready" ? g.t : t} end={g ? dur : null} active={g?.phase === "run" && !paused} className="max-w-[560px]" />}

        {!remote && <p className="max-w-[40ch] text-lead @2xl:text-[24px]">{ex.cues[0]}</p>}

        {!g && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="label text-ink-2">Objectif</span>
            <Stepper value={reps} onChange={(n) => dispatch({ k: "reps", at, reps: n })} min={1} max={200} />
            {last && (
              <span className="text-small text-ink-2">
                La dernière fois : <span className="num">{last.sets.join(" · ")}</span>
              </span>
            )}
          </div>
        )}

        <div className="sticky bottom-0 z-10 -mx-4 grid grid-cols-2 gap-2 border-t border-line bg-bg px-4 py-3 @2xl:static @2xl:border-0 @2xl:m-0 @2xl:flex @2xl:flex-wrap @2xl:items-center @2xl:bg-transparent @2xl:p-0">
          {paused ? (
            <>
              <Button variant="primary" size="kitchen" icon="play" onClick={resume}>
                Reprendre
              </Button>
              <Button size="kitchen" onClick={finish}>
                Série faite
              </Button>
            </>
          ) : g?.phase === "ready" ? (
            <>
              <Button variant="primary" size="kitchen" icon="play" onClick={goNow}>
                Go
              </Button>
              <Button size="kitchen" icon="plus" onClick={more}>
                5 s
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" size="kitchen" onClick={finish}>
                Série faite
              </Button>
              {running ? (
                <Button size="kitchen" icon="pause" onClick={pause}>
                  Pause
                </Button>
              ) : (
                <Button size="kitchen" icon="play" onClick={startGuide}>
                  {g ? "Relancer" : "Rythme guidé"}
                </Button>
              )}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {g?.phase === "ready" && !paused && (
            <Button size="sm" variant="quiet" icon="pause" onClick={pause}>
              Pause
            </Button>
          )}
          {running && (
            <Button size="sm" variant="quiet" onClick={stopGuide}>
              Arrêter le rythme
            </Button>
          )}
          <Button size="sm" variant="quiet" onClick={onDetails}>
            Consignes et variante
          </Button>
          <Button size="sm" variant="quiet" onClick={() => dispatch({ k: "go", at, n: -1 })}>
            Retour
          </Button>
          <KeyHint>{paused ? "Espace : reprendre" : g?.phase === "ready" ? "Espace : go · + : 5 s de plus · P : pause" : "Espace : série faite · G : rythme · P : pause · D : consignes · ← : retour"}</KeyHint>
        </div>
      </div>
    </section>
  );
}

function ExerciseDetails({ ex, id, level, onLevel }: { ex: Exercise; id: string; level: number; onLevel: (l: number) => void }) {
  const g = ex.guide;
  const steps: [string, string | undefined][] = [
    ["Position", g?.position],
    ["Mouvement", g?.movement],
    ["Où ça doit travailler", g?.feel],
    ["Respiration", g?.breathing],
    ["Si ça gêne", g?.easier],
  ];
  return (
    <div className="grid gap-4">
      <LoopingFigure ex={id} className="mx-auto w-full max-w-[280px]" />
      <MuscleMap ex={id} exercise={ex} />
      <p className="text-small text-ink-2">Tempo {ex.tempo}</p>
      <Field label="Variante">
        {(fid) => (
          <select id={fid} value={level} onChange={(e) => onLevel(Number(e.target.value))} className="min-h-12 w-full rounded-[8px] border border-line-strong bg-surface px-4 text-[17px]">
            {ex.ladder.map((v, i) => (
              <option key={v} value={i}>
                {i + 1}. {v}
              </option>
            ))}
          </select>
        )}
      </Field>
      {steps.some(([, v]) => v) && (
        <dl className="grid gap-4">
          {steps.map(([k, v]) =>
            v ? (
              <div key={k}>
                <dt className="label text-ink-2">{k}</dt>
                <dd className="mt-1">{v}</dd>
              </div>
            ) : null,
          )}
        </dl>
      )}
      <List title="Comment faire" items={ex.cues} />
      <List title="Erreurs fréquentes" items={ex.errors} />
      <p className="text-small text-ink-2">Il doit te rester 1 ou 2 répétitions en réserve à la fin de la série, pas plus.</p>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
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

// ---------- Repos ----------

function Rest({ p, live, workouts, dispatch, now, sound, remote, levelOf, onDetails }: Common & { levelOf: (ex: string) => number; onDetails: (ex: string) => void }) {
  const at = live.i;
  const step = live.steps[at];
  const sec = step.k === "rest" ? step.sec : 60;
  const [fallback] = useState(() => now() + sec * 1000);
  const end = live.cur.restEnd ?? fallback;
  const paused = live.cur.paused != null;
  useMotionClock(!paused); // un rendu par image, figé en pause
  const left = Math.max(0, (end - clockOf(live, now())) / 1000);
  const shown = Math.ceil(left);
  const lastSec = useRef(shown);
  useEffect(() => {
    if (shown === lastSec.current) return;
    lastSec.current = shown;
    if (shown > 0 && shown <= 3) sound(660, 0.1);
    if (shown === 0) sound(990, 0.4);
  }, [shown, sound]);
  useOnce(left <= 0 && !paused, () => dispatch({ k: "go", at, n: 1 }));
  const skip = () => dispatch({ k: "go", at, n: 1 });
  const plus = () => dispatch({ k: "rest+", at, sec: 15 });
  const pause = () => dispatch({ k: paused ? "resume" : "pause", at });
  useKeys({ Space: paused ? pause : skip, Equal: plus, NumpadAdd: plus });

  const justDone = doneSinceRest(live.steps, at);
  const next = nextWork(live.steps, at + 1);
  const nx = next ? p.exercises[next.ex] : null;
  const nLast = next ? lastFor(workouts, next.ex) : null;
  return (
    <section className={`grid grid-cols-[minmax(0,1fr)] items-center gap-6 @2xl:gap-10 ${remote ? "mx-auto w-full max-w-[640px]" : "@2xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"}`}>
      <div className="grid min-w-0 content-center gap-4">
        <Eyebrow>{paused ? "Repos · en pause" : "Repos"}</Eyebrow>
        <span className={`${paused ? "text-ink-2" : ""} ${HERO} text-[clamp(96px,min(28vh,26cqw),280px)] @2xl:text-[clamp(96px,min(28vh,19cqw),280px)]`} role="timer" aria-live="off">
          {formatClock(left)}
        </span>
        <span className="h-1 overflow-hidden bg-line" aria-hidden>
          <span className="block h-full bg-ink" style={{ width: `${Math.min(100, Math.round((left / Math.max(sec, left)) * 100))}%` }} />
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="kitchen" onClick={skip}>
            Passer
          </Button>
          <Button size="kitchen" onClick={plus}>
            +15 s
          </Button>
          <Button size="kitchen" variant={paused ? "secondary" : "quiet"} icon={paused ? "play" : "pause"} onClick={pause}>
            {paused ? "Reprendre" : "Pause"}
          </Button>
          <KeyHint>Espace : passer · + : 15 s de plus · P : pause</KeyHint>
        </div>

        {justDone.length > 0 && (
          <div className="grid gap-2 border-t border-line pt-4">
            <span className="label text-ink-2">À corriger si besoin</span>
            {justDone.map((s) => {
              const e = p.exercises[s.ex];
              const v = live.log[s.ex]?.[s.set - 1] ?? 0;
              return (
                <div key={`${s.ex}-${s.set}`} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <b>{e.short}</b> <span className="text-ink-2">· tour {s.set}</span>
                  </span>
                  <Stepper value={v} onChange={(n) => dispatch({ k: "correct", ex: s.ex, set: s.set, value: n })} min={0} max={200} unit={e.unit === "s" ? "s" : undefined} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {next && nx && (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 border-t-2 border-ink pt-4 @2xl:border-t-0 @2xl:border-l @2xl:border-line @2xl:pt-0 @2xl:pl-8">
          <Eyebrow>Ensuite</Eyebrow>
          <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <LoopingFigure ex={next.ex} className={`mx-auto w-full ${remote ? "max-w-[160px]" : "max-w-[220px] @2xl:max-w-[300px]"}`} />
            <div className="grid content-start gap-2">
              <h3 className="font-display text-[28px] leading-[0.96] tracking-[-0.03em] [font-stretch:125%] [font-weight:800] @2xl:text-[44px]">{nx.name}</h3>
              <span className="num text-body text-ink-2">
                {next.k === "ex" ? `tour ${next.set}/${next.sets} · ${nx.reps[0]}–${nx.reps[1]} ${nx.unit === "s" ? "s" : "reps"}${nx.uni ? " par côté" : ""}` : `${next.rounds} × ${next.reps} toutes les ${next.every} s`}
              </span>
              {!remote && <p className="text-body @2xl:text-[21px]">{nx.cues[0]}</p>}
              {nLast && (
                <span className="text-small text-ink-2">
                  La dernière fois : <span className="num">{nLast.sets.join(" · ")}</span>
                </span>
              )}
            </div>
          </div>
          {next.k === "ex" && (
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label={`Variante pour ${nx.short}`} value={levelOf(next.ex)} onChange={(e) => dispatch({ k: "level", ex: next.ex, level: Number(e.target.value) })} className="min-h-12 min-w-0 flex-1 rounded-[8px] border border-line-strong bg-surface px-4 text-[17px]">
                {nx.ladder.map((v, i) => (
                  <option key={v} value={i}>
                    {i + 1}. {v}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="quiet" onClick={() => onDetails(next.ex)}>
                Consignes
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------- Swings au bip ----------

function Emom({ p, live, dispatch, offset, sound, remote, step }: Common & { step: Extract<LiveStep, { k: "emom" }> }) {
  const at = live.i;
  const ex = p.exercises[step.ex];
  const since = live.cur.emom;
  const pausedAt = live.cur.paused;
  const paused = pausedAt != null;
  const ticking = useMotionClock(since != null && !paused, since != null ? since - offset : undefined);
  const demo = useMotionClock(since == null);
  const cycle = motionOf(p, step.ex) ? cycleDuration(motionOf(p, step.ex)!) : 1;
  const elapsed = since == null ? 0 : pausedAt != null ? (pausedAt - since) / 1000 : ticking;
  const readying = since != null && elapsed < 0; // mise en place avant le premier bip
  const clock = Math.max(0, elapsed);
  const round = Math.min(step.rounds, Math.floor(clock / step.every) + 1);
  const inRound = clock - (round - 1) * step.every;
  const started = since != null && !readying;
  const working = started && inRound < step.reps * cycle;
  const swings = !started ? 0 : Math.min(step.reps, Math.floor(inRound / cycle));
  const finished = started && clock >= step.rounds * step.every;

  // Un bip à chaque tour, et le décompte de mise en place (pas de rafale pour un écran qui arrive en cours de tour).
  const lastRound = useRef(0);
  const lastLead = useRef(0);
  const leadLeft = readying ? Math.ceil(-elapsed) : 0;
  useEffect(() => {
    if (paused || !readying || leadLeft === lastLead.current) return;
    lastLead.current = leadLeft;
    if (leadLeft <= 3) sound(660, 0.1);
  }, [paused, readying, leadLeft, sound]);
  useEffect(() => {
    if (!started || paused || finished || round === lastRound.current) return;
    const late = lastRound.current === 0 && inRound > 1;
    lastRound.current = round;
    if (!late) sound(990, 0.25);
  }, [started, paused, round, finished, inRound, sound]);
  useOnce(finished && !paused, () => {
    sound(990, 0.5);
    dispatch({ k: "record", at, ex: step.ex, set: 1, value: step.rounds * step.reps });
  });

  const begin = () => dispatch({ k: "emom", at });
  const stop = () => dispatch({ k: "record", at, ex: step.ex, set: 1, value: (started ? round : 0) * step.reps });
  const pause = () => dispatch({ k: paused ? "resume" : "pause", at });
  useKeys({ Space: since == null ? begin : paused ? pause : readying ? () => dispatch({ k: "lead+", at, sec: -3600 }) : undefined }); // pas d’arrêt au clavier : un appui de trop couperait le finisher

  const f = working ? frameAt(motionOf(p, step.ex), inRound) : null;
  const hero = since == null ? String(step.rounds) : readying ? String(leadLeft) : working ? String(Math.min(step.reps, swings + 1)) : String(Math.ceil(step.every - inRound));
  const sub = since == null ? `tours de ${step.reps} swings` : readying ? `${step.rounds} tours de ${step.reps}` : working ? `sur ${step.reps} · tour ${round}/${step.rounds}` : `s avant le bip · tour ${Math.min(step.rounds, round + 1)}/${step.rounds}`;
  const word = paused ? "En pause" : since == null ? "Prêt\u00a0?" : readying ? "En place" : working ? (f?.label ?? "Swing") : "Récupère";
  return (
    <section className={`grid grid-cols-[minmax(0,1fr)] items-center gap-4 @2xl:gap-10 ${remote ? "mx-auto w-full max-w-[640px]" : "@2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"}`}>
      <KbFigure ex={step.ex} t={since == null ? demo : working ? inRound : 0} className={`mx-auto w-auto max-w-full ${remote ? "max-h-[24vh]" : "max-h-[28vh] @2xl:max-h-[64vh]"} ${paused ? "opacity-50" : ""}`} />
      <div className="grid content-center gap-3 @2xl:gap-4">
        <Eyebrow>{step.block}</Eyebrow>
        <h2 className="text-[30px] leading-[0.96] @2xl:text-[clamp(36px,4cqw,56px)]">
          {step.reps} swings toutes les {step.every}{"\u00a0"}s
        </h2>
        <div className="flex items-end gap-6" aria-live="polite">
          <span className={`${HERO} text-[clamp(112px,min(26vh,34cqw),300px)] ${readying ? "text-hot" : started && !working ? "text-ink-2" : ""}`}>{hero}</span>
          <span className="grid gap-2 pb-3">
            <span className={`font-display text-[26px] font-extrabold leading-none tracking-[-0.02em] [font-stretch:115%] @2xl:text-[40px] ${readying ? "text-hot" : working && !paused ? "text-accent" : "text-ink-2"}`}>{word}</span>
            <span className="text-body text-ink-2 @2xl:text-[21px]">{sub}</span>
          </span>
        </div>
        {!remote && <p className="max-w-[40ch] text-lead @2xl:text-[24px]">{ex.cues[0]}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {since == null ? (
            <Button variant="primary" size="kitchen" icon="play" onClick={begin}>
              Démarrer
            </Button>
          ) : (
            <>
              <Button size="kitchen" variant={paused ? "primary" : "secondary"} icon={paused ? "play" : "pause"} onClick={pause}>
                {paused ? "Reprendre" : "Pause"}
              </Button>
              <Button size="kitchen" variant="quiet" onClick={stop}>
                Terminer le finisher
              </Button>
            </>
          )}
          {since == null && <KeyHint>Espace</KeyHint>}
        </div>
      </div>
    </section>
  );
}

// ---------- Gainage proposé ----------

function BonusOffer({ label, items, onSkip, onAdd }: { label?: string; items: string[]; onSkip: () => void; onAdd: () => void }) {
  useKeys({ Space: onSkip });
  return (
    <section className="mx-auto grid w-full max-w-[720px] gap-4">
      <Eyebrow>Facultatif · 3 minutes</Eyebrow>
      <h2 className="text-[38px] leading-[0.96] @2xl:text-[64px]">{label ?? "Un peu de gainage"}{"\u00a0"}?</h2>
      <p className="max-w-[48ch] text-lead text-ink-2 @2xl:text-[24px]">{items.join(" et ")}, 2 tours. Bon pour le ventre et le dos, mais la séance est déjà complète sans.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="kitchen" onClick={onSkip}>
          Terminer la séance
        </Button>
        <Button size="kitchen" onClick={onAdd}>
          Ajouter le gainage
        </Button>
        <KeyHint>Espace : terminer</KeyHint>
      </div>
    </section>
  );
}

// ---------- Fin ----------

function EndScreen({ p, live, id, now, onSaved, onBack }: { p: Program; live: Live; id: string; now: () => number; onSaved: () => void; onBack: () => void }) {
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const minutes = Math.round((now() - live.t0) / 60000);
  const entries = entriesOf(live);
  const save = () =>
    start(async () => {
      const r = await fetch(`/api/sante/seance/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ finish: { note } }) })
        .then((x) => x.json() as Promise<{ ok: boolean; message: string }>)
        .catch(() => ({ ok: false, message: "Réseau coupé : réessaie." }));
      if (r.ok) onSaved();
      else setError(r.message);
    });
  return (
    <section className="mx-auto grid w-full max-w-[720px] gap-4">
      <Eyebrow>
        {p.sessions[live.type]?.name ?? live.type} terminée · {minutes} min
      </Eyebrow>
      <h2 className="text-[52px] leading-[0.92] @2xl:text-[88px]">Bien joué</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left @2xl:text-[19px]">
          <thead>
            <tr className="label text-ink-2">
              <th className="py-2 pr-4 font-[inherit]">Exercice</th>
              <th className="py-2 pr-4 font-[inherit]">Séries</th>
              <th className="py-2 font-[inherit]">Variante</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.ex} className="border-t border-line">
                <td className="py-3 pr-4 font-bold">{p.exercises[e.ex]?.short ?? e.ex}</td>
                <td className="num py-3 pr-4">
                  {e.sets.join(" · ")}
                  {p.exercises[e.ex]?.unit === "s" ? " s" : ""}
                </td>
                <td className="py-3 text-small text-ink-2">{p.exercises[e.ex]?.ladder[e.level]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Field label="Une note\u00a0? Énergie, douleur, sensation">{(fid) => <Textarea id={fid} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.\u00a0: fente bulgare dure à gauche" />}</Field>
      {error && <p role="alert" className="text-small text-ko-ink">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="kitchen" state={pending ? "loading" : "idle"} loadingLabel="Enregistrement…" onClick={save}>
          Enregistrer dans le carnet
        </Button>
        <Button variant="quiet" onClick={onBack}>
          Retour
        </Button>
      </div>
    </section>
  );
}

export const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
