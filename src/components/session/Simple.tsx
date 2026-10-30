"use client";

// Vue simple d'une session, téléphone d'abord (la vue par défaut ; ?vue=detail pour la vue détaillée).
// Trois temps plein écran : Prépare (tout sur le plan de travail, par bols), Cuisine (une consigne à la
// fois, en grand, son minuteur en pastille et « Suivant ») et Range (boîtes et frigo) ; une barre en
// trois segments, un écran sobre entre deux temps, une confirmation de fin. Le planificateur ne change
// pas : parallélisme, minuteurs, sous-étapes et mode à deux sont là, mais l'écran ne montre que ce qu'il
// faut faire maintenant et ce qui sonne bientôt. Une attente qui sonne revient au premier plan.
// Sur téléphone (ou ?vue=telephone), la vue couvre la navigation ; sombre pendant la cuisson.
// Barre espace : le bouton principal de l'écran ([data-main]) ; flèche gauche : retour.
import Link from "next/link";
import { useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { modeOf, type Person, type PlanStep, type PrepTask, type SessionPlan } from "@/lib/session/planner";
import { backgroundSteps, batchOf, currentPhase, passiveMin, phaseTimer, stepStatus, stepTimer, type TimerState } from "@/lib/session/state";
import { prepBowls, prepExtras, soonTimers, stageOf, storageLine, TEMPS, tempsProgress, type RecipeStorage, type Stage, type Temps } from "@/lib/session/flow";
import { Button, Check, Icon, Induction, OvenLevel, Progress, RecipeTile, type IconName } from "@/components/ui";
import { FoodIllu, StepIllu } from "@/components/illus/Illu";
import type { Controls, DayChoice } from "./SessionApp";
import { Issues, progressLine, ResumeChoice, timerMinutes } from "./blocks";
import { DropGuide, wantsDropGuide } from "./DropGuide";
import { FridgeDone } from "./FridgeDone";
import { SessionBoxes } from "./SessionBoxes";
import { DuoPick } from "./DuoView";
import { SimpleDuo } from "./SimpleDuo";
import { Bowl, bowlName, bowlOf, clock, dur, Eyebrow, hobName, mmss, PersonMono, QrCard, recipeOf, SessionTest, shortName, splitStep, stepColor, stepTitle, useRingAlarm, useWakeLock, WakePill } from "./parts";

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
  const dark = (p.overlay || small) && stage === "cook";
  const detail = `?vue=detail${p.person ? `&personne=${p.person}` : ""}`;

  let body: ReactNode;
  let bar: ReactNode = null;
  if (confirming && stage !== "done") {
    body = <ConfirmEnd plan={plan} storage={p.storage} />;
    bar = (
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2.5">
        <Button size="kitchen" variant="secondary" onClick={() => setConfirming(false)}>
          Pas encore
        </Button>
        <MainButton icon="check" onClick={() => c.setStatus("done")}>
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
      body = <Interlude n={null} title="À deux, chacun son fil" lines={[`${plan.recipes.map((r) => r.name).join(", ")}.`, `Chacun voit ce qu'il fait maintenant, le reste suit tout seul. Environ ${dur(plan.totalMin)} en tout.`]} art={<DuoArt />} qr={p.person ? null : p.qr} />;
      bar = <MainButton icon="play" onClick={() => markSeen("duo")}>C&apos;est parti</MainButton>;
    } else return <SimpleDuo plan={plan} c={c} person={p.person} overlay={p.overlay} dark={dark} wake={wake} detail={detail} onEnd={() => setConfirming(true)} ringing={ringing} />;
  } else if (stage === "prep") {
    const fresh = prepBowls(plan, c.state).every((b) => !c.state.bowlsReady.has(b.letter)) && c.state.prepDone.size === 0;
    if (fresh && !seen.has("prep")) {
      const bowls = prepBowls(plan, c.state);
      const evening = c.mode === "veille" && !c.state.eveDone;
      body = (
        <Interlude
          n={1}
          title={evening ? "Prépare, ce soir" : "Prépare"}
          lines={[`Sors tout et remplis les bols : ${bowls.length} bol${bowls.length > 1 ? "s" : ""}, environ ${dur(evening ? (plan.prep.eveMin ?? 0) : plan.prep.minutes)}.`, evening ? "Ce soir, ce qui se garde au frigo ; demain, le reste puis la cuisson." : "Ensuite, la cuisine se fait une consigne à la fois."]}
          art={<FoodsArt plan={plan} />}
          qr={p.qr}
        />
      );
      bar = <MainButton icon="play" onClick={() => markSeen("prep")}>C&apos;est parti</MainButton>;
    } else {
      body = <PrepScreen id={p.id} plan={plan} c={c} />;
      bar = <PrepBar plan={plan} c={c} />;
    }
  } else if (ringing.length) {
    body = <Ringing plan={plan} c={c} timers={ringing} />;
    bar = <RingBar plan={plan} c={c} t={ringing[0]} />;
  } else if (stage === "cook") {
    if (plan.steps.every((s) => stepStatus(c.state, s.id) === "todo") && !seen.has("cook")) {
      body = <Interlude n={2} title="Cuisine" lines={[`${plan.steps.length} étapes, une à la fois : l'écran dit quoi faire et sonne quand c'est prêt.`, progressLine(plan, c)]} art={<StepIllu kind="sear" text="Poêle" size={120} live />} />;
      bar = <MainButton icon="play" onClick={() => markSeen("cook")}>Première étape</MainButton>;
    } else {
      body = <CookScreen plan={plan} c={c} />;
      bar = <CookBar plan={plan} c={c} />;
    }
  } else if (stage === "store") {
    if (c.state.boxed.size === 0 && !seen.has("store")) {
      body = <Interlude n={3} title="Range" lines={["Tout est cuit.", "Laisse tiédir, mets en boîtes, au frigo."]} art={<StepIllu id="portion" size={120} live />} />;
      bar = <MainButton icon="play" onClick={() => markSeen("store")}>On range</MainButton>;
    } else {
      body = <StoreScreen plan={plan} c={c} storage={p.storage} />;
      bar = <MainButton icon="check" onClick={() => setConfirming(true)}>Terminer la session</MainButton>;
    }
  }

  return (
    <Shell overlay={p.overlay} dark={dark} wakeOn={wake.on} onWake={() => void wake.request()} bar={bar}>
      <Head plan={plan} c={c} stage={stage} wake={wake} detail={detail} overlay={p.overlay} onEnd={stage !== "done" ? () => setConfirming(true) : undefined} />
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

export function Shell({ overlay, dark, wakeOn, onWake, bar, wide = false, children }: { overlay: boolean; dark: boolean; wakeOn: boolean; onWake: () => void; bar: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <div
      className={`${overlay ? "fixed inset-0 z-30 overflow-y-auto" : "max-md:fixed max-md:inset-0 max-md:z-30 max-md:overflow-y-auto md:-mt-4"} bg-bg text-ink ${dark ? "kitchen-dark" : ""}`}
      onPointerDown={() => !wakeOn && onWake()}
      data-simple
    >
      <div className={`mx-auto flex min-h-full ${wide ? "max-w-5xl" : "max-w-xl"} flex-col pt-[env(safe-area-inset-top)] ${bar ? "pb-[calc(env(safe-area-inset-bottom)+8rem)]" : "pb-10"} ${overlay ? "" : "md:min-h-[calc(100dvh-8rem)]"}`}>{children}</div>
      {bar && (
        <div className={`${overlay ? "fixed" : "max-md:fixed md:sticky"} inset-x-0 bottom-0 z-30 border-t border-line bg-[color-mix(in_srgb,var(--c-bg)_92%,transparent)] px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-md`}>
          <div className="mx-auto max-w-xl">{bar}</div>
        </div>
      )}
    </div>
  );
}

/** Le bouton principal de l'écran (barre espace). `who` : à deux, le bouton de A ou de B (touches A et B). */
export function MainButton({ children, icon, onClick, who, className = "" }: { children: ReactNode; icon?: IconName; onClick: () => void; who?: Person; className?: string }) {
  return (
    <Button variant="ink" size="kitchen" block icon={icon} onClick={onClick} data-main={who ?? "1"} className={`min-h-[76px] text-[21px] ${className}`}>
      {children}
    </Button>
  );
}

function Head({ plan, c, stage, wake, detail, overlay, onEnd, lead, title }: { plan: SessionPlan; c: Controls; stage: Stage; wake: Wake; detail: string; overlay: boolean; onEnd?: () => void; lead?: ReactNode; title?: ReactNode }) {
  const progress = tempsProgress(plan, c.state);
  const temps: Temps | null = stage === "prep" || stage === "cook" || stage === "store" ? stage : null;
  return (
    <header className="sticky top-0 z-20 grid gap-2.5 bg-[color-mix(in_srgb,var(--c-bg)_94%,transparent)] px-4 pt-3 pb-2.5 backdrop-blur-md">
      <div className="flex items-center gap-2.5">
        <Link href="/" className={`-ml-2 grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink ${overlay ? "" : "md:hidden"}`} aria-label="Accueil (la session continue)" title="Accueil (la session continue)">
          <Icon name="home" />
        </Link>
        {lead}
        <div className="min-w-0 flex-1">
          <b className="block truncate font-display text-[17px] [font-stretch:100%]">{title ?? headTitle(plan, c, stage)}</b>
          <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
            <span className={`size-2 shrink-0 rounded-full bg-current ${c.online ? "k-live" : "opacity-40"}`} aria-hidden />
            <span className="truncate">{c.online ? headSub(plan, c, stage) : "reconnexion…"}</span>
          </span>
        </div>
        <Menu wake={wake} detail={detail} onEnd={onEnd} toCook={stage === "prep" && c.mode !== "duo" ? () => c.setStatus(c.mode === "veille" && !c.state.eveDone ? "fridge" : "cooking") : undefined} evening={c.mode === "veille" && !c.state.eveDone} />
      </div>
      {stage !== "fridge" && stage !== "done" && (
        <ol className="grid grid-cols-3 gap-1.5" aria-label="Les trois temps de la session">
          {TEMPS.map((t) => (
            <li key={t.id} className="grid gap-1" aria-current={temps === t.id ? "step" : undefined}>
              <Progress value={progress[t.id]} label={`${t.label} : ${Math.round(progress[t.id] * 100)} %`} />
              <span className={`text-[12px] ${temps === t.id ? "font-bold text-ink" : "text-ink-2"}`}>{t.label}</span>
            </li>
          ))}
        </ol>
      )}
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
    return `${ready} bol${ready > 1 ? "s" : ""} prêt${ready > 1 ? "s" : ""} sur ${b.length}`;
  }
  if (stage === "cook") return progressLine(plan, c) || `${plan.steps.length} étapes`;
  if (stage === "store") return `${plan.recipes.filter((r) => c.state.boxed.has(r.slug)).length} sur ${plan.recipes.length} en boîtes`;
  return plan.recipes.map((r) => shortName(r.name)).join(" + ");
}

/** Le menu : vue détaillée, écran allumé, passer à la cuisine, terminer. Un <details> : clavier et lecteur d'écran sans script. */
function Menu({ wake, detail, onEnd, toCook, evening }: { wake: Wake; detail: string; onEnd?: () => void; toCook?: () => void; evening: boolean }) {
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
  const item = "flex min-h-12 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-[15px] font-semibold hover:bg-surface-2";
  return (
    <details ref={ref} className="relative shrink-0">
      <summary className="grid size-11 cursor-pointer list-none place-items-center rounded-full border border-line-strong text-ink hover:bg-surface-2 [&::-webkit-details-marker]:hidden" aria-label="Menu de la session" title="Menu de la session">
        <Icon name="sliders" />
      </summary>
      <div className="absolute top-12 right-0 z-30 grid w-64 gap-1 rounded-[14px] border border-line bg-raised p-2 shadow-e2">
        <Link href={detail} className={item} onClick={close}>
          <Icon name="dash" size="s" />
          Vue détaillée
        </Link>
        {toCook && (
          <button type="button" className={item} onClick={() => (close(), toCook())}>
            <Icon name={evening ? "fridge" : "flame"} size="s" />
            {evening ? "C'est au frigo, à demain" : "Passer à la cuisine"}
          </button>
        )}
        <div className="px-1.5 py-1">
          <WakePill wake={wake} onInk={false} />
        </div>
        {onEnd && (
          <button type="button" className={item} onClick={() => (close(), onEnd())}>
            <Icon name="check" size="s" />
            Terminer la session
          </button>
        )}
      </div>
    </details>
  );
}

// ─── Écrans de transition ───

function Interlude({ n, title, lines, art, qr }: { n: 1 | 2 | 3 | null; title: string; lines: string[]; art: ReactNode; qr?: { svg: string; url: string } | null }) {
  return (
    <section className="grid flex-1 animate-[k-fade_300ms_ease-out] content-center justify-items-center gap-5 px-6 py-8 text-center" aria-labelledby="interlude">
      {n && <Eyebrow>Temps {n} sur 3</Eyebrow>}
      <div className="grid min-h-32 place-items-center">{art}</div>
      <h1 id="interlude" className="font-display text-[clamp(2.5rem,12vw,3.5rem)] leading-none font-extrabold tracking-[-0.02em] [font-stretch:88%]">
        {title}
      </h1>
      <div className="grid max-w-[34ch] gap-1.5 text-[18px] leading-snug text-ink-2">
        {lines.filter(Boolean).map((l) => (
          <p key={l}>{l}</p>
        ))}
      </div>
      {qr && (
        <div className="hidden w-[180px] md:block">
          <QrCard svg={qr.svg} url={qr.url}>
            <Icon name="qr" size="s" />
            Sur ton téléphone
          </QrCard>
        </div>
      )}
    </section>
  );
}

function FoodsArt({ plan }: { plan: SessionPlan }) {
  const items = plan.bowls.flatMap((b) => b.items).filter((i, k, all) => all.findIndex((x) => (x.food ?? x.item) === (i.food ?? i.item)) === k).slice(0, 6);
  return (
    <span className="flex max-w-[300px] flex-wrap justify-center gap-2">
      {items.map((i) => (
        <FoodIllu key={i.item} food={i.food} item={i.item} size="l" live label={i.item.split(/[,(]/)[0].trim()} />
      ))}
    </span>
  );
}

function DuoArt() {
  return (
    <span className="flex -space-x-3">
      <PersonMono person="A" size={72} />
      <PersonMono person="B" size={72} />
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
    <div className="grid gap-4 px-4 pt-2">
      <div className="grid gap-1">
        <h1 className="font-display text-[clamp(1.75rem,8vw,2.25rem)] leading-tight font-extrabold [font-stretch:92%]">Tout sur le plan de travail</h1>
        <p className="text-[16px] text-ink-2">Remplis chaque bol et touche-le quand il est prêt. Les lettres reviennent dans les consignes.</p>
      </div>
      <Issues plan={plan} sessionId={id} />
      {!evening && plan.prep.notes.map((n) => (
        <p key={n} className="flex items-start gap-2 rounded-[12px] border border-line px-3.5 py-2.5 text-[15px]">
          <Icon name="flame" size="s" className="mt-0.5 shrink-0 text-hot" />
          {n}
        </p>
      ))}
      <ul className="grid gap-2.5" aria-label="Bols">
        {bowls.map((b) => {
          const ready = state.bowlsReady.has(b.letter);
          return (
            <li key={b.letter}>
              <button
                type="button"
                onClick={() => c.toggleBowl(b.letter)}
                aria-pressed={ready}
                aria-label={`Bol ${b.letter} : ${bowlName(b)}${ready ? ", prêt" : ""}`}
                className={`grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-3.5 rounded-[16px] border-2 bg-surface p-3.5 text-left transition-[opacity,border-color] duration-[var(--dur-base)] active:scale-[0.99] ${b === next ? "border-ink" : "border-line hover:border-line-strong"} ${ready ? "opacity-60" : ""}`}
              >
                <Bowl bowl={b} size="lg" ready={ready} />
                <span className="grid min-w-0 gap-1.5">
                  <span className="flex items-baseline justify-between gap-2 text-[13px] text-ink-2">
                    <span className="truncate">{recipeOf(plan, b.recipeSlug)?.name}</span>
                    <span className="shrink-0 font-semibold">{ready ? "prêt" : b === next ? "maintenant" : ""}</span>
                  </span>
                  {b.items.map((i, k) => (
                    <span key={k} className="flex items-center gap-2.5 text-[16px] leading-tight">
                      <FoodIllu food={i.food} item={i.item} size={36} live={b === next} className="shrink-0" label={i.item.split(/[,(]/)[0].trim()} />
                      <span className="min-w-0">
                        {i.qty && <b className="num">{i.qty} </b>}
                        {i.item}
                        {i.optional && <span className="text-ink-2"> (facultatif)</span>}
                      </span>
                    </span>
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {(plate.length > 0 || tasks.length > 0) && (
        <section className="grid gap-2.5" aria-label="À part">
          <Eyebrow>À part, sans bol</Eyebrow>
          {plate.length > 0 && (
            <div className="grid gap-2 rounded-[16px] border border-dashed border-line-strong p-3.5">
              <b className="text-[15px]">Sur le plateau</b>
              {plate.map((i, k) => (
                <span key={k} className="flex items-center gap-2.5 text-[16px] leading-tight">
                  <FoodIllu food={i.food} item={i.item} size={36} className="shrink-0" label={i.item} />
                  <span className="min-w-0">
                    {i.qty && <b className="num">{i.qty} </b>}
                    {i.item}, {i.gesture} <span className="text-ink-2">· {shortName(recipeOf(plan, i.recipeSlug)?.name)}</span>
                  </span>
                </span>
              ))}
            </div>
          )}
          {tasks.map((t) => (
            <TaskCheck key={t.id} c={c} t={t} />
          ))}
        </section>
      )}
      {during.length > 0 && (
        <p className="text-[14px] text-ink-2">
          Plus tard, pendant la cuisson : {during.map((b) => `bol ${b.letter} (${bowlName(b)})`).join(", ")}. L&apos;écran le dira.
        </p>
      )}
      {evening && plan.bowls.some((b) => !b.fridge) && <p className="text-[14px] text-ink-2">Demain : {plan.bowls.filter((b) => !b.fridge).map((b) => `bol ${b.letter}`).join(", ")}.</p>}
    </div>
  );
}

function TaskCheck({ c, t }: { c: Controls; t: PrepTask }) {
  const done = c.state.prepDone.has(t.id);
  return (
    <Check size="kitchen" strike={false} checked={done} onChange={() => c.togglePrep(t.id)} className={`w-full items-start rounded-[16px] border border-line bg-surface p-3.5 ${done ? "opacity-60" : ""} [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1`}>
      <span className="flex items-start gap-2.5">
        <StepIllu kind="prep" text={t.text ?? t.title} size={36} className="shrink-0" />
        <span className="grid gap-0.5">
          <b className="text-[16px]">{t.title}</b>
          {t.text && <span className="text-[15px] text-ink-2">{t.text}</span>}
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
      {evening ? "C'est au frigo, à demain" : "Passer à la cuisine"}
    </MainButton>
  );
}

// ─── 2. Cuisine : une consigne à la fois ───

function CookScreen({ plan, c }: { plan: SessionPlan; c: Controls }) {
  const { focus } = c;
  if (!focus) return null;
  return (
    <div className="grid gap-5 px-4 pt-2">
      <Soon plan={plan} c={c} exclude={focus.id} />
      <StepNow plan={plan} c={c} step={focus} />
      {c.upcoming && <Later plan={plan} step={c.upcoming} at={c.cookingStart + c.upcoming.startMin * 60000} />}
    </div>
  );
}

/** L'étape à faire maintenant : la sous-étape en cours en très grand (sinon la première phrase), ses dessins, sa pastille. */
export function StepNow({ plan, c, step }: { plan: SessionPlan; c: Controls; step: PlanStep }) {
  const { state, now, cookingStart } = c;
  const st = stepStatus(state, step.id);
  const recipe = recipeOf(plan, step.recipeSlug);
  const n = st === "active" ? currentPhase(state, step) : null;
  const phase = n != null ? step.phases![n] : null;
  const { head, rest } = splitStep(step.text);
  const batch = st === "active" ? batchOf(state, step) : null;
  const late = st === "todo" ? Math.round((now - (cookingStart + step.startMin * 60000)) / 60000) : 0;
  const notes = step.notes;
  return (
    <article key={`${step.id}:${n ?? "-"}`} className="grid animate-pop gap-4" aria-live="polite">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-bold uppercase tracking-[0.1em] text-ink-2">
        {recipe && <RecipeTile color={recipe.color} name={recipe.name} size="sm" />}
        <span>
          {st === "todo" ? "À lancer" : "Maintenant"} · étape {step.no} sur {plan.steps.length}
          {batch ? ` · fournée ${batch.at} sur ${batch.of}` : ""}
        </span>
        {st === "todo" && late > 2 && <span className="tracking-normal normal-case">· {late} min de retard</span>}
      </p>
      <div className="flex items-center gap-4">
        <StepIllu kind={step.kind} text={phase?.text ?? step.text} size={88} live={st === "active"} className="illu-tile shrink-0" style={{ "--tile": stepColor(plan, step) }} />
        {step.phases && step.phases.length > 1 && st === "active" && <PhaseDots step={step} n={n} c={c} />}
      </div>
      {phase ? (
        <div className="grid gap-1.5">
          <p className="text-[15px] leading-snug text-ink-2">{head}</p>
          <h1 className="font-display text-[clamp(2rem,9vw,2.9rem)] leading-[1.05] font-extrabold tracking-[-0.02em] [font-stretch:88%]">{phase.text}</h1>
          {phase.wait && <p className="text-[16px] text-ink-2">Attente : fais autre chose, ça sonnera.</p>}
        </div>
      ) : (
        <div className="grid gap-2">
          <h1 className="font-display text-[clamp(2rem,9vw,2.9rem)] leading-[1.05] font-extrabold tracking-[-0.02em] [font-stretch:88%]">{head}</h1>
          {/* Avec des sous-étapes, elles disent quoi faire une à une : le reste du texte est replié. */}
          {rest && !step.phases?.length && <p className="text-[18px] leading-snug">{rest}</p>}
          {step.phases && step.phases.length > 1 && st === "todo" && <p className="text-[16px] text-ink-2">{step.phases.length} sous-étapes, l&apos;écran les enchaîne.</p>}
        </div>
      )}
      <Specs plan={plan} step={step} level={phase?.hobLevel ?? null} />
      <Pill c={c} step={step} />
      {step.bowls.length > 0 && (
        <div className="grid gap-2">
          <Eyebrow>{step.tasks ? "Remplis" : "Prends"}</Eyebrow>
          {step.bowls.map((l) => {
            const b = bowlOf(plan, l);
            return b ? (
              <span key={l} className="flex items-center gap-3">
                <Bowl bowl={b} size="lg" ready={state.bowlsReady.has(l)} />
                <span className="flex flex-wrap items-center gap-1">
                  {b.items.slice(0, 4).map((i, k) => (
                    <FoodIllu key={k} food={i.food} item={i.item} size={32} live={st === "active"} label={i.item.split(/[,(]/)[0].trim()} />
                  ))}
                </span>
                <span className="min-w-0 truncate text-[15px] text-ink-2">{bowlName(b)}</span>
              </span>
            ) : null;
          })}
        </div>
      )}
      {wantsDropGuide(step, n, st === "active") && <DropGuide onInk />}
      {notes.map((x) => (
        <p key={x} className="flex items-start gap-2 rounded-[12px] border border-line px-3.5 py-2.5 text-[15px]">
          <Icon name={x.startsWith("Relais") ? "swap" : "info"} size="s" className="mt-0.5 shrink-0" />
          {x}
        </p>
      ))}
      {(step.cue || (Boolean(step.phases?.length) && rest)) && (
        <details className="group rounded-[12px] border border-line px-3.5 py-2.5 text-[15px]">
          <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-2 font-semibold text-ink-2 [&::-webkit-details-marker]:hidden">
            {step.cue ? "Repère et consigne complète" : "Toute la consigne"}
            <Icon name="chev" size="s" className="transition-transform group-open:rotate-90" />
          </summary>
          <div className="mt-2 grid gap-2 leading-snug">
            {step.cue && <p className="font-semibold">« {step.cue} »</p>}
            {step.phases?.length ? <p className="text-ink-2">{step.text}</p> : null}
          </div>
        </details>
      )}
    </article>
  );
}

/** Sous-étapes : un point par sous-étape (faite, en cours, à venir), et « 2 sur 5 ». */
function PhaseDots({ step, n, c }: { step: PlanStep; n: number | null; c: Controls }) {
  const len = step.phases!.length;
  return (
    <span className="grid gap-1.5" aria-label={n != null ? `Sous-étape ${n + 1} sur ${len}` : `${len} sous-étapes faites`}>
      <span className="flex flex-wrap gap-1.5" aria-hidden>
        {step.phases!.map((_, i) => (
          <i key={i} className={`block h-2 rounded-full ${i === n ? "w-6 bg-hot" : c.state.phasesDone.has(`${i}:${step.id}`) ? "w-2 bg-ink" : "w-2 bg-line-strong"}`} />
        ))}
      </span>
      <span className="num text-[14px] text-ink-2">{n != null ? `${n + 1} sur ${len}` : "fini"}</span>
    </span>
  );
}

const equipIcon = (s: PlanStep): IconName => (s.equipmentId?.startsWith("plat") || s.oven ? "oven" : s.equipmentId?.startsWith("poele") ? "pan" : "pot");

/** Récipient, foyer et niveau, four : une ligne. */
function Specs({ plan, step, level }: { plan: SessionPlan; step: PlanStep; level: number | null }) {
  const lv = level ?? (step.hobLevelLabel ? null : step.hobLevel);
  if (!step.equipmentName && !step.hobId && !step.oven) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[16px] text-ink-2">
      {step.equipmentName && step.kind !== "preheat" && (
        <span className="flex items-center gap-1.5 text-ink">
          <Icon name={equipIcon(step)} size="s" />
          {step.equipmentName}
        </span>
      )}
      {step.hobId && (
        <span className="flex items-center gap-2">
          {hobName(plan, step.hobId)}
          {lv != null ? <Induction level={lv} /> : step.hobLevelLabel ? <b className="num text-ink">niveau {step.hobLevelLabel}</b> : null}
        </span>
      )}
      {step.oven && (
        <span className="flex items-center gap-2">
          {step.oven.levels[0] ? <OvenLevel level={step.oven.levels[0]} /> : <Icon name="oven" size="s" />}
          <b className="num text-ink">{step.oven.temp} °C</b>
        </span>
      )}
    </div>
  );
}

/** Le minuteur de l'étape montrée, en pastille : sous-étape ou attente, +1 min ; ou « Lancer 3 min ». */
function Pill({ c, step }: { c: Controls; step: PlanStep }) {
  const { state, now } = c;
  const st = stepStatus(state, step.id);
  const n = st === "active" ? currentPhase(state, step) : null;
  const t = (n != null ? phaseTimer(state, step.id, n) : undefined) ?? stepTimer(state, step.id);
  if (st === "todo")
    return step.durationMin >= 1 ? (
      <span className="flex w-fit items-center gap-2 rounded-full border border-line-strong px-3.5 py-1.5 text-[15px] text-ink-2">
        <Icon name="clock" size="s" />
        environ {dur(step.durationMin)}
      </span>
    ) : null;
  if (!t)
    return n != null ? (
      <Button variant="secondary" icon="clock" onClick={() => c.startPhase(step)} className="w-fit">
        Lancer {fmtMin(step.phases![n].min)}
      </Button>
    ) : null;
  const left = t.endsAt - now;
  return (
    <div className={`flex w-fit items-center gap-1 rounded-full border-2 py-1 pr-1 pl-4 ${left < 15000 ? "border-hot bg-hot-soft" : "border-ink"}`} role="timer" aria-label={`Minuteur : ${mmss(Math.max(0, left))}`}>
      <Icon name="clock" size="s" />
      <span className="num-tight min-w-[4.5ch] px-1.5 text-[28px] leading-none font-extrabold" aria-hidden>
        {mmss(Math.max(0, left))}
      </span>
      <Button size="md" variant="quiet" icon="plus" onClick={() => c.addMinutes(t, 1)} aria-label="Une minute de plus" className="rounded-full">
        1 min
      </Button>
    </div>
  );
}

const fmtMin = (m: number) => (m < 1 ? `${Math.round(m * 60)} s` : `${Number.isInteger(m) ? m : m.toFixed(1).replace(".", ",")} min`);

/** Ce qui sonne bientôt (minuteurs hors de l'étape montrée) et ce qui tourne en fond sans minuteur. */
export function Soon({ plan, c, exclude, person }: { plan: SessionPlan; c: Controls; exclude: string | null; person?: Person }) {
  const mine = (stepId: string | null) => !person || (plan.steps.find((s) => s.id === stepId)?.person ?? "A") === person;
  const timers = soonTimers(c.timers, c.now, exclude).filter((t) => mine(t.stepId));
  const idle = backgroundSteps(plan, c.state, c.focus).filter((s) => s.id !== exclude && mine(s.id) && !c.timers.some((t) => t.stepId === s.id));
  const [open, setOpen] = useState<string | null>(null);
  if (!timers.length && !idle.length) return null;
  const name = (st: PlanStep | undefined) => (st ? shortName(recipeOf(plan, st.recipeSlug)?.name) || `Étape ${st.no}` : "Minuteur");
  const labelOf = (t: TimerState) => {
    const st = plan.steps.find((x) => x.id === t.stepId);
    return st?.phases?.[t.phase ?? -1]?.text ?? (st ? stepTitle(plan, st) : t.label);
  };
  const shown = timers.find((t) => t.id === open);
  const idleShown = idle.find((x) => x.id === open);
  const pill = "flex min-h-11 shrink-0 items-center gap-2 rounded-full border bg-surface py-1 pr-3.5 pl-1.5 text-[15px]";
  return (
    <section className="grid gap-2" aria-label="Ça sonne bientôt">
      <Eyebrow>Ça sonne bientôt</Eyebrow>
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {timers.map((t) => {
          const st = plan.steps.find((x) => x.id === t.stepId);
          return (
            <li key={t.id}>
              <button type="button" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id} aria-label={`${name(st)} : ${labelOf(t)}, dans ${mmss(t.endsAt - c.now)}`} className={`${pill} ${open === t.id ? "border-ink" : "border-line-strong"}`}>
                {st ? <StepIllu kind={st.kind} text={labelOf(t)} size={30} live className="shrink-0" /> : <Icon name="clock" />}
                <b>{name(st)}</b>
                <span className="num font-bold">{mmss(t.endsAt - c.now)}</span>
              </button>
            </li>
          );
        })}
        {idle.map((st) => (
          <li key={st.id}>
            <button type="button" onClick={() => setOpen(open === st.id ? null : st.id)} aria-expanded={open === st.id} className={`${pill} ${open === st.id ? "border-ink" : "border-line-strong"}`}>
              <StepIllu kind={st.kind} text={st.text} size={30} live className="shrink-0" />
              <b>{name(st)}</b>
              <span className="text-ink-2">en cours</span>
            </button>
          </li>
        ))}
      </ul>
      {shown && (
        <div className="flex animate-pop flex-wrap items-center gap-2 rounded-[14px] border border-line bg-surface px-3.5 py-3">
          <span className="w-full text-[15px]">
            {labelOf(shown)} <span className="text-ink-2">· fin {clock(shown.endsAt)}</span>
          </span>
          <Button size="sm" variant="secondary" icon="plus" onClick={() => c.addMinutes(shown, 1)}>
            1 min
          </Button>
          <Button size="sm" variant="quiet" icon="x" onClick={() => (setOpen(null), c.stopTimer(shown))}>
            Arrêter
          </Button>
        </div>
      )}
      {idleShown && (
        <div className="flex animate-pop flex-wrap items-center gap-2 rounded-[14px] border border-line bg-surface px-3.5 py-3">
          <span className="w-full text-[15px]">
            Étape {idleShown.no} · {stepTitle(plan, idleShown)}
          </span>
          <Button size="sm" variant="secondary" icon="check" onClick={() => (setOpen(null), c.toggleStep(idleShown))}>
            Finie
          </Button>
        </div>
      )}
    </section>
  );
}

function Later({ plan, step, at }: { plan: SessionPlan; step: PlanStep; at: number }) {
  return (
    <p className="flex items-center gap-3 rounded-[14px] border border-dashed border-line-strong px-3.5 py-3 text-[15px] text-ink-2">
      <StepIllu kind={step.kind} text={step.text} size={32} className="shrink-0" />
      <span className="min-w-0">
        Ensuite · <b className="text-ink">{stepTitle(plan, step)}</b> · {clock(at)}
      </span>
    </p>
  );
}

function CookBar({ plan, c }: { plan: SessionPlan; c: Controls }) {
  const { focus, state } = c;
  if (!focus) return null;
  const st = stepStatus(state, focus.id);
  const n = st === "active" ? currentPhase(state, focus) : null;
  const more = n != null && n < focus.phases!.length - 1;
  const auto = st === "active" && !stepTimer(state, focus.id) && passiveMin(focus) >= 3;
  const last = !c.upcoming && !more && plan.steps.every((s) => s.id === focus.id || stepStatus(state, s.id) === "done");
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2.5">
      <Button size="kitchen" variant="secondary" iconOnly onClick={c.back} aria-label="Retour à la consigne d'avant (flèche gauche)" title="Retour (flèche gauche)" className="min-h-[76px]">
        <Icon name="chev" className="rotate-180" />
      </Button>
      <MainButton icon={st === "todo" ? "play" : "check"} onClick={c.next}>
        {st === "todo" ? "Commencer" : more ? "Suivant" : auto ? `Suivant · minuteur ${timerMinutes(focus)} min` : last ? "C'est cuit" : "Suivant"}
      </MainButton>
    </div>
  );
}

// ─── Ça sonne : l'étape revient au premier plan ───

export const personOf = (plan: SessionPlan, t: TimerState): Person | null => {
  const s = t.stepId ? plan.steps.find((x) => x.id === t.stepId) : undefined;
  return s ? (s.person ?? "A") : null;
};

export function Ringing({ plan, c, timers }: { plan: SessionPlan; c: Controls; timers: TimerState[] }) {
  const [t, ...others] = timers;
  const step = t.stepId ? plan.steps.find((s) => s.id === t.stepId) : undefined;
  const after = t.phase != null && step?.phases?.[t.phase]?.wait ? step.phases[t.phase + 1] : undefined;
  const recipe = step ? recipeOf(plan, step.recipeSlug) : undefined;
  return (
    <section className="grid animate-pop gap-4 px-4 pt-2" role="alert" aria-label="Minuteur terminé">
      <p className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.1em] text-hot-ink">
        <Icon name="bell" size="s" className="animate-pulse" />
        {after ? `Fini : ${t.label}` : "Ça sonne"} · il y a {mmss(c.now - t.endsAt)}
      </p>
      {step && <StepIllu kind={step.kind} text={after?.text ?? t.label} size={120} live className="illu-tile" style={{ "--tile": stepColor(plan, step) } as CSSProperties} />}
      <h1 className="font-display text-[clamp(2.2rem,10vw,3.2rem)] leading-[1.02] font-extrabold tracking-[-0.02em] [font-stretch:88%]">{after ? after.text : t.label}</h1>
      {step && (
        <p className="text-[17px] text-ink-2">
          {recipe ? `${recipe.name} · ` : ""}étape {step.no} · {stepTitle(plan, step)}
        </p>
      )}
      {others.map((o) => (
        <button key={o.id} type="button" onClick={() => c.stopTimer(o)} className="flex min-h-14 items-center justify-between gap-3 rounded-[14px] border border-line-strong px-4 text-left text-[16px] font-semibold">
          <span className="min-w-0 truncate">Aussi fini : {o.label}</span>
          <span className="shrink-0 text-[14px] text-ink-2">arrêter</span>
        </button>
      ))}
    </section>
  );
}

export function RingBar({ plan, c, t, who }: { plan: SessionPlan; c: Controls; t: TimerState; who?: Person }) {
  const step = t.stepId ? plan.steps.find((s) => s.id === t.stepId) : undefined;
  const after = t.phase != null && step?.phases?.[t.phase]?.wait;
  return (
    <MainButton icon="check" who={who} onClick={() => c.stopTimer(t)}>
      {after ? "C'est parti" : "Arrêter, sur tous les écrans"}
    </MainButton>
  );
}

// ─── 3. Range : boîtes et frigo ───

function StoreScreen({ plan, c, storage }: { plan: SessionPlan; c: Controls; storage: RecipeStorage[] }) {
  return (
    <div className="grid gap-4 px-4 pt-2">
      <div className="flex items-center gap-4">
        <StepIllu id="portion" size={88} live className="illu-tile shrink-0" style={{ "--tile": "var(--c-ink-3)" }} />
        <div className="grid gap-1">
          <h1 className="font-display text-[clamp(1.75rem,8vw,2.25rem)] leading-tight font-extrabold [font-stretch:92%]">Boîtes et frigo</h1>
          <p className="text-[16px] text-ink-2">Laisse tiédir à découvert (2 h au plus), ferme, note la date, au frigo.</p>
        </div>
      </div>
      <ul className="grid gap-2.5" aria-label="Recettes à ranger">
        {plan.recipes.map((r) => {
          const done = c.state.boxed.has(r.slug);
          const s = storage.find((x) => x.slug === r.slug);
          return (
            <li key={r.slug}>
              <Check
                size="kitchen"
                strike={false}
                checked={done}
                onChange={() => c.send([{ kind: "note", payload: { boxed: r.slug, ...(done ? { undo: true } : {}) } }])}
                className={`w-full items-center rounded-[16px] border-2 bg-surface p-3.5 ${done ? "border-line opacity-60" : "border-line-strong"} [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1`}
              >
                <span className="flex items-center gap-3">
                  <RecipeTile color={r.color} name={r.name} />
                  <span className="grid min-w-0 gap-0.5">
                    <b className="text-[18px] leading-tight">{r.name}</b>
                    <span className="text-[15px] text-ink-2">{s ? storageLine(s) : "en boîtes, au frigo"}</span>
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
    <section className="grid flex-1 animate-[k-fade_300ms_ease-out] content-center justify-items-center gap-5 px-6 py-8 text-center" aria-labelledby="fin">
      <span className="grid size-24 place-items-center rounded-full bg-accent-soft text-accent">
        <Icon name="fridge" size={44} />
      </span>
      <h1 id="fin" className="font-display text-[clamp(2.2rem,10vw,3rem)] leading-none font-extrabold [font-stretch:88%]">
        Tout est rangé ?
      </h1>
      <p className="max-w-[34ch] text-[18px] leading-snug text-ink-2">
        {plan.recipes.length} recette{plan.recipes.length > 1 ? "s" : ""}
        {boxes ? `, environ ${boxes} boîtes` : ""}. La session se termine sur tous les écrans ; ses durées corrigent les prochaines.
      </p>
    </section>
  );
}

function Done({ plan, c, detail }: { plan: SessionPlan; c: Controls; detail: string }) {
  const test = useContext(SessionTest) != null;
  return (
    <div className="grid justify-items-center gap-5 px-4 pt-8 text-center">
      <FridgeDone plan={plan} events={c.events} compact />
      {/* Peser les marmites : grammes par boîte de chacun, puis les boîtes rangées au frigo ou au congélo (pas en session test). */}
      {!test && (
        <div className="w-full max-w-lg text-left">
          <SessionBoxes id={c.id} plan={plan} />
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-2.5">
        <Link href={detail} className="inline-flex min-h-tap items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-4 font-semibold hover:border-ink">
          <Icon name="clock" size="s" />
          Voir le bilan
        </Link>
        <Button variant="quiet" icon="refresh" onClick={() => c.setStatus("cooking")}>
          Rouvrir la session
        </Button>
      </div>
    </div>
  );
}

// ─── Prep la veille : la reprise ───

function Fridge({ plan, c, choice }: { plan: SessionPlan; c: Controls; choice: DayChoice | null }) {
  const inFridge = plan.bowls.filter((b) => c.state.bowlsReady.has(b.letter));
  return (
    <div className="grid gap-4 px-4 pt-2">
      <div className="grid justify-items-center gap-2.5 px-2 py-4 text-center">
        <span className="grid size-[72px] place-items-center rounded-full bg-surface-2 text-ink-2">
          <Icon name="moonset" size="l" />
        </span>
        <h1 className="font-display text-[26px] font-extrabold">Prep d&apos;hier terminée</h1>
        <p className="max-w-[34ch] text-[16px] text-ink-2">
          {inFridge.length} bol{inFridge.length > 1 ? "s" : ""} au frigo. Le jour J : le reste de la prep, puis la cuisine.
        </p>
      </div>
      <ResumeChoice plan={plan} c={c} choice={choice} big />
      <ul className="grid gap-2" aria-label="Au frigo">
        {inFridge.map((b) => (
          <li key={b.letter} className="flex items-center gap-3 rounded-[14px] border border-line bg-surface p-3">
            <Bowl bowl={b} size="lg" ready />
            <span className="flex flex-wrap gap-1">
              {b.items.slice(0, 4).map((i, k) => (
                <FoodIllu key={k} food={i.food} item={i.item} size={32} label={i.item} />
              ))}
            </span>
            <span className="min-w-0 truncate text-[15px]">{bowlName(b)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { Head as SimpleHead };
