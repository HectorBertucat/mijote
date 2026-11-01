"use client";

// Centre de contrôle d'une session (docs/vision.md §4.4 bis), selon la DA « Plan de travail ».
// Une seule logique, deux vues : la vue simple par défaut, téléphone d’abord (trois temps, une
// consigne à la fois, Simple.tsx ; ?vue=telephone la garde plein écran à toutes les tailles) et la
// vue détaillée (?vue=detail : fil, minuteurs, foyers et four ; ordinateur et iPad).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { modeOf, type Person, type PlanStep, type SessionPlan } from "@/lib/session/planner";
import { LETTERS, type DuoNames } from "@/lib/session/people";
import {
  bowlsCompletedBy,
  currentPhase,
  focusStep,
  nextTodo,
  personFocus,
  phaseIds,
  phaseTimer,
  liveTimer,
  originalEnd,
  pausedTimers,
  randomId,
  runningTimers,
  storedEnd,
  stepStatus,
  stepTimer,
  type SessionEvent,
  type SessionState,
  type TimerState,
} from "@/lib/session/state";
import { fillBowls, mainAction, mainEvents, stopEvents, undoFor } from "@/lib/session/guide";
import { resumeSession } from "@/app/session/actions";
import { buttonClass, Icon } from "@/components/ui";
import { useNow, useSession } from "./useSession";
import { clock, DishArts, dur, kindLabel, QrCard, recipeOf, People, SessionHead, SessionTest, TimerAlert, ToastView, unlockAudio, useWakeLock, WakePill, type Phase } from "./parts";
import { DoneView, Issues, PlanDetails, progressLine, recipesLine, ResumeChoice, sessionTitle } from "./blocks";
import { PrepBowlRow, PrepPhase, Tomorrow } from "./Prep";
import { CookPhase } from "./Cook";
import { SimpleView } from "./Simple";
import type { RecipeStorage } from "@/lib/session/flow";
import { DuoView } from "./DuoView";

/** Prep la veille : durées du jour J selon qu’on le fait seul ou à deux (écran « au frigo »). */
export interface DayChoice {
  solo: { prepMin: number; cookingMin: number; totalMin: number };
  duo: { totalMin: number; aMin: number; bMin: number } | null;
}

export interface SessionProps {
  id: string;
  plan: SessionPlan;
  startedAt: string | null;
  initialStatus: SessionState["status"];
  initialEvents: SessionEvent[];
  /** simple : la vue par défaut ; phone : la même en plein écran ; full : la vue détaillée. */
  view: "simple" | "full" | "phone";
  phoneUrl: string;
  qrSvg: string | null;
  serverNow: number;
  /** À deux : un QR code par personne (?personne=A / ?personne=B). */
  personQrs?: { person: Person; url: string; svg: string }[];
  /** Vue téléphone filtrée sur une personne. */
  person?: Person | null;
  /** Prep la veille, bols au frigo : le jour J seul ou à deux. */
  dayChoice?: DayChoice | null;
  /** Session test (pour montrer l’appli) : étiquette dans l’en-tête, rien n’est compté. */
  test?: boolean;
  /** Le rangement : boîtes et conservation de chaque recette. */
  storage?: RecipeStorage[];
  /** La boîte de chaque plat (DishBox), rendue côté serveur, par slug. */
  dishes?: Record<string, React.ReactNode>;
  /** À deux : prénoms de A et B (deux premiers membres du foyer). */
  people?: DuoNames;
}

export type Controls = ReturnType<typeof useControls>;

function useControls(p: SessionProps) {
  const { plan } = p;
  const s = useSession({ id: p.id, plan, initialEvents: p.initialEvents, initialStatus: p.initialStatus, people: p.people });
  const { state, send } = s;
  const now = useNow(s.offset, p.serverNow);
  const mode = modeOf(plan);
  // Seul / veille : la cuisson commence après la prep (du jour même, après la reprise) ; à deux, tout part du démarrage.
  const base = state.resumedAt ?? (p.startedAt ? Date.parse(p.startedAt) : now);
  const cookingStart = mode === "duo" ? (state.cookingStartedAt ?? now) : (state.cookingStartedAt ?? base + plan.prep.minutes * 60000);
  const focus = focusStep(plan, state, now);
  const upcoming = nextTodo(plan, state, focus);
  // En pause, un minuteur est montré avec la fin qu’il aurait s’il repartait maintenant : son reste ne bouge pas, il ne sonne pas.
  const timers = [...state.timers.values()].filter((t) => t.doneAt == null).map((t) => liveTimer(t, now)).sort((a, b) => a.endsAt - b.endsAt);
  // Tout minuteur fini sonne : il a été lancé d’un geste, l’écran dit de quoi il s’agit et quoi faire (guide.ts, ringInfo).
  const ringing = timers.filter((t) => t.endsAt <= now);
  type Ev = Parameters<typeof send>[0][number];
  const opts = useCallback((person?: Person | null) => ({ sessionId: p.id, person: person ?? null, id: randomId }), [p.id]);

  /** Le bouton principal d’une étape : une seule chose, nommée (guide.ts, mainAction). `alt` : finir sans minuteur. */
  const act = useCallback(
    (st: PlanStep, person?: Person | null, alt = false) => {
      const out: Ev[] = [];
      if (mode === "duo" && state.status !== "cooking") out.push({ kind: "note", payload: { status: "cooking", ...(person ? { person } : {}) } });
      out.push(...mainEvents(plan, state, st, now, opts(person), alt));
      send(out);
    },
    [plan, state, now, send, opts, mode]
  );
  const next = useCallback(() => {
    if (focus) act(focus);
  }, [focus, act]);

  const auto = useCallback((t: TimerState) => s.events.some((e) => e.kind === "timer_start" && e.ref === t.id && e.payload?.auto === true), [s.events]);
  const stopTimer = useCallback((t: TimerState) => send(stopEvents(plan, state, t, now, { ...opts(), auto: auto(t) })), [plan, state, now, send, opts, auto]);
  /** Régler un minuteur (+1, glisser sur l’ordinateur) : nouvelle fin, lancement et durée d’origine gardés ; en pause, il y reste. */
  const setTimerEnd = useCallback(
    (t: TimerState, liveEnd: number) => {
      const endsAt = storedEnd(t, liveEnd, now);
      const minutes = Math.round(((endsAt - t.startedAt - t.pausedMs) / 60000) * 100) / 100;
      send([{ kind: "timer_start", ref: t.id, payload: { label: t.label, minutes, stepId: t.stepId, ...(t.phase != null ? { phase: t.phase } : {}), adjust: true, endsAt: new Date(endsAt).toISOString() } }]);
    },
    [now, send]
  );
  const addMinutes = useCallback((t: TimerState, min: number) => setTimerEnd(t, Math.max(now, t.endsAt) + min * 60000), [now, setTimerEnd]);
  const adjustTimer = useCallback((t: TimerState, deltaSec: number) => setTimerEnd(t, Math.max(now + 5000, t.endsAt + deltaSec * 1000)), [now, setTimerEnd]);
  /** ↺ : revenir à la durée d’origine (fin = lancement + durée de départ). */
  const resetTimer = useCallback((t: TimerState) => setTimerEnd(t, Math.max(now, originalEnd(t, now))), [now, setTimerEnd]);
  /** Pause et reprise d’un minuteur : la fin prévue est repoussée du temps passé en pause, sur tous les écrans. */
  const pauseTimer = useCallback((t: TimerState) => send([{ kind: t.pausedAt == null ? "timer_pause" : "timer_resume", ref: t.id }]), [send]);
  /** Tout mettre en pause (on doit s’absenter), ou tout reprendre. */
  const pauseAll = useCallback(() => {
    const running = runningTimers(state, now);
    if (running.length) send(running.map((t) => ({ kind: "timer_pause" as const, ref: t.id })));
    else send(pausedTimers(state).map((t) => ({ kind: "timer_resume" as const, ref: t.id })));
  }, [state, now, send]);
  const allPaused = runningTimers(state, now).length === 0 && pausedTimers(state).length > 0;
  /** Toucher une étape dans le fil : la commencer (sans minuteur), la finir, ou la remettre à faire. */
  const toggleStep = useCallback(
    (st: PlanStep) => {
      const status = stepStatus(state, st.id);
      if (status === "todo") send([{ kind: "step_start", ref: st.id }]);
      else if (status === "active") send(finishAll(st));
      else send([{ kind: "step_start", ref: st.id, payload: { undo: true } }]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [send, state, plan]
  );
  /** Finir une étape d’un coup (« Finie ») : sous-étapes restantes, minuteurs, l’étape. */
  const finishAll = (st: PlanStep): Ev[] => {
    const out: Ev[] = [];
    const n = currentPhase(state, st);
    if (n != null)
      for (let i = n; i < st.phases!.length; i++) {
        const t = phaseTimer(state, st.id, i);
        if (t) out.push({ kind: "timer_done", ref: t.id });
        out.push({ kind: "step_done", ref: `phase:${i}:${st.id}` });
      }
    const t = stepTimer(state, st.id);
    if (t) out.push({ kind: "timer_done", ref: t.id });
    return [...out, { kind: "step_done", ref: st.id }, ...fillBowls(plan, state, st)];
  };
  const toggleBowl = useCallback((letter: string) => send([{ kind: "bowl_ready", ref: letter, payload: { ready: !state.bowlsReady.has(letter) } }]), [send, state]);
  const togglePrep = useCallback(
    (taskId: string, person?: Person) => {
      const undo = state.prepDone.has(taskId);
      const out: Parameters<typeof send>[0] = [{ kind: "step_done", ref: `prep:${taskId}`, payload: undo ? { undo: true, person } : person ? { person } : null }];
      if (!undo) {
        // À deux : un bol est prêt quand tous ses gestes sont faits.
        const done = new Set(state.prepDone).add(taskId);
        for (const l of bowlsCompletedBy(plan, done)) if (!state.bowlsReady.has(l)) out.push({ kind: "bowl_ready", ref: l, payload: { ready: true, ...(person ? { person } : {}) } });
      }
      send(out);
    },
    [plan, send, state]
  );
  /** À deux : le bouton principal du fil d’une personne (geste de prep fait, ou l’action de son étape). Rien d’autre ne démarre. */
  const nextFor = useCallback(
    (person: Person) => {
      const f = personFocus(plan, state, person, now);
      if (!f) return;
      if (f.type === "step") return act(f.step, person);
      const out: Parameters<typeof send>[0] = [];
      if (state.status !== "cooking") out.push({ kind: "note", payload: { status: "cooking", person } });
      out.push({ kind: "step_done", ref: f.id, payload: { person } });
      const done = new Set(state.prepDone).add(f.task.id);
      for (const l of bowlsCompletedBy(plan, done)) if (!state.bowlsReady.has(l)) out.push({ kind: "bowl_ready", ref: l, payload: { ready: true, person } });
      send(out);
    },
    [plan, state, now, send, act]
  );
  const setStatus = useCallback((status: SessionState["status"]) => send([{ kind: "note", payload: { status } }]), [send]);
  const timerFor = useCallback(
    (st: PlanStep, minutes: number) => send([{ kind: "timer_start", ref: randomId(), payload: { label: `${st.kind === "preheat" ? "Four" : (st.equipmentName ?? kindLabel(st.kind))} · étape ${st.no}`, minutes, stepId: st.id, endsAt: new Date(now + minutes * 60000).toISOString() } }]),
    [send, now]
  );

  // Reprise d’une prep la veille : seul, le plan de la veille continue ; à deux, le serveur
  // refait le plan du jour J et chaque écran le recharge (note « replan »).
  const router = useRouter();
  const [resuming, startResume] = useTransition();
  const [resumingAs, setResumingAs] = useState<"solo" | "duo" | null>(null);
  const resume = useCallback(
    (dayMode: "solo" | "duo" = "solo") => {
      if (dayMode === "solo") {
        send([{ kind: "note", payload: { status: "prep", resume: true, dayMode: "solo" } }]);
        return;
      }
      setResumingAs("duo");
      const eventId = randomId();
      s.markLocal(eventId);
      startResume(async () => {
        const ok = await resumeSession(p.id, "duo", eventId).catch(() => false);
        if (!ok) s.setToast({ key: randomId(), text: "Reprise à deux impossible : la session n’est plus au frigo ?", remote: false, error: true });
        router.refresh();
      });
    },
    [send, p.id, router, s]
  );

  /** Lancer le minuteur de la sous-étape en cours (geste explicite : « Lance 8 min »). */
  const startPhase = useCallback(
    (st: PlanStep, person?: Person | null) => {
      const n = currentPhase(state, st);
      const ph = n != null ? st.phases![n] : null;
      if (!ph) return;
      send([{ kind: "timer_start", ref: phaseIds(p.id, st.id, n!).timer, payload: { label: ph.text, minutes: ph.min, stepId: st.id, phase: n, endsAt: new Date(now + ph.min * 60000).toISOString(), ...(person ? { person } : {}) } }]);
    },
    [state, send, p.id, now]
  );
  /** Le retour : défait la dernière action encore visible (à deux : celle de cette personne). */
  const undo = useCallback((person?: Person | null) => undoFor(plan, state, s.events, mode === "duo" ? (person ?? null) : null), [plan, state, s.events, mode]);
  const back = useCallback(
    (person?: Person | null) => {
      const u = undo(person);
      if (u) send(u.events);
    },
    [undo, send]
  );
  /** La sous-étape en cours faite tout de suite (sans attendre son minuteur). */
  const skipPhase = useCallback(
    (st: PlanStep, person?: Person | null) => {
      const a = mainAction(plan, state, st, now);
      if (a.kind === "phase" || a.kind === "phase-timer") act(st, person, a.kind === "phase-timer");
    },
    [plan, state, now, act]
  );
  /** Ce que fait le bouton principal sur une étape (libellé, conséquence). */
  const actionOf = useCallback((st: PlanStep) => mainAction(plan, state, st, now), [plan, state, now]);
  return { ...s, id: p.id, plan, mode, now, cookingStart, focus, upcoming, timers, ringing, next, nextFor, act, actionOf, undo, stopTimer, addMinutes, toggleStep, toggleBowl, togglePrep, setStatus, resume, resuming: resuming ? resumingAs : null, timerFor, startPhase, skipPhase, back, adjustTimer, resetTimer, pauseTimer, pauseAll, allPaused };
}

export function SessionApp(props: SessionProps) {
  const c = useControls(props);
  const { plan } = props;
  const { state } = c;

  // Barre espace : étape suivante (ou prochain bol pendant la prep).
  const nextRef = useRef<(key?: string) => void>(() => {});
  const modeRef = useRef(c.mode);
  // Flèche gauche (ordinateur) : retour à la sous-étape ou à l’étape d’avant, pendant la cuisson.
  const backRef = useRef<() => void>(() => {});
  backRef.current = () => {
    // À deux, le retour d’un écran est celui de sa personne (?personne=A ou B) ; sans personne, les boutons de chaque fil.
    if (state.status === "cooking" && (c.mode !== "duo" || props.person)) c.back(props.person ?? null);
  };
  modeRef.current = c.mode;
  const simpleRef = useRef(props.view !== "full");
  simpleRef.current = props.view !== "full";
  nextRef.current = (key?: string) => {
    if (props.view !== "full") {
      // Vue simple : le bouton principal de l’écran (à deux, celui de A ou de B).
      const who = key === "KeyA" ? "A" : key === "KeyB" ? "B" : null;
      document.querySelector<HTMLButtonElement>(who ? `[data-main="${who}"]` : "[data-main]")?.click();
      return;
    }
    // Ce qui sonne passe avant : l’espace l’arrête (le bouton de l’alerte dit ce qui suit).
    if (c.ringing.length) {
      c.stopTimer(c.ringing[0]);
      return;
    }
    if (c.mode === "duo") {
      // À deux : touche A ou B pour le « Fait » de chacun (espace = A).
      c.nextFor(key === "KeyB" ? "B" : "A");
      return;
    }
    if (state.status === "cooking") c.next();
    else if (state.status === "prep") {
      const pool = c.mode === "veille" && !state.eveDone ? plan.bowls.filter((x) => x.fridge) : plan.bowls.filter((x) => !x.during?.length);
      const b = pool.find((x) => !state.bowlsReady.has(x.letter));
      if (b) c.toggleBowl(b.letter);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      unlockAudio();
      const duoKey = modeRef.current === "duo" && (e.code === "KeyA" || e.code === "KeyB");
      const backKey = e.code === "ArrowLeft";
      if ((e.code !== "Space" && !duoKey && !backKey) || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      // Vue simple : l’espace sur un bouton, un lien ou un menu qui a le focus garde son effet (clavier).
      if (simpleRef.current && e.code === "Space" && t?.closest("button:not([data-main]), a, summary, select")) return;
      if (backKey) {
        e.preventDefault();
        backRef.current();
        return;
      }
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      nextRef.current(e.code);
    };
    const unlock = () => unlockAudio();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", unlock);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", unlock);
    };
  }, []);

  const ended = state.status === "done" || state.status === "abandoned";
  const setStatus = c.setStatus;
  const test = useMemo(() => (props.test ? { ended, end: () => setStatus("done") } : null), [props.test, ended, setStatus]);
  return (
    <SessionTest.Provider value={test}>
      <DishArts.Provider value={props.dishes ?? {}}>
      <People.Provider value={props.people ?? LETTERS}>
      {props.view !== "full" ? (
        <SimpleView
          id={props.id}
          plan={plan}
          c={c}
          overlay={props.view === "phone"}
          person={props.person ?? null}
          choice={props.dayChoice ?? null}
          storage={props.storage ?? []}
          qr={props.qrSvg ? { svg: props.qrSvg, url: props.phoneUrl } : null}
          startedAt={props.startedAt}
        />
      ) : c.mode === "duo" ? (
        <DuoView {...props} c={c} />
      ) : (
        <FullView {...props} c={c} />
      )}
      {/* Vue simple : ce qui sonne revient au premier plan dans l’écran lui-même. */}
      {props.view === "full" && <TimerAlert plan={plan} c={c} />}
      <ToastView toast={c.toast} onDone={() => c.setToast(null)} raised={props.view !== "full"} />
      </People.Provider>
      </DishArts.Provider>
    </SessionTest.Provider>
  );
}

// ─── Vue complète (ordinateur, iPad) ───

/** Pleine largeur sous l’en-tête de l’appli (le <main> du layout est limité à 64 rem). */
export function Bleed({ children }: { children: React.ReactNode }) {
  return <div className="-mt-4 mr-[calc(50%-50vw)] ml-[calc(50%-50vw)]">{children}</div>;
}

/** Retour à la vue simple (la vue par défaut). */
export function SimpleLink() {
  return (
    <Link href="?" className={buttonClass({ variant: "inverse", size: "sm" })} title="Une consigne à la fois, en grand">
      Vue simple
    </Link>
  );
}

const phaseOf = (status: SessionState["status"]): Phase | null => (status === "prep" || status === "planned" ? "prep" : status === "cooking" ? "cooking" : null);

function FullView(p: SessionProps & { c: Controls }) {
  const { plan, c } = p;
  const { state } = c;
  const wake = useWakeLock();
  const phase = phaseOf(state.status);
  const qr = p.qrSvg ? (
    <QrCard svg={p.qrSvg} url={p.phoneUrl}>
      <Icon name="qr" size="s" />
      Sur ton téléphone
    </QrCard>
  ) : null;
  return (
    <Bleed>
      <SessionHead
        title={sessionTitle(p.startedAt, plan)}
        sub={[recipesLine(plan), progressLine(plan, c)].filter(Boolean).join(" · ")}
        online={c.online}
        phase={c.mode === "veille" && !state.eveDone && phase === "prep" ? null : phase}
        onPhase={(ph) => c.setStatus(ph)}
        right={
          <span className="flex items-center gap-2">
            <WakePill wake={wake} />
            <SimpleLink />
            <a href={p.phoneUrl} className={buttonClass({ variant: "inverse", size: "sm", className: "md:hidden" })}>
              <Icon name="qr" size="s" />
              Téléphone
            </a>
          </span>
        }
      />
      <div className="mx-auto grid max-w-[90rem] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 sm:px-6">
        <Issues plan={plan} sessionId={p.id} />
        {state.status === "fridge" ? (
          <FridgeView plan={plan} c={c} choice={p.dayChoice ?? null} qr={qr} />
        ) : phase === "prep" ? (
          <>
            <PlanDetails plan={plan} open />
            <PrepPhase plan={plan} c={c} aside={<div className="hidden max-w-[220px] md:block">{qr}</div>} />
          </>
        ) : state.status === "done" || state.status === "abandoned" ? (
          <DoneView plan={plan} c={c} startedAt={p.startedAt} />
        ) : (
          <CookPhase plan={plan} c={c} side={<div className="hidden md:block">{qr}</div>} />
        )}
      </div>
    </Bleed>
  );
}

const parisDay = (ms: number) => new Date(ms).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });

/** Prep de la veille : durée réelle du soir (du premier geste à « au frigo »). */
export function eveRealMin(c: Controls): number | null {
  const evs = c.events.filter((e) => e.kind === "step_done" || e.kind === "bowl_ready");
  const end = [...c.events].reverse().find((e) => e.kind === "note" && e.payload?.status === "fridge");
  if (!evs.length || !end) return null;
  return (Date.parse(end.at) - Date.parse(evs[0].at)) / 60000;
}

/** Prep la veille, le soir fini (DA « Reprendre la session ») : la soirée, le jour J, les bols au frigo, seul ou à deux. */
function FridgeView({ plan, c, choice, qr }: { plan: SessionPlan; c: Controls; choice: DayChoice | null; qr?: React.ReactNode }) {
  const { state } = c;
  const inFridge = plan.bowls.filter((b) => state.bowlsReady.has(b.letter));
  const eveTasks = plan.prep.tasks.filter((t) => t.eve);
  const left = plan.prep.tasks.filter((t) => !t.eve);
  const real = eveRealMin(c);
  const end = [...c.events].reverse().find((e) => e.kind === "note" && e.payload?.status === "fridge");
  const first = plan.steps[0];
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-[clamp(1.75rem,3vw,2.25rem)] font-extrabold">Reprendre la session</h1>
        <p className="text-ink-2">
          Prep terminée{end ? ` ${parisDay(Date.parse(end.at)) === parisDay(c.now) ? "à" : "hier à"} ${clock(Date.parse(end.at))}` : ""} · {inFridge.length} bol{inFridge.length > 1 ? "s" : ""} au frigo, filmé{inFridge.length > 1 ? "s" : ""}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-3 rounded-[14px] border border-line bg-surface px-6 py-4">
          <div className="flex items-center gap-3">
            <Icon name="moonset" />
            <b className="font-display text-[18px]">La veille · prep</b>
            <span className="num ml-auto rounded-full bg-surface-2 px-2 text-small font-semibold text-ink-2">
              {eveTasks.filter((t) => state.prepDone.has(t.id)).length} gestes sur {eveTasks.length}
            </span>
          </div>
          <i className="block h-1.5 rounded-full bg-accent" />
          <p className="num text-ink-2">{real != null ? `Durée réelle ${dur(real)} (prévu ${dur(plan.prep.eveMin ?? 0)}).` : `Prévu ${dur(plan.prep.eveMin ?? 0)}.`}</p>
        </div>
        <div className="grid gap-3 rounded-[14px] border border-line bg-surface px-6 py-4">
          <div className="flex items-center gap-3">
            <Icon name="flame" />
            <b className="font-display text-[18px]">Le jour J · prep et cuisson</b>
            <span className="num ml-auto rounded-full bg-surface-2 px-2 text-small font-semibold text-ink-2">0 sur {plan.steps.length}</span>
          </div>
          <i className="block h-1.5 rounded-full bg-surface-2" />
          <p className="text-ink-2">{first ? `Première étape : ${kindLabel(first.kind).toLowerCase()} · ${first.equipmentName ?? recipeOf(plan, first.recipeSlug)?.name ?? ""}.` : ""}{left.length ? ` Avant : ${left.length} geste${left.length > 1 ? "s" : ""} du jour même.` : ""}</p>
        </div>
      </div>
      <ResumeChoice plan={plan} c={c} choice={choice} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="grid content-start gap-3">
          <h2 className="text-[20px] font-bold">Au frigo</h2>
          <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
            {inFridge.map((b) => (
              <PrepBowlRow key={b.letter} plan={plan} c={c} b={b} fridge />
            ))}
          </div>
        </section>
        <section className="grid content-start gap-4">
          {left.length > 0 && <Tomorrow tasks={left} title="Le jour J, avant la cuisson" />}
          <PlanDetails plan={plan} />
          <div className="hidden max-w-[220px] md:block">{qr}</div>
        </section>
      </div>
    </div>
  );
}
