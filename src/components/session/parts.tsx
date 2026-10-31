"use client";

// Morceaux partagés des vues de session, selon la DA « Plan de travail » (docs/design/plan-de-travail.html,
// section Session) et avec le kit : en-tête d’encre (.s-head), étape en cours (.now), étape suivante
// (.nextstep), bol à prendre, puces de l'étape, schéma des foyers et du four (.hob/.burner/.ovenbox),
// minuteurs, alarme plein écran, relais (.handoff), QR, toasts, Wake Lock.
import { typo } from "@/lib/typo";
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Person, PlanBowl, PlanStep, SessionPlan } from "@/lib/session/planner";
import type { SessionState, TimerState } from "@/lib/session/state";
import { stepStatus } from "@/lib/session/state";
import { LETTERS, type DuoNames } from "@/lib/session/people";
import { STEP_LABELS } from "@/lib/recipes/format";
import { BowlBadge, Button, Cue, Icon, Induction, OvenLevel, RecipeTile, Segmented, SpecChip, Timer, Toast, formatClock, type IconName } from "@/components/ui";
import type { Toast as ToastData } from "./useSession";
import { FoodIllu, StepIllu, type IlluSize } from "@/components/illus/Illu";
import { BoxGlyph } from "@/components/boxes/BoxGlyph";

// ─── Formats ───

export const clock = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
export const mmss = (ms: number) => formatClock(ms / 1000);
export const dur = (min: number) => {
  const r = Math.round(min);
  return r >= 60 ? `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, "0")}` : `${r} min`;
};

export const kindLabel = (k: PlanStep["kind"]) => (k === "preheat" ? "Four" : STEP_LABELS[k]);
export const recipeOf = (plan: SessionPlan, slug: string | null | undefined) => plan.recipes.find((r) => r.slug === slug);
/** Couleur d’une étape : celle de sa recette (var(--c-recipe-N)), encre douce pour une action commune. */
export const stepColor = (plan: SessionPlan, s: PlanStep) => recipeOf(plan, s.recipeSlug)?.color ?? "var(--c-ink-3)";
export const shortName = (name: string | undefined) => (name ?? "").split(/\s+/)[0] ?? "";
const rc = (color: string) => ({ "--rc": color }) as CSSProperties;

/**
 * Les fiches ont des étapes longues (jusqu’à 370 signes) : la première phrase se lit en très
 * grand, le reste en dessous. Une première phrase trop longue se coupe aux deux-points.
 */
export function splitStep(text: string): { head: string; rest: string } {
  const t = text.trim();
  const m = t.match(/^(.{12,}?[.!?])\s+(?=[A-ZÀ-Ý0-9«(])/u);
  let head = m ? m[1] : t;
  let rest = m ? t.slice(m[0].length) : "";
  if (head.length > 120) {
    const c = head.indexOf(" : ");
    if (c > 15 && c < 100) {
      rest = `${head.slice(c + 3)} ${rest}`.trim();
      head = head.slice(0, c);
    }
  }
  // Affichage : micro-typographie (apostrophe courbe, espaces insécables) appliquée après le découpage.
  return { head: typo(head.replace(/\.$/, "")), rest: typo(rest) };
}

/** Titre court d’une étape pour le fil (« Cocotte · Chasseur » ou la première phrase raccourcie). */
export function stepTitle(plan: SessionPlan, s: PlanStep): string {
  const h = splitStep(s.text).head;
  if (h.length <= 64) return h;
  const cut = h.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 30 ? cut.lastIndexOf(" ") : 60)}…`;
}

/** Repère d’une étape : la première phrase en citation, le reste en explication, et le sens qui le perçoit. */
export function cueParts(cue: string): { sense: "ear" | "eye" | "nose"; quote: string; rest: string } {
  const sense = /chant|glouglou|crépit|grésill|siffl|bruit|entend/i.test(cue) ? "ear" : /odeur|sent |sent$|parfum|arôme/i.test(cue) ? "nose" : "eye";
  const m = cue.match(/^(.+?[.!?;])\s+(.+)$/u);
  return { sense, quote: (m ? m[1] : cue).replace(/[.;]$/, ""), rest: m ? m[2] : "" };
}

/** Ce que contient un bol : « Échalotes, oignon, ail », les quantités, et ce qui a été commandé. */
export const bowlName = (b: PlanBowl) => b.items.map((i) => i.item.split(/[,(]/)[0].trim()).join(", ");
export const bowlQty = (b: PlanBowl) => b.items.map((i) => i.qty).filter(Boolean).join(" · ");
export const bowlOrdered = (b: PlanBowl) => [...new Set(b.items.map((i) => i.ordered).filter(Boolean))].join(" · ");
export const bowlOf = (plan: SessionPlan, letter: string) => plan.bowls.find((b) => b.letter === letter);

/** Les aliments d’un bol en dessins (animés quand `live`). */
export function BowlFoods({ bowl, size = "m", live = false, max = 5, className = "" }: { bowl: Pick<PlanBowl, "items">; size?: IlluSize; live?: boolean; max?: number; className?: string }) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {bowl.items.slice(0, max).map((i, k) => (
        <FoodIllu key={k} food={i.food} item={i.item} size={size} live={live} label={i.item.split(/[,(]/)[0].trim()} />
      ))}
    </span>
  );
}

// ─── Petites pièces ───

/** Bol lettré aux couleurs de la recette ; prêt = petite coche d’accent. */
export function Bowl({ bowl, size = "md", ready, className = "" }: { bowl: Pick<PlanBowl, "letter" | "color">; size?: "xs" | "sm" | "md" | "lg" | "xl"; ready?: boolean; className?: string }) {
  const mark = { xs: "size-3.5", sm: "size-4", md: "size-5", lg: "size-6", xl: "size-8" }[size];
  return (
    <span className={`relative inline-grid shrink-0 ${className}`}>
      <BowlBadge color={bowl.color} letter={bowl.letter} size={size} label={`Bol ${bowl.letter}${ready ? ", prêt" : ""}`} />
      {ready && (
        <span className={`absolute -right-1 -bottom-1 grid place-items-center rounded-full bg-accent text-on-accent ring-2 ring-bg animate-pop ${mark}`} aria-hidden>
          <Icon name="check" size={size === "xl" ? 18 : size === "lg" ? 14 : 10} strokeWidth={3.2} />
        </span>
      )}
    </span>
  );
}

/** Personne d’une session à deux : A en encre pleine, B cerclée (DA `.mono`). */
export function PersonMono({ person, size = 26, onInk = false }: { person: Person; size?: number; onInk?: boolean }) {
  const who = usePeople()[person];
  const look = onInk
    ? person === "A" ? "bg-on-inverse text-inverse" : "border-2 border-on-inverse text-on-inverse"
    : person === "A" ? "bg-inverse text-on-inverse" : "border-2 border-ink bg-surface text-ink";
  return (
    <span className={`inline-grid shrink-0 place-items-center rounded-full font-display font-extrabold leading-none ${look}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.48) }} aria-label={who.name === person ? `Personne ${person}` : who.name}>
      {who.mono}
    </span>
  );
}

/** Petit titre en capitales espacées (DA `.eyebrow`). */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`label text-ink-2 ${className}`}>{children}</span>;
}

export function LiveDot({ online }: { online: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-small" title={online ? "Synchronisé avec les autres écrans" : "Reconnexion…"}>
      <span className={`size-2.5 shrink-0 rounded-full bg-current ${online ? "k-live" : "opacity-40"}`} aria-hidden />
      {online ? "en direct" : "reconnexion…"}
    </span>
  );
}

// ─── Écran allumé ───

export function useWakeLock(auto = true) {
  const [on, setOn] = useState(false);
  const lock = useRef<WakeLockSentinel | null>(null);
  const wanted = useRef(false);
  const request = async () => {
    wanted.current = true;
    unlockAudio();
    if (!("wakeLock" in navigator)) return;
    try {
      lock.current = await navigator.wakeLock.request("screen");
      setOn(true);
      lock.current.addEventListener("release", () => setOn(false));
    } catch {
      setOn(false);
    }
  };
  useEffect(() => {
    if (auto) void request();
    const onVis = () => document.visibilityState === "visible" && wanted.current && void request();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void lock.current?.release().catch(() => {});
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { on, request };
}

/** « écran allumé » (verrou d’écran pris) ou « garder allumé » à toucher. */
export function WakePill({ wake, onInk = true }: { wake: { on: boolean; request: () => Promise<void> }; onInk?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => void wake.request()}
      className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-small font-semibold ${onInk ? "border-[color-mix(in_srgb,var(--c-on-inverse)_45%,transparent)]" : "border-line-strong text-ink-2"} ${wake.on ? "" : "opacity-75"}`}
      title={wake.on ? "L’écran reste allumé pendant la session" : "Toucher pour garder l’écran allumé"}
    >
      <Icon name={wake.on ? "lock" : "sun"} size="s" />
      {wake.on ? "écran allumé" : "garder allumé"}
    </button>
  );
}

// ─── En-tête de session (.s-head) ───

export type Phase = "prep" | "cooking";

/** Bande d’encre de la session : point en direct, titre, avancement, phase Prep / Cuisson, écran allumé. */
/** `plain` : sur la surface sombre du téléphone en cuisson, la bande reste sombre (pas d’inversion claire). */
/** Session test (pour montrer l’appli) : une étiquette discrète dans chaque en-tête, et « Finir le test » sur grand écran. */
export const SessionTest = createContext<{ ended: boolean; end: () => void } | null>(null);
/** La boîte de chaque plat (DishBox, rendue par la page serveur), par slug ; à défaut, BoxGlyph. */
export const DishArts = createContext<Record<string, ReactNode>>({});
/** À deux : le prénom et l’initiale de A et de B (membres du foyer), à défaut les lettres. */
export const People = createContext<DuoNames>(LETTERS);
export const usePeople = () => useContext(People);

function TestTag({ compact }: { compact: boolean }) {
  const t = useContext(SessionTest);
  if (!t) return null;
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span className={`rounded-full border border-current font-semibold uppercase tracking-[0.08em] opacity-70 ${compact ? "px-2 text-[10px] leading-[14px]" : "px-2 py-px text-[12px]"}`} title="Session test : rien n’est compté">
        test
      </span>
      {!compact && !t.ended && (
        <button type="button" onClick={t.end} className="text-small underline-offset-2 opacity-75 hover:underline hover:opacity-100">
          finir le test
        </button>
      )}
    </span>
  );
}

export function SessionHead({ title, sub, online, phase, onPhase, right, lead, compact = false, plain = false }: { title: ReactNode; sub?: ReactNode; online: boolean; phase?: Phase | null; onPhase?: (p: Phase) => void; right?: ReactNode; lead?: ReactNode; compact?: boolean; plain?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${plain ? "border-b border-line bg-surface text-ink" : "bg-inverse text-on-inverse"} ${compact ? "px-4 py-3" : "px-4 py-3 sm:px-6"}`} data-session-head>
      {lead ?? <span className={`size-2.5 shrink-0 rounded-full bg-current ${online ? "k-live" : "opacity-40"}`} title={online ? "en direct" : "reconnexion…"} aria-label={online ? "En direct" : "Reconnexion"} />}
      <div className="min-w-0 flex-1">
        <b className={`block truncate font-display [font-stretch:100%] text-[17px]`}>{title}</b>
        {compact ? (
          <div className="flex min-w-0 items-center gap-2 text-small">
            <TestTag compact />
            {sub && <span className="truncate opacity-75">{sub}</span>}
          </div>
        ) : (
          sub && <div className="truncate text-small opacity-75">{sub}</div>
        )}
      </div>
      {!compact && <TestTag compact={false} />}
      {phase && onPhase && (
        <Segmented<Phase>
          label="Phase de la session"
          tone="inverse"
          value={phase}
          onChange={(p) => p !== phase && onPhase(p)}
          options={[
            { value: "prep", label: "Prep" },
            { value: "cooking", label: "Cuisson" },
          ]}
        />
      )}
      {right}
    </div>
  );
}

// ─── Puces d’une étape ───

const HOB_NAMES = ["grand foyer", "foyer moyen", "petit foyer"];
export const hobName = (plan: SessionPlan, id: string) => {
  const i = plan.hobs.findIndex((x) => x.id === id);
  const h = plan.hobs[i];
  return `${HOB_NAMES[i] ?? h?.name ?? id}${h?.diameterCm ? ` · ${String(h.diameterCm).replace(".", ",")}` : ""}`;
};

/** Récipient, foyer et niveau (Induction), four (gradin et température), fournées, durée. */
export function StepSpecs({ plan, step, timeLabel }: { plan: SessionPlan; step: PlanStep; timeLabel?: string | null }) {
  return (
    <div className="flex flex-wrap gap-2">
      {step.equipmentName && step.kind !== "preheat" && <SpecChip icon={step.equipmentId?.startsWith("plat") || step.oven ? "oven" : step.equipmentId?.startsWith("poele") ? "pan" : "pot"}>{step.equipmentName}</SpecChip>}
      {step.hobId && <SpecChip icon="hob">{hobName(plan, step.hobId)}</SpecChip>}
      {step.hobId && step.hobLevelLabel ? (
        <SpecChip icon="flame">niveau {step.hobLevelLabel}</SpecChip>
      ) : step.hobId && step.hobLevel != null ? (
        <SpecChip lead={<Induction level={step.hobLevel} />} />
      ) : null}
      {step.oven && (
        <SpecChip lead={step.oven.levels[0] ? <OvenLevel level={step.oven.levels[0]} /> : <Icon name="oven" size="s" />}>
          {step.oven.temp} °C{step.oven.levels.length ? ` · niveau${step.oven.levels.length > 1 ? "x" : ""} ${step.oven.levels.join(" et ")}` : ""}
        </SpecChip>
      )}
      {step.batches && <SpecChip icon="refresh">{step.batches} fournées</SpecChip>}
      {timeLabel !== null && step.durationMin >= 1 && <SpecChip icon="clock">{timeLabel ?? dur(step.durationMin)}</SpecChip>}
    </div>
  );
}

export function StepCue({ cue, className = "" }: { cue: string; className?: string }) {
  const c = cueParts(typo(cue));
  return (
    <Cue sense={c.sense} quote={c.quote} className={className}>
      {c.rest}
    </Cue>
  );
}

// ─── Étape suivante (.nextstep) et bol à prendre ───

export function NextCard({ plan, step, at, eyebrow }: { plan: SessionPlan; step: PlanStep; at?: number; eyebrow?: ReactNode }) {
  const bits = [step.bowls.length ? `bol${step.bowls.length > 1 ? "s" : ""} ${step.bowls.join(", ")}` : null, shortName(recipeOf(plan, step.recipeSlug)?.name) || null, step.equipmentName].filter(Boolean);
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-dashed border-line-strong px-4 py-4">
      <StepIllu kind={step.kind} text={step.text} size="m" className="shrink-0" />
      <div className="grid min-w-0 content-start gap-1">
        <Eyebrow>{eyebrow ?? <>Ensuite · étape {step.no}{at ? ` · ${clock(at)}` : ""}</>}</Eyebrow>
        <b className="font-display text-[18px] leading-snug [font-stretch:100%]">{stepTitle(plan, step)}</b>
        {bits.length > 0 && <span className="text-[14px] text-ink-2">{bits.join(" · ")}</span>}
      </div>
    </div>
  );
}

export function TakeBowl({ bowl, ready, label = "Bol à prendre" }: { bowl: PlanBowl; ready?: boolean; label?: string }) {
  const ordered = bowlOrdered(bowl);
  return (
    <div className="flex items-center gap-4 rounded-[14px] border border-line bg-surface p-4">
      <Bowl bowl={bowl} size="xl" ready={ready} />
      <div className="min-w-0">
        <Eyebrow>{label}</Eyebrow>
        <b className="block font-display text-[20px] leading-tight [font-stretch:100%]">{bowlName(bowl)}</b>
        {bowlQty(bowl) && <span className="num block text-[14px] text-ink-2">{bowlQty(bowl)}</span>}
        <BowlFoods bowl={bowl} live className="mt-2" />
        {ordered && (
          <span className="mt-1 flex items-center gap-2 text-[12px] text-ink-2">
            <Icon name="basket" size="s" />
            {ordered}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Schéma des ressources : 3 foyers, four à 5 niveaux, Poêle ───

export function Resources({ plan, state, now, cookingStart, scale = 1 }: { plan: SessionPlan; state: SessionState; now: number; cookingStart: number; scale?: number }) {
  const active = plan.steps.filter((s) => stepStatus(state, s.id) === "active");
  const elapsed = (s: PlanStep) => (now - (state.started.get(s.id) ?? now)) / 60000;
  const onHob = (hobId: string) => active.find((s) => s.hobId === hobId && (s.oven == null || elapsed(s) < (s.hobUntilMin ?? s.endMin) - s.startMin + 0.5));
  const nextOn = (pred: (s: PlanStep) => boolean) => plan.steps.find((s) => stepStatus(state, s.id) === "todo" && pred(s));
  const inOven = active.filter((s) => (s.oven && (s.hobId == null || elapsed(s) >= (s.hobUntilMin ?? 0) - s.startMin)) || s.kind === "preheat");
  const temp = inOven.map((s) => s.oven?.temp ?? Number(s.text.match(/(\d+) °C/)?.[1])).find(Boolean);
  const preheat = inOven.some((s) => s.kind === "preheat");
  const pan = active.find((s) => s.equipmentId === "poele-28");
  const nextOven = inOven.length ? null : nextOn((x) => Boolean(x.oven) || x.kind === "preheat");
  return (
    <div className="grid gap-3" aria-label="Foyers et four">
      <div className="flex items-end justify-center gap-3 rounded-[14px] bg-surface-2 p-3">
        {plan.hobs.map((h) => {
          const s = onHob(h.id);
          const n = s ? null : nextOn((x) => x.hobId === h.id);
          const px = Math.round((h.diameterCm ?? 20) * 4.2 * scale);
          const lv = s ? (s.hobLevelLabel?.replace(" puis ", "→") ?? (s.hobLevel != null ? String(s.hobLevel) : null)) : null;
          return (
            <div key={h.id} className="grid justify-items-center gap-1">
              <div
                className={`relative grid place-items-center rounded-full text-center text-[12px] leading-tight transition-[background-color,border-color] duration-[var(--dur-slow)] ${s ? "border-[3px] border-[var(--rc)] bg-[color-mix(in_srgb,var(--rc)_12%,var(--c-surface))] text-ink" : "border-2 border-dashed border-line-strong text-ink-2"}`}
                style={{ width: px, height: px, ...(s ? rc(stepColor(plan, s)) : {}) }}
                title={s ? `Étape ${s.no} · ${s.equipmentName ?? ""}` : "libre"}
              >
                {lv && <span className="num absolute -top-2 -right-1.5 grid h-6 min-w-6 place-items-center rounded-[8px] bg-inverse px-2 text-[14px] font-extrabold text-on-inverse">{lv}</span>}
                <span className="px-1">
                  <b className="block text-[12px]">{s ? (s.equipmentName ?? kindLabel(s.kind)) : "libre"}</b>
                  {String(h.diameterCm ?? "").replace(".", ",")} cm
                </span>
              </div>
              {n && <span className="max-w-[7rem] truncate text-[12px] text-faint">puis {n.equipmentName ?? `ét. ${n.no}`} · {clock(cookingStart + n.startMin * 60000)}</span>}
            </div>
          );
        })}
      </div>
      <div className="grid gap-1 rounded-[8px] border-2 border-line-strong px-3 py-2 text-[12px]">
        <div className="flex justify-between text-small font-bold">
          <span>Four · chaleur tournante</span>
          <span className="num">{temp ? `${temp} °C` : "éteint"}</span>
        </div>
        {[1, 2, 3, 4, 5].map((lvl) => {
          const s = inOven.find((x) => x.oven?.levels.includes(lvl));
          return (
            <div key={lvl} className="grid grid-cols-[16px_minmax(0,1fr)] items-center gap-2 text-faint">
              <span className="num">{lvl}</span>
              {s ? (
                <i className="flex h-5 items-center truncate rounded-[4px] border-2 border-[var(--rc)] bg-[color-mix(in_srgb,var(--rc)_18%,var(--c-surface))] px-2 text-[12px] not-italic text-ink" style={rc(stepColor(plan, s))}>
                  {s.equipmentName} · {shortName(recipeOf(plan, s.recipeSlug)?.name)}
                </i>
              ) : (
                <i className="h-3.5 rounded-[4px] border-b-2 border-line-strong" />
              )}
            </div>
          );
        })}
        {preheat && <span className="text-ink-2">Préchauffage en cours</span>}
        {nextOven && <span className="text-ink-2">Ensuite : {nextOven.kind === "preheat" ? "préchauffage" : nextOven.equipmentName} vers {clock(cookingStart + nextOven.startMin * 60000)}</span>}
      </div>
      <div className="flex items-center justify-between gap-2 rounded-[8px] border border-line px-3 py-2 text-small">
        <span className="flex items-center gap-2 font-bold">
          <Icon name="pan" size="s" />
          Poêle 28
        </span>
        {pan ? (
          <span className="flex min-w-0 items-center gap-2" style={rc(stepColor(plan, pan))}>
            <span className="size-2.5 shrink-0 rounded-full bg-[var(--rc)]" aria-hidden />
            <span className="truncate">
              étape {pan.no} · {shortName(recipeOf(plan, pan.recipeSlug)?.name)}
              {pan.batches ? ` · ${pan.batches} fournées` : ""}
            </span>
          </span>
        ) : (
          <span className="text-ink-2">libre</span>
        )}
      </div>
    </div>
  );
}

// ─── Minuteurs ───

/** Minuteurs du kit, à l’heure du serveur (tous les écrans sonnent à la même seconde) : +1 min et arrêter. */
export function TimerList({ plan, timers, now, onAdd, onStop, onAdjust, onReset, big, empty = true }: { plan?: SessionPlan; timers: TimerState[]; now: number; onAdd: (t: TimerState, min: number) => void; onStop: (t: TimerState) => void; /** Ordinateur : appui long puis glisser sur les chiffres. */ onAdjust?: (t: TimerState, deltaSec: number) => void; /** Ordinateur : ↺ revient à la durée d’origine. */ onReset?: (t: TimerState) => void; big?: boolean; empty?: boolean }) {
  if (!timers.length) return empty ? <p className="rounded-[14px] border border-dashed border-line-strong px-4 py-3 text-[14px] text-ink-2">Aucun minuteur en cours : « Suivant » les lance.</p> : null;
  return (
    <div className="grid gap-2">
      {timers.map((t) => {
        const left = (t.endsAt - now) / 1000;
        const done = left <= 0;
        const step = plan && t.stepId ? plan.steps.find((s) => s.id === t.stepId) : undefined;
        return (
          <Timer
            key={t.id}
            className="animate-pop"
            size={big ? "big" : "md"}
            title={t.label}
            detail={`${step ? `${shortName(recipeOf(plan!, step.recipeSlug)?.name) || "étape"} · ` : ""}fin ${clock(t.endsAt)}`}
            remaining={left}
            total={Math.max(60, t.minutes * 60)}
            onAdjust={onAdjust ? (d) => onAdjust(t, d) : undefined}
            action={
              done ? (
                <Button size={big ? "md" : "sm"} variant="inverse" icon="check" onClick={() => onStop(t)}>
                  OK
                </Button>
              ) : (
                <span className={`flex shrink-0 gap-1 ${big ? "" : "flex-col"}`}>
                  <Button size={big ? "md" : "sm"} variant="quiet" onClick={() => onAdd(t, 1)} aria-label="Une minute de plus">
                    +1
                  </Button>
                  {onReset && Math.abs(t.endsAt - (t.startedAt + t.refMinutes * 60000)) > 2000 && (
                    <Button size={big ? "md" : "sm"} variant="quiet" iconOnly icon="refresh" className="hidden lg:inline-flex" aria-label={`Revenir au minuteur d’origine (${t.refMinutes} min)`} title={`Revenir au minuteur d’origine (${t.refMinutes} min)`} onClick={() => onReset(t)} />
                  )}
                  <Button size={big ? "md" : "sm"} variant="quiet" iconOnly icon="x" aria-label="Arrêter le minuteur" onClick={() => onStop(t)} />
                </span>
              )
            }
          />
        );
      })}
    </div>
  );
}

// Bip : Web Audio, débloqué au premier geste (iOS ne joue rien sans).
let audio: AudioContext | null = null;
export function unlockAudio() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    audio = null;
  }
}
/** Le bip des minuteurs, une fois (passage à la sous-étape suivante). */
export const chime = () => beep();
function beep() {
  if (!audio || audio.state !== "running") return;
  const t0 = audio.currentTime;
  for (const [i, f] of [880, 1175, 880].entries()) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = f;
    o.type = "square";
    g.gain.setValueAtTime(0.0001, t0 + i * 0.18);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.18 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.15);
    o.connect(g).connect(audio.destination);
    o.start(t0 + i * 0.18);
    o.stop(t0 + i * 0.18 + 0.16);
  }
}

/** Sonne et vibre toutes les 1,5 s tant qu’un minuteur fini n’est pas arrêté. */
export function useRingAlarm(on: boolean) {
  useEffect(() => {
    if (!on) return;
    beep();
    navigator.vibrate?.([300, 150, 300]);
    const i = setInterval(() => {
      beep();
      navigator.vibrate?.([300, 150, 300]);
    }, 1500);
    return () => clearInterval(i);
  }, [on]);
}

/**
 * Minuteur fini, plein écran (DA « Minuteur fini ») : l’inverse de l’écran autour (clair sur le
 * téléphone sombre, encre sur l’ordinateur), sonne et vibre tant qu’il n’est pas arrêté ;
 * l’arrêter l’arrête sur tous les écrans. Seul propriétaire du son (le Timer du kit reste muet).
 */
export function TimerAlert({ plan, ringing, now, onStop, kitchen = false }: { plan: SessionPlan; ringing: TimerState[]; now: number; onStop: (t: TimerState) => void; kitchen?: boolean }) {
  const any = ringing.length > 0;
  useRingAlarm(any);
  if (!any) return null;
  const [t, ...others] = ringing;
  const step = t.stepId ? plan.steps.find((s) => s.id === t.stepId) : undefined;
  const recipe = step ? recipeOf(plan, step.recipeSlug) : undefined;
  // Fin d’une attente : le titre est le geste qui suit (« Hors du feu, repos 5 min »).
  const after = t.phase != null && step?.phases?.[t.phase]?.wait ? step.phases[t.phase + 1] : undefined;
  return (
    <div className={`fixed inset-0 z-50 ${kitchen ? "kitchen-dark" : ""}`} role="alertdialog" aria-modal="true" aria-label="Minuteur terminé">
      <div className="sx-ring flex h-full flex-col gap-6 overflow-y-auto bg-hot px-6 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1.25rem)] text-on-hot">
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4">
          <div className="flex justify-between text-[14px] opacity-70">
            <span className="flex items-center gap-2">
              <Icon name="bell" size="s" />
              {after ? `fini : ${t.label}` : "minuteur fini"}
            </span>
            <span className="num">il y a {mmss(now - t.endsAt)}</span>
          </div>
          <h1 className="sx-consigne">{after ? after.text : t.label}</h1>
          {step && (
            <p className="text-[18px] opacity-75">
              {recipe ? `${recipe.name} · ` : ""}étape {step.no} · {stepTitle(plan, step)}
            </p>
          )}
          <div className="my-auto grid place-items-center py-4">
            <span className="sx-giant" aria-hidden>+{mmss(now - t.endsAt)}</span>
          </div>
          {others.map((o) => (
            <button key={o.id} type="button" onClick={() => onStop(o)} className="flex min-h-14 items-center justify-between gap-3 rounded-[14px] border border-[color-mix(in_srgb,currentColor_35%,transparent)] px-4 text-left text-[17px] font-semibold">
              <span className="min-w-0 truncate">Aussi fini : {o.label}</span>
              <span className="shrink-0 text-[14px] opacity-75">arrêter</span>
            </button>
          ))}
          <Button variant="ink" size="kitchen" block icon="check" onClick={() => onStop(t)} className="!min-h-24 text-[24px]">
            {after ? "C’est parti, sur tous les écrans" : "Arrêter, sur tous les écrans"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Relais, QR, toasts ───

/** Relais à deux (DA `.handoff`) : qui libère quoi, et quand. */
export function HandoffRow({ from, children, at }: { from: Person; children: ReactNode; at?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[8px] bg-accent-soft px-3 py-3 text-[14px]">
      <PersonMono person={from} />
      <span className="min-w-0 flex-1">{children}</span>
      {at && <span className="num shrink-0 text-[12px] text-ink-2">{at}</span>}
    </div>
  );
}

/** QR code pour ouvrir la vue téléphone. Le fond reste blanc : un QR doit être sombre sur clair pour se lire (seule couleur fixe de la session). */
export function QrCard({ svg, url, children }: { svg: string; url: string; children: ReactNode }) {
  return (
    <a href={url} className="grid justify-items-center gap-2 rounded-[14px] border border-line bg-surface p-4 text-[14px] hover:border-line-strong" title="Scanner avec le téléphone, ou cliquer pour ouvrir la vue téléphone ici">
      <span className="block w-[104px] rounded-[8px] border border-line bg-white p-2 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      <span className="flex items-center gap-2 font-bold">{children}</span>
    </a>
  );
}

export function ToastView({ toast, onDone, raised = false }: { toast: ToastData | null; onDone: () => void; raised?: boolean }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => done.current(), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  const icon: IconName = toast.error ? "alert" : toast.remote ? "refresh" : "check";
  return (
    <div className={`pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4 ${raised ? "bottom-[calc(8.5rem+env(safe-area-inset-bottom))]" : "bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:bottom-6"}`} aria-live="polite">
      <Toast key={toast.key} className={toast.error ? "!bg-ko !text-on-accent" : ""}>
        <span className="flex items-center gap-2">
          <Icon name={icon} size="s" />
          {toast.text}
          {toast.remote && <span className="opacity-60">· autre écran</span>}
        </span>
      </Toast>
    </div>
  );
}

/** La boîte du plat en petit (signature « La boîte », à la place du monogramme), aux couleurs du plan. */
export function RecipeMark({ plan, slug, size = "sm" }: { plan: SessionPlan; slug: string | null | undefined; size?: "sm" | "md" }) {
  const r = recipeOf(plan, slug);
  return (
    <span title={r?.name} className="inline-flex shrink-0">
      <BoxGlyph color={r?.color ?? "var(--c-ink-3)"} size={size === "md" ? 40 : 30} />
    </span>
  );
}
