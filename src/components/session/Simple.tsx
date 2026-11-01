"use client";

// Vue simple d’une session, téléphone d’abord (la vue par défaut ; ?vue=detail pour la vue détaillée).
// Trois temps : Prépare (tout sur le plan de travail, par bols), Cuisine (une consigne à la fois, lue à
// un mètre : la consigne en Atkinson très grand, minuteur et niveau en chiffres géants) et Range (boîtes
// et frigo). Entre deux temps, un aplat d’encre plein écran ; ce qui sonne revient au premier plan sur un
// aplat tomate (la seule urgence) ; la fin pose le cachet. Le planificateur ne change pas : parallélisme,
// minuteurs, sous-étapes et mode à deux sont là, mais l’écran ne montre que ce qu’il faut faire
// maintenant et ce qui sonne bientôt ; le reste est replié ou dans la vue détaillée.
// Sur téléphone (ou ?vue=telephone), la vue couvre la navigation ; sombre pendant la cuisson.
// Barre espace : le bouton principal de l’écran ([data-main]) ; flèche gauche : retour.
import Link from "next/link";
import { useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { modeOf, type Person, type PlanStep, type PrepTask, type SessionPlan } from "@/lib/session/planner";
import { batchOf, currentPhase, liveTimer, phaseTimer, stepStatus, stepTimer, type TimerState } from "@/lib/session/state";
import { atMoment, prepBowls, prepExtras, stageOf, storageLine, TEMPS, tempsProgress, type RecipeStorage, type Stage, type Temps } from "@/lib/session/flow";
import { Button, Check, Icon, type ButtonVariant, type IconName } from "@/components/ui";
import { FoodIllu, StepIllu } from "@/components/illus/Illu";
import { BoxGlyph } from "@/components/boxes/BoxGlyph";
import type { Controls, DayChoice } from "./SessionApp";
import { Issues, progressLine, ResumeChoice } from "./blocks";
import { DropGuide, wantsDropGuide } from "./DropGuide";
import { FridgeDone } from "./FridgeDone";
import { SessionBoxes } from "./SessionBoxes";
import { DuoPick } from "./DuoView";
import { SimpleDuo } from "./SimpleDuo";
import { Bowl, bowlName, clock, DishArts, dur, hobName, mmss, PersonMono, QrCard, recipeOf, SessionTest, shortName, stepHead, stepColor, useRingAlarm, useWakeLock, WakePill } from "./parts";
import { typo } from "@/lib/typo";
import { attentionOf, batchesLabel, fmtMin, ringInfo, timedPhase } from "@/lib/session/guide";
import { AttentionTag, BowlText, Lanes, RecipeContext, RingDetails, SharedSplit, TakeBowls, TimerBar, RestartButtons, useRestart } from "./guide";
import { PhaseNext } from "./blocks";

export interface SimpleProps {
  id: string;
  plan: SessionPlan;
  c: Controls;
  /** Plein écran par-dessus la navigation à toutes les tailles (?vue=telephone) ; sinon seulement sur téléphone. */
  overlay: boolean;
  person: Person | null;
  choice: DayChoice | null;
  storage: RecipeStorage[];
  qr: { svg: string; url: string } | null;
  startedAt: string | null;
}

/** Fond de l’écran : papier, aplat d’encre (transitions, confirmation), aplat tomate (ça sonne). */
export type Tone = "paper" | "ink" | "hot";

export function SimpleView(p: SimpleProps) {
  const { plan, c } = p;
  const wake = useWakeLock();
  const stage = stageOf(plan, c.state);
  const small = useSmall();
  const [seen, markSeen] = useSeen(p.id);
  const [confirming, setConfirming] = useState(false);
  const duo = modeOf(plan) === "duo";
  const ringing = duo && p.person ? c.ringing.filter((t) => personOf(plan, t) === p.person || personOf(plan, t) == null) : c.ringing;
  useRingAlarm(ringing.length > 0);
  useInputKind();
  const dark = (p.overlay || small) && stage === "cook";
  const detail = `?vue=detail${p.person ? `&personne=${p.person}` : ""}`;

  let body: ReactNode;
  let bar: ReactNode = null;
  let tone: Tone = "paper";
  if (confirming && stage !== "done") {
    tone = "ink";
    body = <ConfirmEnd plan={plan} storage={p.storage} />;
    bar = (
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3">
        <Button size="kitchen" variant="inverse" onClick={() => setConfirming(false)} className="min-h-[72px]">
          Pas encore
        </Button>
        <MainButton icon="check" variant="on-inverse" onClick={() => c.setStatus("done")}>
          Oui, terminer
        </MainButton>
      </div>
    );
  } else if (stage === "done") {
    body = <Done plan={plan} c={c} detail={detail} />;
  } else if (stage === "fridge") {
    body = <Fridge plan={plan} c={c} choice={p.choice} />;
  } else if (duo && !p.person && (small || p.overlay)) {
    body = <DuoPick telephone={p.overlay} />;
  } else if (duo && stage === "cook") {
    const fresh = c.state.status !== "cooking" && c.state.prepDone.size === 0 && c.state.started.size === 0;
    if (fresh && !seen.has("duo")) {
      tone = "ink";
      body = <Interlude n={null} title="À deux" lines={[`${plan.recipes.map((r) => r.name).join(", ")}.`, `Chacun son fil, une consigne à la fois. Environ ${dur(plan.totalMin)} en tout.`]} art={<DuoArt />} qr={p.person ? null : p.qr} />;
      bar = <MainButton icon="play" variant="on-inverse" onClick={() => markSeen("duo")}>C’est parti</MainButton>;
    } else return <SimpleDuo plan={plan} c={c} person={p.person} overlay={p.overlay} dark={dark} wake={wake} detail={detail} onEnd={() => setConfirming(true)} ringing={ringing} />;
  } else if (stage === "prep") {
    const fresh = prepBowls(plan, c.state).every((b) => !c.state.bowlsReady.has(b.letter)) && c.state.prepDone.size === 0;
    if (fresh && !seen.has("prep")) {
      const bowls = prepBowls(plan, c.state);
      const evening = c.mode === "veille" && !c.state.eveDone;
      tone = "ink";
      body = (
        <Interlude
          n={1}
          title={evening ? "Prépare, ce soir" : "Prépare"}
          lines={[`${bowls.length ? `${bowls.length} bol${bowls.length > 1 ? "s" : ""} à remplir` : "Pas de bol à remplir avant de commencer"}, environ ${dur(evening ? (plan.prep.eveMin ?? 0) : plan.prep.minutes)}.`, evening ? "Ce soir, ce qui se garde au frigo ; demain, le reste puis la cuisson." : "Sors tout, coupe, remplis. Ensuite, une consigne à la fois."]}
          art={<FoodsArt plan={plan} />}
          qr={p.qr}
        />
      );
      bar = <MainButton icon="play" variant="on-inverse" onClick={() => markSeen("prep")}>C’est parti</MainButton>;
    } else {
      body = <PrepScreen id={p.id} plan={plan} c={c} />;
      bar = <PrepBar plan={plan} c={c} />;
    }
  } else if (ringing.length) {
    tone = "hot";
    body = <Ringing plan={plan} c={c} timers={ringing} />;
    bar = <RingBar plan={plan} c={c} t={ringing[0]} />;
  } else if (stage === "cook") {
    if (plan.steps.every((s) => stepStatus(c.state, s.id) === "todo") && !seen.has("cook")) {
      tone = "ink";
      body = <Interlude n={2} title="Cuisine" lines={[`${plan.steps.length} étapes, une à la fois. Le bouton du bas dit ce qu’il fait ; rien ne se lance tout seul, pas même un minuteur.`, progressLine(plan, c)]} art={<StepIllu kind="sear" text="Poêle" size={120} live />} />;
      bar = <MainButton icon="play" variant="on-inverse" onClick={() => markSeen("cook")}>Première étape</MainButton>;
    } else {
      body = <CookScreen plan={plan} c={c} />;
      bar = <CookBar plan={plan} c={c} />;
    }
  } else if (stage === "store") {
    if (c.state.boxed.size === 0 && !seen.has("store")) {
      tone = "ink";
      body = <Interlude n={3} title="Range" lines={["Tout est cuit.", "Laisse tiédir, mets en boîtes, au frigo."]} art={<StepIllu id="portion" size={120} live />} />;
      bar = <MainButton icon="play" variant="on-inverse" onClick={() => markSeen("store")}>On range</MainButton>;
    } else {
      body = <StoreScreen plan={plan} c={c} storage={p.storage} />;
      bar = <MainButton icon="check" onClick={() => setConfirming(true)}>Terminer la session</MainButton>;
    }
  }

  return (
    <Shell overlay={p.overlay} dark={dark} tone={tone} wakeOn={wake.on} onWake={() => void wake.request()} bar={bar}>
      <Head plan={plan} c={c} stage={stage} wake={wake} detail={detail} overlay={p.overlay} tone={tone} onEnd={stage !== "done" ? () => setConfirming(true) : undefined} />
      {body}
    </Shell>
  );
}

// ─── Coquille : plein écran sur téléphone, en-tête, barre du bas ───

type Wake = { on: boolean; request: () => Promise<void> };

/** Sous 768 px : la vue couvre la navigation et la cuisson passe en sombre (après le premier rendu). */
function useSmall() {
  const [small, setSmall] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 767px)");
    const on = () => setSmall(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return small;
}

/** Clavier ou doigt : au clavier, l’écran change sans animation (session.css, [data-input="key"]). */
function useInputKind() {
  useEffect(() => {
    const root = document.documentElement;
    const key = () => (root.dataset.input = "key");
    const ptr = () => (root.dataset.input = "pointer");
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", ptr, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", ptr, true);
      delete root.dataset.input;
    };
  }, []);
}

/** Les écrans de transition déjà passés sur cet appareil (ne reviennent pas après un rechargement). */
function useSeen(id: string): [Set<string>, (k: string) => void] {
  const key = `mijote:session:${id}:vu`;
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      setSeen(new Set(JSON.parse(sessionStorage.getItem(key) ?? "[]") as string[]));
    } catch {
      /* stockage indisponible : les transitions reviennent, sans gêne */
    }
  }, [key]);
  const mark = (k: string) =>
    setSeen((prev) => {
      const next = new Set(prev).add(k);
      try {
        sessionStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        /* idem */
      }
      return next;
    });
  return [seen, mark];
}

const TONE: Record<Tone, { cls: string; bg: string }> = {
  paper: { cls: "text-ink", bg: "var(--c-bg)" },
  ink: { cls: "text-on-inverse", bg: "var(--c-inverse)" },
  hot: { cls: "text-on-hot", bg: "var(--c-hot)" },
};

/** Colonne de la session : une colonne sur téléphone (marges 20), grille de 12 sur grand écran (marges 40). */
export const COLUMN = "mx-auto w-full max-w-[1240px] px-5 md:px-10";

export function Shell({ overlay, dark, tone = "paper", wakeOn, onWake, bar, children }: { overlay: boolean; dark: boolean; tone?: Tone; wakeOn: boolean; onWake: () => void; bar: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <div
      className={`${overlay ? "fixed inset-0 z-30 overflow-y-auto" : "max-md:fixed max-md:inset-0 max-md:z-30 max-md:overflow-y-auto md:-mt-4"} ${TONE[tone].cls} ${dark ? "kitchen-dark" : ""} transition-[background-color] duration-[var(--dur-3)] ease-[var(--ease-out)]`}
      style={{ "--shell-bg": TONE[tone].bg } as CSSProperties}
      onPointerDown={() => !wakeOn && onWake()}
      data-simple
      data-tone={tone}
    >
      <div className={`flex min-h-full flex-col pt-[env(safe-area-inset-top)] ${bar ? "pb-[calc(env(safe-area-inset-bottom)+11rem)]" : "pb-12"} ${overlay ? "" : "md:min-h-[calc(100dvh-8rem)]"}`}>{children}</div>
      {bar && (
        <div className={`${overlay ? "fixed" : "max-md:fixed md:sticky"} inset-x-0 bottom-0 z-30 border-t border-[color-mix(in_srgb,currentColor_14%,transparent)] bg-[var(--shell-bg)] pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-float`}>
          <div className={COLUMN}>
            <div className="md:ml-auto md:max-w-[560px]">{bar}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Le bouton principal de l’écran (barre espace). `who` : à deux, le bouton de A ou de B (touches A et B). */
export function MainButton({ children, icon, onClick, who, variant = "ink", className = "", title }: { children: ReactNode; icon?: IconName; onClick: () => void; who?: Person; variant?: ButtonVariant; className?: string; title?: string }) {
  return (
    <Button variant={variant} size="kitchen" block icon={icon} onClick={onClick} data-main={who ?? "1"} title={title} className={`min-h-[72px] py-3 text-[21px] ${className}`}>
      {children}
    </Button>
  );
}

function Head({ plan, c, stage, wake, detail, overlay, onEnd, lead, title, tone = "paper", person = null }: { plan: SessionPlan; c: Controls; stage: Stage; wake: Wake; detail: string; overlay: boolean; onEnd?: () => void; lead?: ReactNode; title?: ReactNode; tone?: Tone; person?: Person | null }) {
  const restart = useRestart(c.id);
  const progress = tempsProgress(plan, c.state);
  const temps: Temps | null = stage === "prep" || stage === "cook" || stage === "store" ? stage : null;
  const flat = tone !== "paper";
  return (
    <header className="sticky top-0 z-20 bg-[var(--shell-bg)]">
      <div className={`${COLUMN} grid gap-3 pt-3 pb-3`}>
        <div className="flex items-center gap-3">
          <Link href="/" className={`-ml-3 grid size-11 shrink-0 place-items-center rounded-[8px] opacity-80 hover:bg-[color-mix(in_srgb,currentColor_10%,transparent)] hover:opacity-100 ${overlay ? "" : "md:hidden"}`} aria-label="Accueil (la session continue)" title="Accueil (la session continue)">
            <Icon name="home" />
          </Link>
          {lead}
          <div className="min-w-0 flex-1">
            <b className="line-clamp-2 block text-[17px] leading-tight">{title ?? headTitle(plan, c, stage)}</b>
            <span className="flex items-center gap-2 text-[14px] opacity-75">
              <span className={`size-2 shrink-0 rounded-full bg-current ${c.online ? "k-live" : "opacity-40"}`} aria-hidden />
              <span className="num truncate">{c.online ? headSub(plan, c, stage) : "reconnexion…"}</span>
            </span>
          </div>
          {stage === "cook" && tone === "paper" && (
            <div className="hidden min-w-0 max-w-[60%] md:block">
              <TimerBar plan={plan} c={c} person={person} />
            </div>
          )}
          <Menu wake={wake} detail={detail} onEnd={onEnd} toCook={stage === "prep" && c.mode !== "duo" ? () => c.setStatus(c.mode === "veille" && !c.state.eveDone ? "fridge" : "cooking") : undefined} evening={c.mode === "veille" && !c.state.eveDone} restart={restart} />
        </div>
        {stage === "cook" && tone === "paper" && (
          <div className="md:hidden">
            <TimerBar plan={plan} c={c} person={person} />
          </div>
        )}
        {stage !== "fridge" && stage !== "done" && (
          <ol className="grid grid-cols-3 gap-2" aria-label="Les trois temps de la session">
            {TEMPS.map((t, i) => {
              const on = temps === t.id;
              return (
                <li key={t.id} className="grid gap-2" aria-current={on ? "step" : undefined} aria-label={`${t.label} : ${Math.round(progress[t.id] * 100)} %`}>
                  <span className="relative block h-[3px] overflow-hidden rounded-[2px] bg-[color-mix(in_srgb,currentColor_16%,transparent)]" aria-hidden>
                    <i className={`absolute inset-y-0 left-0 block transition-[width] duration-[var(--dur-3)] ease-[var(--ease-out)] ${flat || !on ? "bg-current" : "bg-accent"}`} style={{ width: `${progress[t.id] * 100}%` }} />
                  </span>
                  <span className={`label ${on ? "" : "opacity-55"}`}>
                    <span className="num">{i + 1}</span> {t.label}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </header>
  );
}

function headTitle(plan: SessionPlan, c: Controls, stage: Stage): string {
  if (stage === "done") return "Session terminée";
  if (stage === "fridge") return "Reprise";
  if (stage === "store") return "Range";
  if (stage === "prep") return c.mode === "veille" && !c.state.eveDone ? "Prépare · ce soir" : "Prépare";
  return plan.recipes.map((r) => shortName(r.name)).join(" + ");
}

function headSub(plan: SessionPlan, c: Controls, stage: Stage): string {
  if (stage === "prep") {
    const b = prepBowls(plan, c.state);
    const ready = b.filter((x) => c.state.bowlsReady.has(x.letter)).length;
    // Tous les bols remplis pendant la cuisson : pas de « 0 bol prêt sur 0 ».
    if (!b.length) return "les bols, pendant la cuisson";
    return `${ready} bol${ready > 1 ? "s" : ""} prêt${ready > 1 ? "s" : ""} sur ${b.length}`;
  }
  if (stage === "cook") return progressLine(plan, c) || `${plan.steps.length} étapes`;
  if (stage === "store") return `${plan.recipes.filter((r) => c.state.boxed.has(r.slug)).length} sur ${plan.recipes.length} en boîtes`;
  return plan.recipes.map((r) => shortName(r.name)).join(" + ");
}

/** Le menu : vue détaillée, écran allumé, passer à la cuisine, terminer. Un <details> : clavier et lecteur d’écran sans script. */
function Menu({ wake, detail, onEnd, toCook, evening, restart }: { wake: Wake; detail: string; onEnd?: () => void; toCook?: () => void; evening: boolean; restart?: ReturnType<typeof useRestart> }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute("open");
  useEffect(() => {
    const onDoc = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  const item = "flex min-h-12 w-full items-center gap-3 rounded-[8px] px-3 text-left text-[17px] hover:bg-surface-2";
  return (
    <details ref={ref} className="relative shrink-0">
      <summary className="grid size-11 cursor-pointer list-none place-items-center rounded-[8px] border border-[color-mix(in_srgb,currentColor_30%,transparent)] hover:border-current [&::-webkit-details-marker]:hidden" aria-label="Menu de la session" title="Menu de la session">
        <Icon name="sliders" />
      </summary>
      <div className="absolute top-12 right-0 z-30 grid w-72 gap-1 rounded-[14px] border border-line bg-raised p-2 text-ink shadow-float">
        <Link href={detail} className={item} onClick={close}>
          <Icon name="dash" size="s" />
          Vue détaillée
        </Link>
        {toCook && (
          <button type="button" className={item} onClick={() => (close(), toCook())}>
            <Icon name={evening ? "fridge" : "flame"} size="s" />
            {evening ? "C’est au frigo, à demain" : "Passer à la cuisine"}
          </button>
        )}
        <div className="px-2 py-1">
          <WakePill wake={wake} onInk={false} />
        </div>
        {restart && (
          <>
            <button type="button" className={`${item} border-t border-line`} disabled={restart.pending} onClick={() => (close(), restart.run(false))}>
              <Icon name="refresh" size="s" />
              {restart.pending ? "Je refais le plan…" : "Recommencer de zéro"}
            </button>
            <button type="button" className={item} disabled={restart.pending} onClick={() => (close(), restart.run(true))}>
              <Icon name="refresh" size="s" />
              <span className="grid">
                Recommencer en test
                <span className="text-[14px] text-ink-2">rien n’est compté (durées, frigo)</span>
              </span>
            </button>
          </>
        )}
        {onEnd && (
          <button type="button" className={`${item} border-t border-line`} onClick={() => (close(), onEnd())}>
            <Icon name="check" size="s" />
            Terminer la session
          </button>
        )}
      </div>
    </details>
  );
}

// ─── Écrans de transition : un aplat d’encre, de la typographie ───

function Interlude({ n, title, lines, art, qr }: { n: 1 | 2 | 3 | null; title: string; lines: string[]; art: ReactNode; qr?: { svg: string; url: string } | null }) {
  return (
    <section className={`${COLUMN} sx-enter grid flex-1 content-between gap-12 pt-12 pb-8 md:grid-cols-12 md:content-center md:gap-6`} aria-labelledby="interlude">
      <div className="grid content-start gap-6 md:col-span-7">
        {n && (
          <p className="flex items-baseline gap-4">
            <span className="sx-giant" aria-hidden>
              {n}
            </span>
            <span className="label opacity-70">Temps {n} sur 3</span>
          </p>
        )}
        <h1 id="interlude" className="text-display">
          {title}
        </h1>
        <div className="grid max-w-[34ch] gap-2 text-lead opacity-80">
          {lines.filter(Boolean).map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      </div>
      <div className="grid content-end gap-8 md:col-span-5 md:content-center md:justify-items-end">
        <div className="grid min-h-32 items-center">{art}</div>
        {qr && (
          <div className="hidden w-[180px] text-ink md:block">
            <QrCard svg={qr.svg} url={qr.url}>
              <Icon name="qr" size="s" />
              Sur ton téléphone
            </QrCard>
          </div>
        )}
      </div>
    </section>
  );
}

function FoodsArt({ plan }: { plan: SessionPlan }) {
  const items = plan.bowls.flatMap((b) => b.items).filter((i, k, all) => all.findIndex((x) => (x.food ?? x.item) === (i.food ?? i.item)) === k).slice(0, 6);
  return (
    <span className="grid max-w-[320px] grid-cols-3 gap-4">
      {items.map((i) => (
        <FoodIllu key={i.item} food={i.food} item={i.item} size="l" live label={i.item.split(/[,(]/)[0].trim()} />
      ))}
    </span>
  );
}

function DuoArt() {
  return (
    <span className="flex -space-x-3">
      <PersonMono person="A" size={72} onInk />
      <PersonMono person="B" size={72} onInk />
    </span>
  );
}

// ─── 1. Prépare : tout sur le plan de travail, par bols ───

function PrepScreen({ id, plan, c }: { id: string; plan: SessionPlan; c: Controls }) {
  const { state } = c;
  const bowls = prepBowls(plan, state);
  const next = bowls.find((b) => !state.bowlsReady.has(b.letter));
  const { plate, tasks } = prepExtras(plan, state);
  const evening = c.mode === "veille" && !state.eveDone;
  const during = evening ? [] : plan.bowls.filter((b) => b.during?.length);
  return (
    <div className={`${COLUMN} grid gap-8 pt-6 md:grid-cols-12 md:gap-6`}>
      <div className="grid content-start gap-4 md:col-span-4 md:sticky md:top-32 md:self-start">
        <h1 className="text-h1">Tout sur le plan de travail</h1>
        <p className="text-lead text-ink-2">{bowls.length ? "Remplis chaque bol, touche-le quand il est prêt. Les lettres reviennent dans les consignes." : "Sors ce qui attend sur le plateau. Les bols se remplissent plus tard, pendant la cuisson : l’écran le dira."}</p>
        <Issues plan={plan} sessionId={id} />
        {!evening && plan.prep.notes.map((n) => (
          <p key={n} className="flex items-start gap-3 border-t border-line pt-3 text-[17px]">
            <Icon name="flame" size="s" className="mt-1 shrink-0 text-ink-2" />
            {typo(n)}
          </p>
        ))}
      </div>
      <div className="grid content-start gap-12 md:col-span-8">
        <ul className="grid border-b border-line" aria-label="Bols">
          {bowls.map((b) => {
            const ready = state.bowlsReady.has(b.letter);
            const now = b === next;
            return (
              <li key={b.letter} className="border-t border-line">
                <button
                  type="button"
                  onClick={() => c.toggleBowl(b.letter)}
                  aria-pressed={ready}
                  aria-label={`Bol ${b.letter} : ${bowlName(b)}${ready ? ", prêt" : ""}`}
                  className={`sx-row grid w-full grid-cols-[64px_minmax(0,1fr)] items-start gap-4 px-3 py-4 text-left md:-mx-3 md:w-[calc(100%+24px)] ${now ? "sx-now" : ""} ${ready ? "opacity-50" : ""}`}
                >
                  <Bowl bowl={b} size="lg" ready={ready} />
                  <span className="grid min-w-0 gap-2">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="label truncate text-ink-2">{recipeOf(plan, b.recipeSlug)?.name}</span>
                      <span className={`label shrink-0 ${now ? "text-accent" : "text-ink-2"}`}>{ready ? "Prêt" : now ? "Maintenant" : ""}</span>
                    </span>
                    <span className="grid">
                      {b.items.map((i, k) => (
                        <span key={k} className={`grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 py-1 text-[17px] leading-snug ${k ? "border-t border-line" : ""}`}>
                          <FoodIllu food={i.food} item={i.item} size={40} live={now} label={i.item.split(/[,(]/)[0].trim()} />
                          <span className="min-w-0">
                            {typo(i.item)}
                            {i.optional && <span className="text-ink-2"> (facultatif)</span>}
                          </span>
                          <b className="num-tight text-right text-[20px]">{i.qty}</b>
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {(plate.length > 0 || tasks.length > 0) && (
          <section className="grid gap-4" aria-labelledby="a-part">
            <h2 id="a-part" className="label text-ink-2">
              À part, sans bol
            </h2>
            {plate.length > 0 && (
              <div className="grid border-y border-line">
                <b className="pt-3 text-[17px]">Sur le plateau</b>
                {plate.map((i, k) => (
                  <span key={k} className={`grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 py-2 text-[17px] leading-snug ${k ? "border-t border-line" : ""}`}>
                    <FoodIllu food={i.food} item={i.item} size={40} label={i.item} />
                    <span className="min-w-0">
                      {typo(`${i.item}, ${i.gesture}`)} <span className="text-ink-2">· {shortName(recipeOf(plan, i.recipeSlug)?.name)}</span>
                    </span>
                    <b className="num-tight text-right text-[20px]">{i.qty}</b>
                  </span>
                ))}
              </div>
            )}
            {tasks.length > 0 && (
              <ul className="grid border-b border-line">
                {tasks.map((t) => (
                  <li key={t.id} className="border-t border-line">
                    <TaskCheck c={c} t={t} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {during.length > 0 && (
          <p className="text-[17px] text-ink-2">
            Plus tard, pendant la cuisson : {during.map((b) => `bol ${b.letter} (${bowlName(b)})`).join(", ")}. L’écran le dira.
          </p>
        )}
        {evening && plan.bowls.some((b) => !b.fridge && !atMoment(b)) && <p className="text-[17px] text-ink-2">Demain : {plan.bowls.filter((b) => !b.fridge && !atMoment(b)).map((b) => `bol ${b.letter}`).join(", ")}.</p>}
      </div>
    </div>
  );
}

function TaskCheck({ c, t }: { c: Controls; t: PrepTask }) {
  const done = c.state.prepDone.has(t.id);
  return (
    <Check size="kitchen" strike={false} checked={done} onChange={() => c.togglePrep(t.id)} className={`sx-row w-full items-start px-3 py-4 md:-mx-3 md:w-[calc(100%+24px)] ${done ? "opacity-50" : ""} [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1`}>
      <span className="flex items-start gap-3">
        <StepIllu kind="prep" text={t.text ?? t.title} size={40} className="shrink-0" />
        <span className="grid gap-1">
          <b className="text-[17px]">{t.title}</b>
          {t.text && <span className="text-[17px] text-ink-2">{t.text}</span>}
        </span>
      </span>
    </Check>
  );
}

function PrepBar({ plan, c }: { plan: SessionPlan; c: Controls }) {
  const next = prepBowls(plan, c.state).find((b) => !c.state.bowlsReady.has(b.letter));
  const evening = c.mode === "veille" && !c.state.eveDone;
  if (next)
    return (
      <MainButton icon="check" onClick={() => c.toggleBowl(next.letter)}>
        Bol {next.letter} prêt
      </MainButton>
    );
  return (
    <MainButton icon={evening ? "fridge" : "flame"} onClick={() => c.setStatus(evening ? "fridge" : "cooking")}>
      {evening ? "C’est au frigo, à demain" : "Passer à la cuisine"}
    </MainButton>
  );
}

// ─── 2. Cuisine : une consigne à la fois ───

function CookScreen({ plan, c }: { plan: SessionPlan; c: Controls }) {
  const { focus } = c;
  if (!focus) return null;
  return (
    <div className={`${COLUMN} grid gap-12 pt-6 md:grid-cols-12 md:gap-6`}>
      <div className="min-w-0 md:col-span-7">
        <StepNow plan={plan} c={c} step={focus} />
      </div>
      <aside className="grid min-w-0 content-start gap-8 md:col-span-5 md:sticky md:top-40 md:self-start">
        <Lanes plan={plan} c={c} focus={focus} />
      </aside>
    </div>
  );
}

/** L’étape à faire maintenant : la sous-étape en cours en très grand (sinon la première phrase), ses cadrans (minuteur, feu, four), ses bols. */
export function StepNow({ plan, c, step }: { plan: SessionPlan; c: Controls; step: PlanStep }) {
  const { state, now, cookingStart } = c;
  const st = stepStatus(state, step.id);
  const n = st === "active" ? currentPhase(state, step) : null;
  const phase = n != null ? step.phases![n] : null;
  const { head, rest } = stepHead(step);
  const batch = st === "active" ? batchOf(state, step) : null;
  const late = st === "todo" ? Math.round((now - (cookingStart + step.startMin * 60000)) / 60000) : 0;
  const consigne = phase?.text ?? head;
  return (
    <article key={`${step.id}:${n ?? "-"}`} className="sx-swap grid gap-6" aria-live="polite">
      <header className="flex items-center gap-4">
        <StepIllu kind={step.kind} text={phase?.text ?? step.text} size={80} live={st === "active"} className="illu-tile shrink-0" style={{ "--tile": stepColor(plan, step) }} />
        <RecipeContext plan={plan} step={step} status={st} extra={[batch ? `fournée ${batch.at} sur ${batch.of}` : st === "todo" ? batchesLabel(step)?.toLocaleLowerCase("fr") : null, late > 2 ? `${late} min de retard` : null].filter(Boolean).join(" · ") || null} />
      </header>
      <div className="grid gap-3">
        {phase && <p className="text-[17px] leading-snug text-ink-2"><BowlText plan={plan} text={head} ready={state.bowlsReady} /></p>}
        {n != null && <p className="label text-accent">Sous-étape {n + 1} sur {step.phases!.length} · <AttentionTag a={attentionOf(step, n)} className="!text-current" /></p>}
        <h1 className="sx-consigne">
          <BowlText plan={plan} text={consigne} ready={state.bowlsReady} />
        </h1>
        {phase?.wait && <p className="text-lead text-ink-2">Attente : fais autre chose, ça sonnera.</p>}
        {!phase && rest && !step.phases?.length && <p className="text-lead"><BowlText plan={plan} text={rest} ready={state.bowlsReady} /></p>}
        {step.phases && step.phases.length > 1 && st === "todo" && <p className="text-lead text-ink-2">{step.phases.length} sous-étapes, une à la fois. Aucun minuteur ne part tout seul.</p>}
      </div>
      {step.phases && step.phases.length > 1 && st === "active" && <PhaseTrack step={step} n={n} c={c} />}
      {n != null && <PhaseNext step={step} n={n} running={Boolean(phaseTimer(state, step.id, n))} />}
      <Dials plan={plan} c={c} step={step} level={phase?.hobLevel ?? null} />
      <SharedSplit plan={plan} step={step} now={n != null && n === step.phases!.length - 1} />
      <TakeBowls plan={plan} step={step} ready={state.bowlsReady} phase={n} />
      {wantsDropGuide(step, n, st === "active") && <DropGuide onInk />}
      {step.notes.map((x) => (
        <p key={x} className="flex items-start gap-3 border-t border-line pt-3 text-[17px]">
          <Icon name={x.startsWith("Relais") ? "swap" : "info"} size="s" className="mt-1 shrink-0 text-ink-2" />
          {x}
        </p>
      ))}
      {(step.cue || (Boolean(step.phases?.length) && rest)) && (
        <details className="group border-y border-line text-[17px]">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 font-bold [&::-webkit-details-marker]:hidden">
            {step.cue ? "Repère et consigne complète" : "Toute la consigne"}
            <Icon name="chev" size="s" className="transition-transform duration-[var(--dur-1)] group-open:rotate-90" />
          </summary>
          <div className="grid gap-2 pb-4 leading-snug">
            {step.cue && <p className="font-bold">«&nbsp;{step.cue}&nbsp;»</p>}
            {step.phases?.length ? <p className="text-ink-2">{step.text}</p> : null}
          </div>
        </details>
      )}
    </article>
  );
}

/** Sous-étapes : un segment par sous-étape (faite, en cours en cocotte, à venir), et « 2 sur 5 ». */
function PhaseTrack({ step, n, c }: { step: PlanStep; n: number | null; c: Controls }) {
  const len = step.phases!.length;
  return (
    <div className="flex items-center gap-4" aria-label={n != null ? `Sous-étape ${n + 1} sur ${len}` : `${len} sous-étapes faites`}>
      <span className="grid flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${len}, minmax(0, 1fr))` }} aria-hidden>
        {step.phases!.map((_, i) => (
          <i key={i} className={`block h-1 rounded-[2px] transition-colors duration-[var(--dur-2)] ${i === n ? "bg-accent" : c.state.phasesDone.has(`${i}:${step.id}`) ? "bg-ink" : "bg-line-strong"}`} />
        ))}
      </span>
      <span className="label shrink-0 text-ink-2">{n != null ? <><span className="num">{n + 1}</span> sur <span className="num">{len}</span></> : "fini"}</span>
    </div>
  );
}

const equipIcon = (s: PlanStep): IconName => (s.equipmentId?.startsWith("plat") || s.oven ? "oven" : s.equipmentId?.startsWith("poele") ? "pan" : "pot");

/** Un cadran : une étiquette, un chiffre géant, un complément. */
function Dial({ label, children, foot }: { label: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-2">
      <span className="label flex items-center gap-2 text-ink-2">{label}</span>
      {children}
      {foot}
    </div>
  );
}

/** Les cadrans de l’étape, lus à un mètre : minuteur (ou durée), feu et niveau, four. */
function Dials({ plan, c, step, level }: { plan: SessionPlan; c: Controls; step: PlanStep; level: number | null }) {
  const { state, now } = c;
  const st = stepStatus(state, step.id);
  const n = st === "active" ? currentPhase(state, step) : null;
  const raw = (n != null ? phaseTimer(state, step.id, n) : undefined) ?? stepTimer(state, step.id);
  const t = raw && liveTimer(raw, now);
  const lv = level ?? (step.hobLevelLabel ? null : step.hobLevel);
  const dials: ReactNode[] = [];
  if (st === "todo") {
    if (step.durationMin >= 1)
      dials.push(
        <Dial key="t" label={<><Icon name="clock" size="s" />Durée</>}>
          <span className="sx-giant text-ink-2">{Math.round(step.durationMin)}<span className="text-[0.4em]">&nbsp;min</span></span>
        </Dial>
      );
  } else if (t) {
    const left = Math.max(0, t.endsAt - now);
    const paused = t.pausedAt != null;
    const foot = (
      <span className="flex flex-wrap gap-3">
        <Button size="kitchen" variant="secondary" icon="plus" onClick={() => c.addMinutes(t, 1)} aria-label="Une minute de plus" className="w-fit">1 min</Button>
        <Button size="kitchen" variant={paused ? "primary" : "quiet"} icon={paused ? "play" : "pause"} onClick={() => c.pauseTimer(t)} aria-pressed={paused} data-action={paused ? "reprendre-minuteur" : "pause-minuteur"} className="w-fit">{paused ? "Reprendre" : "Pause"}</Button>
      </span>
    );
    dials.push(
      <Dial key="t" label={<><Icon name="clock" size="s" />{phase(step, n)?.wait ? "Attente" : "Minuteur"} · {paused ? "en pause" : `fin ${clock(t.endsAt)}`}</>} foot={foot}>
        <span className={`sx-giant ${paused ? "text-ink-2" : ""}`} role="timer" aria-label={`Minuteur${paused ? " en pause" : ""} : ${mmss(left)}`}>
          {mmss(left)}
        </span>
      </Dial>
    );
  } else if (n != null && !(step.phases![n].min < 1 && !timedPhase(step.phases![n]))) {
    dials.push(
      <Dial key="t" label={<><Icon name="clock" size="s" />{timedPhase(step.phases![n]) ? "Minuteur pas lancé" : "Sans minuteur"}</>}>
        {timedPhase(step.phases![n]) ? (
          <span className="sx-giant text-ink-2">{fmtMin(step.phases![n].min).replace(" min", "")}<span className="text-[0.4em]">&nbsp;{step.phases![n].min < 1 ? "" : "min"}</span></span>
        ) : (
          <span className="text-lead text-ink-2">« Fait » quand c’est fait</span>
        )}
      </Dial>
    );
  }
  if (step.hobId)
    dials.push(
      <Dial key="h" label={<><Icon name={equipIcon(step)} size="s" />{hobName(plan, step.hobId)}</>} foot={lv != null ? <LevelBars level={lv} /> : null}>
        {lv != null ? <span className="sx-giant" aria-label={`Niveau ${lv} sur 9`}>{lv}</span> : step.hobLevelLabel ? <span className="num-tight text-num-xl">{step.hobLevelLabel}</span> : <span className="text-lead">{step.equipmentName}</span>}
      </Dial>
    );
  if (step.oven)
    dials.push(
      <Dial key="o" label={<><Icon name="oven" size="s" />Four{step.oven.levels.length ? ` · gradin ${step.oven.levels.join(" et ")}` : ""}</>}>
        <span className="sx-giant">{step.oven.temp}<span className="text-[0.45em]">&nbsp;°C</span></span>
      </Dial>
    );
  if (!dials.length && !step.equipmentName) return null;
  return (
    <div className="grid gap-4 border-t border-line pt-6">
      <div className="flex flex-wrap items-start gap-x-12 gap-y-8">{dials}</div>
      {step.equipmentName && step.kind !== "preheat" && (
        <p className="flex items-center gap-2 text-[17px] text-ink-2">
          <Icon name={equipIcon(step)} size="s" />
          {step.equipmentName}
        </p>
      )}
    </div>
  );
}

const phase = (step: PlanStep, n: number | null) => (n != null ? step.phases?.[n] : undefined);

/** Les 9 crans de l’induction, ceux du niveau en encre. */
function LevelBars({ level }: { level: number }) {
  const lv = Math.max(0, Math.min(9, Math.round(level)));
  return (
    <span className="flex items-end gap-1" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} className={`block w-2 rounded-[1px] ${i < lv ? "bg-ink" : "bg-line-strong"}`} style={{ height: 6 + i * 2.5 }} />
      ))}
    </span>
  );
}


function CookBar({ plan, c }: { plan: SessionPlan; c: Controls }) {
  const { focus } = c;
  if (!focus) return null;
  return <ActionBar plan={plan} c={c} step={focus} person={null} />;
}

/**
 * La barre du bas d’une étape : le bouton principal (espace) dit ce qu’il fait (« Lance 8 min : … »,
 * « Fait : bol G versé »), sa conséquence en dessous ; le retour dit ce qu’il défait (←) ; le geste de
 * rechange (« Fait, sans minuteur »). `who` : à deux sur grand écran, le bouton de A ou de B.
 */
export function ActionBar({ plan, c, step, person, who }: { plan: SessionPlan; c: Controls; step: PlanStep; person: Person | null; who?: Person }) {
  const a = c.actionOf(step);
  const u = c.undo(person);
  const last = a.kind === "finish" && plan.steps.every((s) => s.id === step.id || stepStatus(c.state, s.id) === "done");
  const icon: IconName = a.kind === "start" ? "play" : a.kind === "phase-timer" || a.kind === "passive" ? "clock" : "check";
  return (
    <div className="grid gap-2">
      <MainButton icon={icon} who={who} onClick={() => c.act(step, person)} className="!whitespace-normal leading-tight" title={a.hint}>
        {last ? `C’est cuit : ${a.label.replace(/^Fait : /, "")}` : a.label}
      </MainButton>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => c.back(person)} disabled={!u} title={u ? `${u.detail} (flèche gauche)` : "Rien à défaire"} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[8px] px-2 text-left text-[15px] leading-tight opacity-85 hover:opacity-100 disabled:opacity-35">
          <Icon name="chev" size="s" className="shrink-0 rotate-180" />
          <span className="min-w-0">{u ? u.label : "Rien à défaire"}</span>
        </button>
        {a.alt && (
          <button type="button" onClick={() => c.act(step, person, true)} className="min-h-11 shrink-0 rounded-[8px] border border-[color-mix(in_srgb,currentColor_30%,transparent)] px-3 text-[15px] font-bold hover:border-current">
            {a.alt.label}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Ça sonne : l’étape revient au premier plan, sur un aplat tomate ───

export const personOf = (plan: SessionPlan, t: TimerState): Person | null => {
  const s = t.stepId ? plan.steps.find((x) => x.id === t.stepId) : undefined;
  return s ? (s.person ?? "A") : null;
};

export function Ringing({ plan, c, timers }: { plan: SessionPlan; c: Controls; timers: TimerState[] }) {
  const [t, ...others] = timers;
  return (
    <section key={t.id} className={`${COLUMN} sx-ring grid flex-1 content-start gap-8 pt-8 md:grid-cols-12 md:gap-6`} role="alert" aria-label="Minuteur terminé">
      <div className="grid content-start gap-6 md:col-span-8">
        <p className="label flex items-center justify-between gap-3">
          <span className="flex items-center gap-3">
            <Icon name="bell" className="sx-bell" />
            Ça sonne
          </span>
          <span className="num" aria-label={`Fini il y a ${mmss(c.now - t.endsAt)}`}>+{mmss(c.now - t.endsAt)}</span>
        </p>
        <RingDetails plan={plan} c={c} t={t} />
      </div>
      {others.length > 0 && (
        <ul className="grid border-b border-[color-mix(in_srgb,currentColor_30%,transparent)] md:col-span-8">
          {others.map((o) => (
            <li key={o.id} className="border-t border-[color-mix(in_srgb,currentColor_30%,transparent)]">
              <button type="button" onClick={() => c.stopTimer(o)} className="flex min-h-16 w-full items-center justify-between gap-3 text-left text-[17px] font-bold">
                <span className="min-w-0">Aussi fini : {ringInfo(plan, c.state, o).finished}</span>
                <span className="label shrink-0 opacity-80">Arrêter</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RingBar({ plan, c, t, who }: { plan: SessionPlan; c: Controls; t: TimerState; who?: Person }) {
  const info = ringInfo(plan, c.state, t);
  if (!info.chain)
    return (
      <MainButton icon="check" who={who} onClick={() => c.stopTimer(t)} className="!whitespace-normal leading-tight">
        {info.stop}
      </MainButton>
    );
  return (
    <div className="grid gap-2">
      <MainButton icon="clock" who={who} onClick={() => c.stopTimer(t, true)} className="!whitespace-normal leading-tight">
        {info.chain.label}
      </MainButton>
      <button type="button" onClick={() => c.stopTimer(t)} className="min-h-11 rounded-[8px] px-2 text-[15px] font-bold opacity-90 hover:opacity-100">
        {info.stop}
      </button>
    </div>
  );
}

// ─── 3. Range : boîtes et frigo ───

function StoreScreen({ plan, c, storage }: { plan: SessionPlan; c: Controls; storage: RecipeStorage[] }) {
  const dishes = useContext(DishArts);
  return (
    <div className={`${COLUMN} grid gap-8 pt-6 md:grid-cols-12 md:gap-6`}>
      <div className="grid content-start gap-4 md:col-span-4">
        <h1 className="text-h1">Ranger</h1>
        <p className="text-lead text-ink-2">Laisse tiédir à découvert, 2&nbsp;h au plus. Ferme, note la date, au frigo.</p>
      </div>
      <ul className="grid content-start border-b border-line md:col-span-8" aria-label="Plats à ranger">
        {plan.recipes.map((r) => {
          const done = c.state.boxed.has(r.slug);
          const s = storage.find((x) => x.slug === r.slug);
          return (
            <li key={r.slug} className="border-t border-line">
              <Check
                size="kitchen"
                strike={false}
                checked={done}
                onChange={() => c.send([{ kind: "note", payload: { boxed: r.slug, ...(done ? { undo: true } : {}) } }])}
                className={`sx-row w-full items-center px-3 py-4 md:-mx-3 md:w-[calc(100%+24px)] ${done ? "opacity-50" : ""} [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1`}
              >
                <span className="flex items-center gap-4">
                  {dishes[r.slug] ?? <BoxGlyph color={r.color} size={56} />}
                  <span className="grid min-w-0 gap-1">
                    <b className="text-h3 leading-tight">{r.name}</b>
                    <span className="text-[17px] text-ink-2">{s ? storageLine(s) : "en boîtes, au frigo"}</span>
                  </span>
                </span>
              </Check>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ConfirmEnd({ plan, storage }: { plan: SessionPlan; storage: RecipeStorage[] }) {
  const boxes = storage.reduce((x, s) => x + s.meals, 0);
  return (
    <section className={`${COLUMN} sx-enter grid flex-1 content-center gap-6 py-12 md:grid-cols-12`} aria-labelledby="fin">
      <div className="grid gap-6 md:col-span-8">
        <p className="label opacity-70">Fin de session</p>
        <h1 id="fin" className="text-display">
          Tout est rangé&nbsp;?
        </h1>
        <p className="max-w-[36ch] text-lead opacity-80">
          {plan.recipes.length} plat{plan.recipes.length > 1 ? "s" : ""}
          {boxes ? `, environ ${boxes} boîtes` : ""}. La session se termine sur tous les écrans ; ses durées corrigent les prochaines.
        </p>
      </div>
    </section>
  );
}

function Done({ plan, c, detail }: { plan: SessionPlan; c: Controls; detail: string }) {
  const test = useContext(SessionTest) != null;
  return (
    <div className={`${COLUMN} grid gap-12 pt-8`}>
      <FridgeDone plan={plan} events={c.events} test={test} />
      {/* Peser les marmites : grammes par boîte de chacun, puis les boîtes rangées au frigo ou au congélo (pas en session test). */}
      {!test && <SessionBoxes id={c.id} plan={plan} kitchen />}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
        <Link href={detail} className="inline-flex min-h-tap items-center gap-2 rounded-[8px] border border-line-strong px-4 font-bold hover:border-ink hover:bg-surface">
          <Icon name="clock" size="s" />
          Voir le bilan
        </Link>
        <Link href="/frigo" className="inline-flex min-h-tap items-center gap-2 rounded-[8px] border border-line-strong px-4 font-bold hover:border-ink hover:bg-surface">
          <Icon name="fridge" size="s" />
          Voir le frigo
        </Link>
        <Button variant="quiet" icon="refresh" onClick={() => c.setStatus("cooking")}>
          Rouvrir la session
        </Button>
        <RestartButtons id={c.id} />
      </div>
    </div>
  );
}

// ─── Prep la veille : la reprise ───

function Fridge({ plan, c, choice }: { plan: SessionPlan; c: Controls; choice: DayChoice | null }) {
  const inFridge = plan.bowls.filter((b) => c.state.bowlsReady.has(b.letter));
  return (
    <div className={`${COLUMN} grid gap-8 pt-8 md:grid-cols-12 md:gap-6`}>
      <div className="grid content-start gap-4 md:col-span-5">
        <p className="label text-ink-2">
          <Icon name="moonset" size="s" className="mr-2 inline align-[-3px]" />
          Prep d’hier terminée
        </p>
        <h1 className="text-h1">
          {inFridge.length} bol{inFridge.length > 1 ? "s" : ""} au frigo
        </h1>
        <p className="text-lead text-ink-2">Le jour J : le reste de la prep, puis la cuisine.</p>
      </div>
      <div className="grid content-start gap-8 md:col-span-7">
        <ResumeChoice plan={plan} c={c} choice={choice} big />
        <ul className="grid border-b border-line" aria-label="Au frigo">
          {inFridge.map((b) => (
            <li key={b.letter} className="flex items-center gap-4 border-t border-line py-3">
              <Bowl bowl={b} size="lg" ready />
              <span className="flex flex-wrap gap-1">
                {b.items.slice(0, 4).map((i, k) => (
                  <FoodIllu key={k} food={i.food} item={i.item} size={40} label={i.item} />
                ))}
              </span>
              <span className="min-w-0 truncate text-[17px]">{bowlName(b)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export { Head as SimpleHead };
