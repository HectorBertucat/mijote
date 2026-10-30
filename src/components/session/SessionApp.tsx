"use client";

// Centre de contrôle d'une session (docs/vision.md §4.4 bis), selon la DA « Plan de travail ».
// Une seule logique, deux vues : la vue simple par défaut, téléphone d'abord (trois temps, une
// consigne à la fois, Simple.tsx ; ?vue=telephone la garde plein écran à toutes les tailles) et la
// vue détaillée (?vue=detail : fil, minuteurs, foyers et four ; ordinateur et iPad).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { modeOf, type Person, type PlanStep, type SessionPlan } from "@/lib/session/planner";
import {
  backgroundSteps,
  bowlsCompletedBy,
  currentPhase,
  focusStep,
  isWaitTimer,
  nextTodo,
  passiveMin,
  personFocus,
  personNext,
  phaseIds,
  phaseTimer,
  randomId,
  stepStatus,
  stepTimer,
  type SessionEvent,
  type SessionState,
  type TimerState,
} from "@/lib/session/state";
import { resumeSession } from "@/app/session/actions";
import { buttonClass, Icon } from "@/components/ui";
import { useNow, useSession } from "./useSession";
import { chime, clock, dur, Eyebrow, kindLabel, QrCard, recipeOf, SessionHead, SessionTest, TimerAlert, ToastView, unlockAudio, useWakeLock, WakePill, type Phase } from "./parts";
import { DoneView, Issues, PlanDetails, progressLine, recipesLine, ResumeChoice, sessionTitle } from "./blocks";
import { PrepBowlRow, PrepPhase, Tomorrow } from "./Prep";
import { CookPhase } from "./Cook";
import { SimpleView } from "./Simple";
import type { RecipeStorage } from "@/lib/session/flow";
import { DuoView } from "./DuoView";

/** Prep la veille : durées du jour J selon qu'on le fait seul ou à deux (écran « au frigo »). */
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
  /** Session test (pour montrer l'appli) : étiquette dans l'en-tête, rien n'est compté. */
  test?: boolean;
  /** Le rangement : boîtes et conservation de chaque recette. */
  storage?: RecipeStorage[];
}

export type Controls = ReturnType<typeof useControls>;

function useControls(p: SessionProps) {
  const { plan } = p;
  const s = useSession({ id: p.id, plan, initialEvents: p.initialEvents, initialStatus: p.initialStatus });
  const { state, send } = s;
  const now = useNow(s.offset, p.serverNow);
  const mode = modeOf(plan);
  // Seul / veille : la cuisson commence après la prep (du jour même, après la reprise) ; à deux, tout part du démarrage.
  const base = state.resumedAt ?? (p.startedAt ? Date.parse(p.startedAt) : now);
  const cookingStart = mode === "duo" ? (state.cookingStartedAt ?? now) : (state.cookingStartedAt ?? base + plan.prep.minutes * 60000);
  const focus = focusStep(plan, state, now);
  const upcoming = nextTodo(plan, state, focus);
  const timers = [...state.timers.values()].filter((t) => t.doneAt == null).sort((a, b) => a.endsAt - b.endsAt);
  // Les minuteurs de sous-étape ne sonnent pas en plein écran : la sous-étape suivante démarre (bip, voir plus bas).
  // Sauf la fin d'une attente (le riz a cuit) : on faisait autre chose, ça sonne comme un minuteur d'étape.
  const ringing = timers.filter((t) => t.endsAt <= now && (t.phase == null || isWaitTimer(plan, t)));

  const startTimer = useCallback(
    (label: string, minutes: number, stepId: string | null, auto = false) =>
      ({ kind: "timer_start" as const, ref: randomId(), payload: { label, minutes, stepId, auto, endsAt: new Date(now + minutes * 60000).toISOString() } }),
    [now]
  );
  type Ev = Parameters<typeof send>[0][number];
  /** Minuteur de la sous-étape `n` (ids stables : un seul écran l'écrit). */
  const phaseStart = useCallback(
    (st: PlanStep, n: number, person?: Person): Ev[] => {
      const ph = st.phases?.[n];
      if (!ph) return [];
      const ids = phaseIds(p.id, st.id, n);
      return [{ id: ids.start, kind: "timer_start", ref: ids.timer, payload: { label: ph.text, minutes: ph.min, stepId: st.id, phase: n, endsAt: new Date(now + ph.min * 60000).toISOString(), ...(person ? { person } : {}) } }];
    },
    [p.id, now]
  );
  /** Sous-étape `n` faite : son minuteur s'arrête, la suivante démarre. */
  const phaseDone = useCallback(
    (st: PlanStep, n: number, person?: Person): Ev[] => {
      const ids = phaseIds(p.id, st.id, n);
      const out: Ev[] = [];
      const t = phaseTimer(state, st.id, n);
      if (t) out.push({ id: ids.stop, kind: "timer_done", ref: t.id });
      out.push({ id: ids.done, kind: "step_done", ref: `phase:${n}:${st.id}`, payload: person ? { person } : null });
      return [...out, ...phaseStart(st, n + 1, person)];
    },
    [p.id, state, phaseStart]
  );
  /** Lancer une étape : avec des sous-étapes, le minuteur de la première part tout de suite. */
  const startStep = useCallback(
    (st: PlanStep, person?: Person): Ev[] => [{ kind: "step_start", ref: st.id, payload: person ? { person } : null }, ...(currentPhase(state, st) === 0 ? phaseStart(st, 0, person) : [])],
    [state, phaseStart]
  );
  /** Ce qui reste des sous-étapes quand on finit l'étape d'un coup. */
  const closePhases = useCallback((st: PlanStep, person?: Person): Ev[] => {
    const n = currentPhase(state, st);
    if (n == null) return [];
    const out: Ev[] = [];
    for (let i = n; i < st.phases!.length; i++) {
      const ids = phaseIds(p.id, st.id, i);
      const t = phaseTimer(state, st.id, i);
      if (t) out.push({ id: ids.stop, kind: "timer_done", ref: t.id });
      out.push({ id: ids.done, kind: "step_done", ref: `phase:${i}:${st.id}`, payload: person ? { person } : null });
    }
    return out;
  }, [p.id, state]);

  // Un minuteur de sous-étape fini : la suivante démarre toute seule (chaque écran le voit, le serveur garde le premier).
  // Une attente finie sonne à la place (ringing) : on l'arrête, et la suite démarre.
  useEffect(() => {
    const out: Ev[] = [];
    for (const st of plan.steps) {
      if (stepStatus(state, st.id) !== "active") continue;
      const n = currentPhase(state, st);
      if (n == null || st.phases![n].wait) continue;
      const t = phaseTimer(state, st.id, n);
      if (t && t.endsAt <= now) out.push(...phaseDone(st, n));
    }
    if (out.length) send(out);
  }, [plan, state, now, send, phaseDone]);
  // Bip quand l'étape montrée passe à la sous-étape suivante.
  const phaseKey = focus && stepStatus(state, focus.id) === "active" ? `${focus.id}|${currentPhase(state, focus) ?? "fin"}` : null;
  const lastPhaseKey = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastPhaseKey.current;
    lastPhaseKey.current = phaseKey;
    if (prev && phaseKey && prev !== phaseKey && prev.split("|")[0] === phaseKey.split("|")[0]) {
      chime();
      navigator.vibrate?.([200, 100, 200]);
    }
  }, [phaseKey]);

  /** Seul, geste glissé dans la cuisson : fait, il finit ses bols (quand leurs autres gestes du fil sont faits). */
  const fillBowls = useCallback(
    (st: PlanStep): Ev[] =>
      st.tasks
        ? st.bowls
            .filter((l) => !state.bowlsReady.has(l) && (plan.bowls.find((b) => b.letter === l)?.during ?? []).every((d) => d.stepId === st.id || state.done.has(d.stepId)))
            .map((l) => ({ kind: "bowl_ready" as const, ref: l, payload: { ready: true } }))
        : [],
    [plan, state]
  );

  const stepLabel = (st: PlanStep) => `${st.kind === "preheat" ? "Four" : (st.equipmentName ?? kindLabel(st.kind))}${recipeOf(plan, st.recipeSlug) ? ` · ${recipeOf(plan, st.recipeSlug)!.name.split(" ")[0]}` : ""} (ét. ${st.no})`;

  const next = useCallback(() => {
    const out: Parameters<typeof send>[0] = [];
    const f = focusStep(plan, state, now);
    const ph = f ? currentPhase(state, f) : null;
    if (f && stepStatus(state, f.id) === "todo") {
      out.push(...startStep(f));
    } else if (f && ph != null && ph < f.phases!.length - 1) {
      // Sous-étape faite plus tôt que le minuteur : on passe à la suivante.
      out.push(...phaseDone(f, ph));
    } else if (f) {
      out.push(...closePhases(f));
      const hasTimer = Boolean(stepTimer(state, f.id));
      if (!hasTimer && passiveMin(f) >= 3) out.push(startTimer(stepLabel(f), Math.round(passiveMin(f)), f.id, true));
      else if (!hasTimer) out.push({ kind: "step_done", ref: f.id }, ...fillBowls(f));
      const n = nextTodo(plan, state, f);
      if (n) out.push(...startStep(n));
    }
    send(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, state, now, send, startTimer, startStep, phaseDone, closePhases, fillBowls]);

  const stopTimer = useCallback(
    (t: TimerState) => {
      // Arrêter le minuteur d'une sous-étape, c'est la finir : la suivante démarre.
      const ps = t.phase != null && t.stepId ? plan.steps.find((x) => x.id === t.stepId) : undefined;
      if (ps && currentPhase(state, ps) === t.phase) return send(phaseDone(ps, t.phase!));
      const out: Parameters<typeof send>[0] = [{ kind: "timer_done", ref: t.id }];
      const auto = s.events.some((e) => e.kind === "timer_start" && e.ref === t.id && e.payload?.auto === true);
      if (auto && t.endsAt <= now && t.stepId && stepStatus(state, t.stepId) === "active") out.push({ kind: "step_done", ref: t.stepId });
      send(out);
    },
    [plan, now, s.events, send, state, phaseDone]
  );
  /** Régler un minuteur (+1, glisser sur l'ordinateur) : nouvelle fin, lancement et durée d'origine gardés. */
  const setTimerEnd = useCallback(
    (t: TimerState, endsAt: number) =>
      send([{ kind: "timer_start", ref: t.id, payload: { label: t.label, minutes: Math.round(((endsAt - t.startedAt) / 60000) * 100) / 100, stepId: t.stepId, ...(t.phase != null ? { phase: t.phase } : {}), adjust: true, endsAt: new Date(endsAt).toISOString() } }]),
    [send]
  );
  const addMinutes = useCallback((t: TimerState, min: number) => setTimerEnd(t, Math.max(now, t.endsAt) + min * 60000), [now, setTimerEnd]);
  const adjustTimer = useCallback((t: TimerState, deltaSec: number) => setTimerEnd(t, Math.max(now + 5000, t.endsAt + deltaSec * 1000)), [now, setTimerEnd]);
  /** ↺ : revenir à la durée d'origine (fin = lancement + durée de départ). */
  const resetTimer = useCallback((t: TimerState) => setTimerEnd(t, Math.max(now, t.startedAt + t.refMinutes * 60000)), [now, setTimerEnd]);
  const toggleStep = useCallback(
    (st: PlanStep) => {
      const status = stepStatus(state, st.id);
      if (status === "todo") send(startStep(st));
      else if (status === "active") send([...closePhases(st), { kind: "step_done", ref: st.id }, ...fillBowls(st)]);
      else send([{ kind: "step_start", ref: st.id, payload: { undo: true } }]);
    },
    [send, state, startStep, closePhases, fillBowls]
  );
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
  /** À deux : « Fait » dans le fil d'une personne (geste de prep ou étape), puis on lance son étape suivante. */
  const nextFor = useCallback(
    (person: Person) => {
      const f = personFocus(plan, state, person, now);
      if (!f) return;
      const out: Parameters<typeof send>[0] = [];
      if (state.status !== "cooking") out.push({ kind: "note", payload: { status: "cooking", person } });
      let finished = false;
      if (f.type === "prep") {
        out.push({ kind: "step_done", ref: f.id, payload: { person } });
        const done = new Set(state.prepDone).add(f.task.id);
        for (const l of bowlsCompletedBy(plan, done)) if (!state.bowlsReady.has(l)) out.push({ kind: "bowl_ready", ref: l, payload: { ready: true, person } });
        finished = true;
      } else if (stepStatus(state, f.id) === "todo") {
        out.push(...startStep(f.step, person));
      } else if (currentPhase(state, f.step) != null && currentPhase(state, f.step)! < f.step.phases!.length - 1) {
        out.push(...phaseDone(f.step, currentPhase(state, f.step)!, person));
      } else {
        out.push(...closePhases(f.step, person));
        const hasTimer = Boolean(stepTimer(state, f.id));
        if (!hasTimer && passiveMin(f.step) >= 3) {
          const t = startTimer(stepLabel(f.step), Math.round(passiveMin(f.step)), f.id, true);
          out.push({ ...t, payload: { ...t.payload, person } });
        } else if (!hasTimer) out.push({ kind: "step_done", ref: f.id, payload: { person } });
        finished = true;
      }
      if (finished) {
        const n = personNext(plan, state, person, f);
        if (n?.type === "step") out.push(...startStep(n.step, person));
      }
      send(out);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, state, now, send, startTimer, startStep, phaseDone, closePhases]
  );
  const setStatus = useCallback((status: SessionState["status"]) => send([{ kind: "note", payload: { status } }]), [send]);
  const timerFor = useCallback((st: PlanStep, minutes: number) => send([startTimer(stepLabel(st), minutes, st.id)]), [send, startTimer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reprise d'une prep la veille : seul, le plan de la veille continue ; à deux, le serveur
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
        if (!ok) s.setToast({ key: randomId(), text: "Reprise à deux impossible : la session n'est plus au frigo ?", remote: false, error: true });
        router.refresh();
      });
    },
    [send, p.id, router, s]
  );

  /** Relancer le minuteur de la sous-étape en cours (étape lancée avant les sous-étapes, minuteur arrêté). */
  const startPhase = useCallback((st: PlanStep) => {
    const n = currentPhase(state, st);
    if (n != null) send(phaseStart(st, n).map((e) => ({ ...e, id: randomId() })));
  }, [state, send, phaseStart]);
  /**
   * Retour (ordinateur) : défait le dernier « Suivant ». Dans une étape à sous-étapes, revient à la
   * sous-étape d'avant (son minuteur repart) ; sinon l'étape montrée redevient « à lancer » et
   * l'étape d'avant (la dernière lancée) redevient celle en cours, son minuteur d'attente arrêté.
   */
  const back = useCallback(() => {
    const f = focusStep(plan, state, now);
    const out: Ev[] = [];
    if (f && stepStatus(state, f.id) === "active") {
      const len = f.phases?.length ?? 0;
      const n = currentPhase(state, f);
      const reached = n ?? len;
      if (len && reached > 0) {
        if (n != null) {
          const t = phaseTimer(state, f.id, n);
          if (t) out.push({ kind: "timer_done", ref: t.id });
        }
        out.push({ kind: "step_done", ref: `phase:${reached - 1}:${f.id}`, payload: { undo: true } });
        out.push(...phaseStart(f, reached - 1).map((e) => ({ ...e, id: randomId() })));
        return send(out);
      }
      if (n === 0) {
        const t = phaseTimer(state, f.id, 0);
        if (t) out.push({ kind: "timer_done", ref: t.id });
      }
      out.push({ kind: "step_start", ref: f.id, payload: { undo: true } });
    }
    const prev = plan.steps
      .filter((x) => x.id !== f?.id && state.started.has(x.id))
      .sort((a, b) => (state.done.get(b.id) ?? state.started.get(b.id)!) - (state.done.get(a.id) ?? state.started.get(a.id)!))[0];
    if (prev) {
      if (state.done.has(prev.id)) out.push({ kind: "step_start", ref: prev.id, payload: { undo: true } }, { kind: "step_start", ref: prev.id });
      const t = stepTimer(state, prev.id);
      if (t) out.push({ kind: "timer_done", ref: t.id });
    }
    if (out.length) send(out);
  }, [plan, state, now, send, phaseStart]);
  const skipPhase = useCallback((st: PlanStep) => {
    const n = currentPhase(state, st);
    if (n != null) send(phaseDone(st, n));
  }, [state, send, phaseDone]);

  return { ...s, id: p.id, mode, now, cookingStart, focus, upcoming, timers, ringing, next, nextFor, stopTimer, addMinutes, toggleStep, toggleBowl, togglePrep, setStatus, resume, resuming: resuming ? resumingAs : null, timerFor, startPhase, skipPhase, back, adjustTimer, resetTimer };
}

export function SessionApp(props: SessionProps) {
  const c = useControls(props);
  const { plan } = props;
  const { state } = c;

  // Barre espace : étape suivante (ou prochain bol pendant la prep).
  const nextRef = useRef<(key?: string) => void>(() => {});
  const modeRef = useRef(c.mode);
  // Flèche gauche (ordinateur) : retour à la sous-étape ou à l'étape d'avant, pendant la cuisson.
  const backRef = useRef<() => void>(() => {});
  backRef.current = () => {
    if (state.status === "cooking") c.back();
  };
  modeRef.current = c.mode;
  const simpleRef = useRef(props.view !== "full");
  simpleRef.current = props.view !== "full";
  nextRef.current = (key?: string) => {
    if (props.view !== "full") {
      // Vue simple : le bouton principal de l'écran (à deux, celui de A ou de B).
      const who = key === "KeyA" ? "A" : key === "KeyB" ? "B" : null;
      document.querySelector<HTMLButtonElement>(who ? `[data-main="${who}"]` : "[data-main]")?.click();
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
      const backKey = e.code === "ArrowLeft" && modeRef.current !== "duo";
      if ((e.code !== "Space" && !duoKey && !backKey) || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      // Vue simple : l'espace sur un bouton, un lien ou un menu qui a le focus garde son effet (clavier).
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
      {/* Vue simple : ce qui sonne revient au premier plan dans l'écran lui-même. */}
      {props.view === "full" && <TimerAlert plan={plan} ringing={c.ringing} now={c.now} onStop={c.stopTimer} />}
      <ToastView toast={c.toast} onDone={() => c.setToast(null)} raised={props.view !== "full"} />
    </SessionTest.Provider>
  );
}

// ─── Vue complète (ordinateur, iPad) ───

/** Pleine largeur sous l'en-tête de l'appli (le <main> du layout est limité à 64 rem). */
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
      <div className="mx-auto grid max-w-[90rem] gap-5 px-4 py-5 sm:px-5">
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
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h1 className="text-[clamp(1.75rem,3vw,2.25rem)] font-extrabold">Reprendre la session</h1>
        <p className="text-ink-2">
          Prep terminée{end ? ` ${parisDay(Date.parse(end.at)) === parisDay(c.now) ? "à" : "hier à"} ${clock(Date.parse(end.at))}` : ""} · {inFridge.length} bol{inFridge.length > 1 ? "s" : ""} au frigo, filmé{inFridge.length > 1 ? "s" : ""}
        </p>
      </div>
      <div className="grid gap-3.5 md:grid-cols-2">
        <div className="grid gap-2.5 rounded-[14px] border border-line bg-surface px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Icon name="moonset" />
            <b className="font-display text-[18px]">La veille · prep</b>
            <span className="num ml-auto rounded-full bg-surface-2 px-2 text-[13px] font-semibold text-ink-2">
              {eveTasks.filter((t) => state.prepDone.has(t.id)).length} gestes sur {eveTasks.length}
            </span>
          </div>
          <i className="block h-1.5 rounded-full bg-accent" />
          <p className="num text-ink-2">{real != null ? `Durée réelle ${dur(real)} (prévu ${dur(plan.prep.eveMin ?? 0)}).` : `Prévu ${dur(plan.prep.eveMin ?? 0)}.`}</p>
        </div>
        <div className="grid gap-2.5 rounded-[14px] border border-line bg-surface px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Icon name="flame" />
            <b className="font-display text-[18px]">Le jour J · prep et cuisson</b>
            <span className="num ml-auto rounded-full bg-surface-2 px-2 text-[13px] font-semibold text-ink-2">0 sur {plan.steps.length}</span>
          </div>
          <i className="block h-1.5 rounded-full bg-surface-2" />
          <p className="text-ink-2">{first ? `Première étape : ${kindLabel(first.kind).toLowerCase()} · ${first.equipmentName ?? recipeOf(plan, first.recipeSlug)?.name ?? ""}.` : ""}{left.length ? ` Avant : ${left.length} geste${left.length > 1 ? "s" : ""} du jour même.` : ""}</p>
        </div>
      </div>
      <ResumeChoice plan={plan} c={c} choice={choice} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="grid content-start gap-2.5">
          <h2 className="text-[20px] font-bold">Au frigo</h2>
          <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
            {inFridge.map((b) => (
              <PrepBowlRow key={b.letter} plan={plan} c={c} b={b} fridge />
            ))}
          </div>
        </section>
        <section className="grid content-start gap-3.5">
          {left.length > 0 && <Tomorrow tasks={left} title="Le jour J, avant la cuisson" />}
          <PlanDetails plan={plan} />
          <div className="hidden max-w-[220px] md:block">{qr}</div>
        </section>
      </div>
    </div>
  );
}
