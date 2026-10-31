"use client";

// Blocs des vues de session partagés par la vue seule, à deux et le téléphone : l’étape en cours
// (.now) et ses boutons, le résumé du plan (durées, choix du planificateur, manques), la reprise
// d'une prep la veille (seul ou à deux), la fin de session (bilan prévu / réel).
import { useRouter } from "next/navigation";
import { useContext, useEffect, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { modeOf, type Person, type PlanStep, type SessionPlan } from "@/lib/session/planner";
import { handoffLine } from "@/lib/session/people";
import { batchOf, currentPhase, liveTimer, passiveMin, phaseTimer, stepStatus, stepTimer } from "@/lib/session/state";
import { applyScales } from "@/app/session/actions";
import { Alert, Button, Icon, Induction } from "@/components/ui";
import type { Controls, DayChoice } from "./SessionApp";
import { DurationOrigin, DurationReport } from "./Durations";
import { Bowl, BowlFoods, bowlName, bowlOf, clock, dur, Eyebrow, HandoffRow, mmss, PersonMono, usePeople, RecipeMark, recipeOf, SessionTest, shortName, splitStep, StepCue, StepSpecs } from "./parts";
import { StepIllu } from "@/components/illus/Illu";
import { FridgeDone } from "./FridgeDone";
import { SessionBoxes } from "./SessionBoxes";
import { DropGuide, wantsDropGuide } from "./DropGuide";

// ─── En-tête : titre, avancement, fin prévue ───

const DAY = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", timeZone: "Europe/Paris" });
export function sessionTitle(startedAt: string | null, plan: SessionPlan) {
  const d = startedAt ? DAY.format(new Date(startedAt)) : null;
  return modeOf(plan) === "duo" ? `Session à deux${d ? ` · ${d}` : ""}` : d ? `Session du ${d}` : "Session de cuisine";
}
export const recipesLine = (plan: SessionPlan) => plan.recipes.map((r) => `${r.name}${r.scale !== 1 ? ` ×${String(r.scale).replace(".", ",")}` : ""}`).join(" + ");

/** « étape 14 sur 38 · fin prévue 13:05 » (retard compris). */
export function progressLine(plan: SessionPlan, c: Controls): string {
  const { state, now, cookingStart, focus } = c;
  const done = plan.steps.filter((s) => stepStatus(state, s.id) === "done").length;
  const late = focus && stepStatus(state, focus.id) === "todo" ? Math.max(0, now - (cookingStart + focus.startMin * 60000)) : 0;
  let end: number | null = null;
  if (c.mode === "duo") end = state.status === "cooking" ? cookingStart + plan.totalMin * 60000 + late : null;
  else if (state.status === "cooking") end = cookingStart + plan.cookingMin * 60000 + late;
  else if (state.status === "prep") {
    const left = plan.prep.tasks.filter((t) => !state.prepDone.has(t.id) && !(c.mode === "veille" && state.eveDone && t.eve)).reduce((s, t) => s + t.minutes, 0);
    end = c.mode === "veille" && !state.eveDone ? null : now + (left + plan.cookingMin) * 60000;
  }
  const n = focus ? focus.no : done;
  const parts = [state.status === "cooking" ? `étape ${n} sur ${plan.steps.length}` : state.status === "prep" ? `${state.bowlsReady.size} bol${state.bowlsReady.size > 1 ? "s" : ""} prêt${state.bowlsReady.size > 1 ? "s" : ""} sur ${plan.bowls.filter((b) => !b.during?.length).length}` : null, end ? `fin prévue ${clock(end)}` : null];
  return parts.filter(Boolean).join(" · ");
}

// ─── L’étape en cours (.now) ───

const isHandoff = (n: string) => n.startsWith("Relais") || n.startsWith("Braisage sur la plaque");

/** L’étape à faire maintenant, en très grand : la première phrase, le reste, les puces, le bol, le repère, les boutons. */
export function NowCard({ plan, c, step, size = "lg", actions }: { plan: SessionPlan; c: Controls; step: PlanStep; size?: "lg" | "md"; actions?: ReactNode }) {
  const { state, now, cookingStart } = c;
  const st = stepStatus(state, step.id);
  const recipe = recipeOf(plan, step.recipeSlug);
  const startedAt = state.started.get(step.id);
  const late = st === "todo" ? Math.round((now - (cookingStart + step.startMin * 60000)) / 60000) : 0;
  const { head, rest } = splitStep(step.text);
  const batch = st === "active" ? batchOf(state, step) : null;
  return (
    <article
      key={step.id}
      className={`sx-swap grid gap-4 rounded-[14px] border border-line bg-surface ${size === "lg" ? "p-6" : "p-4"}`}
      style={{ "--rc": recipe?.color ?? "var(--c-ink)" } as CSSProperties}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2 label text-ink-2">
        <RecipeMark plan={plan} slug={step.recipeSlug} />
        <span>
          <span className={st === "todo" ? "" : "text-accent"}>{st === "todo" ? "À lancer" : "Maintenant"}</span> · étape {step.no}
          {recipe ? ` · ${shortName(recipe.name)}` : ""}
          {batch ? ` · fournée ${batch.at} sur ${batch.of}` : ""}
        </span>
        <span className="num ml-auto font-semibold tracking-normal normal-case">
          {st === "todo" ? `prévue ${clock(cookingStart + step.startMin * 60000)}${late > 2 ? ` · ${late} min de retard` : ""}` : startedAt ? `lancée ${clock(startedAt)}` : ""}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <StepIllu kind={step.kind} text={step.text} size={size === "lg" ? "xl" : "l"} live={st === "active"} className="illu-tile shrink-0 max-sm:size-[72px]" style={{ "--tile": recipe?.color ?? "var(--c-ink-3)" }} />
        <h2 className={`sx-consigne min-w-0 ${size === "lg" ? "sx-consigne-sm" : "!text-[26px]"}`}>{head}</h2>
      </div>
      {/* Avec des sous-étapes, le texte complet passe au second plan : elles disent quoi faire. */}
      {rest && <p className={`leading-snug ${step.phases?.length ? "text-[17px] text-ink-2" : size === "lg" ? "text-[19px]" : "text-[17px]"}`}>{rest}</p>}
      <PhasePanel c={c} step={step} />
      {wantsDropGuide(step, currentPhase(state, step), st === "active") && <DropGuide />}
      <StepSpecs plan={plan} step={step} />
      {step.bowls.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Eyebrow>{step.tasks ? "Remplis" : "Prends"}</Eyebrow>
          {step.bowls.map((l) => {
            const b = bowlOf(plan, l);
            return b ? (
              <span key={l} className="inline-flex items-center gap-2">
                <Bowl bowl={b} size={size === "lg" ? "lg" : "md"} ready={state.bowlsReady.has(l)} />
                <BowlFoods bowl={b} size="s" max={3} live={st === "active"} />
                <span className="text-[14px] text-ink-2">{bowlName(b).split(", ").slice(0, 3).join(", ")}</span>
              </span>
            ) : null;
          })}
        </div>
      )}
      {step.cue && <StepCue cue={step.cue} />}
      {step.notes.map((n) => (isHandoff(n) ? <Alert key={n} tone="info" icon="swap">{n}</Alert> : <Alert key={n} tone="warn">{n}</Alert>))}
      {actions ?? <StepActions c={c} step={step} />}
    </article>
  );
}

/**
 * Sous-étapes chronométrées : celle en cours en grand avec son compte à rebours (+1 min, suivante),
 * les autres en petit, cochées une fois faites. La suivante démarre quand le minuteur sonne.
 */
export function PhasePanel({ c, step, onInk = false }: { c: Controls; step: PlanStep; onInk?: boolean }) {
  if (!step.phases?.length) return null;
  const { state, now } = c;
  const active = stepStatus(state, step.id) === "active";
  const n = active ? currentPhase(state, step) : null;
  const raw = n != null ? phaseTimer(state, step.id, n) : undefined;
  const t = raw && liveTimer(raw, now);
  const batches = Math.max(0, ...step.phases.map((p) => p.batch ?? 0));
  return (
    <ol className="grid gap-2" aria-label="Sous-étapes">
      {step.phases.map((ph, i) => {
        const done = state.phasesDone.has(`${i}:${step.id}`);
        // Fournées : un intertitre à chaque nouvelle fournée.
        const head =
          batches > 1 && ph.batch && ph.batch !== step.phases![i - 1]?.batch ? (
            <li key={`b${i}`} className={`px-1 pt-2 label ${onInk ? "" : "text-ink-2"}`} aria-hidden>
              Fournée {ph.batch} sur {batches}
            </li>
          ) : null;
        const row = rowOf(ph, i, done);
        return head ? [head, row] : row;
      })}
    </ol>
  );

  function rowOf(ph: NonNullable<PlanStep["phases"]>[number], i: number, done: boolean) {
        if (i === n)
          return (
            <li key={i} className="grid animate-pop gap-3 rounded-[8px] border-l-[3px] border-accent bg-surface-2 px-4 py-3" aria-current="step">
              <div className="flex items-start justify-between gap-3">
                <StepIllu kind={step.kind} text={ph.text} size="l" live className="shrink-0 max-sm:size-12" />
                <div className="grid min-w-0 flex-1 gap-1">
                  <span className="label text-accent">
                    {batches > 1 && ph.batch ? `Fournée ${ph.batch} sur ${batches} · ` : ""}
                    {i + 1} sur {step.phases!.length}
                    {ph.wait ? " · attente, fais autre chose" : ""}
                  </span>
                  <b className="text-[clamp(1.25rem,2.4vw,1.6rem)] leading-tight">{ph.text}</b>
                  {ph.hobLevel != null && <Induction level={ph.hobLevel} />}
                </div>
                <span className={`num-tight shrink-0 text-[clamp(2.6rem,7vw,3.6rem)] leading-none font-extrabold text-ink`} aria-live="off">
                  {t ? mmss(Math.max(0, t.endsAt - now)) : `${fmtMin(ph.min)}`}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {t ? (
                  <Button size="sm" variant="secondary" icon="plus" onClick={() => c.addMinutes(t, 1)}>
                    1 min
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" icon="clock" onClick={() => c.startPhase(step)}>
                    Lancer {fmtMin(ph.min)}
                  </Button>
                )}
                {i < step.phases!.length - 1 && (
                  <Button size="sm" variant="quiet" onClick={() => c.skipPhase(step)}>
                    Suivante maintenant
                  </Button>
                )}
              </div>
            </li>
          );
        return (
          <li key={i} className={`flex items-center gap-3 px-1 text-[17px] ${done ? "opacity-55" : onInk ? "" : "text-ink-2"}`}>
            <span className={`grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-bold ${done ? "bg-accent text-on-accent" : "border border-line-strong"}`}>{done ? <Icon name="check" size="s" /> : i + 1}</span>
            <span className={`min-w-0 flex-1 ${done ? "line-through decoration-1" : ""} ${ph.wait ? "italic" : ""}`}>{ph.text}</span>
            <span className="num shrink-0">
              {ph.wait && <Icon name="clock" size="s" className="mr-1 inline align-[-2px]" />}
              {fmtMin(ph.min)}
            </span>
          </li>
        );
  }
}

const fmtMin = (m: number) => (m < 1 ? `${Math.round(m * 60)} s` : `${Number.isInteger(m) ? m : m.toFixed(1).replace(".", ",")} min`);

/** Minutes d’un minuteur proposé pour une étape : l’attente s’il y en a, sinon la durée. */
export const timerMinutes = (step: PlanStep) => Math.round(passiveMin(step) >= 3 ? passiveMin(step) : step.durationMin);

/** « Fait, étape suivante » (espace), minuteur de l’étape, « Finie » sans lancer la suivante. */
export function StepActions({ c, step, compact }: { c: Controls; step: PlanStep; compact?: boolean }) {
  const st = stepStatus(c.state, step.id);
  const timer = stepTimer(c.state, step.id);
  const auto = st === "active" && !timer && passiveMin(step) >= 3;
  const ph = st === "active" ? currentPhase(c.state, step) : null;
  const morePhases = ph != null && ph < step.phases!.length - 1;
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <Button variant="primary" size="kitchen" icon={st === "todo" ? "play" : "check"} onClick={c.next} data-action="fait" className="w-full">
        {st === "todo" ? "Commencer" : morePhases ? "Sous-étape suivante" : auto ? `Fait · minuteur ${timerMinutes(step)} min` : "Fait, étape suivante"}
      </Button>
      <div className="flex gap-3">
        {/* Retour : ordinateur seulement (le téléphone garde deux boutons). */}
        <Button size="kitchen" variant="secondary" onClick={c.back} className="hidden flex-1 lg:inline-flex" title="Revenir à la sous-étape ou à l’étape d’avant (flèche gauche)">
          <Icon name="chev" className="rotate-180" /> Retour
        </Button>
        {st === "active" && (
          <Button size="kitchen" variant="quiet" onClick={() => c.toggleStep(step)} className="flex-1" title="Marquer l’étape finie sans lancer la suivante">
            Finie
          </Button>
        )}
      </div>
      {!compact && (
        <p className="hidden text-small text-ink-2 sm:col-span-2 lg:block">
          <kbd className="rounded-[8px] border border-line bg-surface-2 px-2 font-sans text-[12px]">espace</kbd> = bouton principal ·{" "}
          <kbd className="rounded-[8px] border border-line bg-surface-2 px-2 font-sans text-[12px]">←</kbd> = retour
        </p>
      )}
    </div>
  );
}

export function AllDone({ c }: { c: Controls }) {
  return (
    <div className="grid animate-pop justify-items-center gap-3 rounded-[14px] border-2 border-ink bg-surface p-6 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-accent-soft text-accent">
        <Icon name="check" size="l" />
      </span>
      <p className="font-display text-[28px] font-extrabold">Tout est cuit</p>
      <p className="text-ink-2">Refroidis vite, filme, frigo. Le bilan prévu / réel suit.</p>
      <Button variant="primary" size="kitchen" icon="check" onClick={() => c.setStatus("done")}>
        Terminer la session
      </Button>
    </div>
  );
}

// ─── Le plan : durées, choix, manques ───

export function Summary({ plan }: { plan: SessionPlan }) {
  const mode = modeOf(plan);
  const n = usePeople();
  const busy = (p: Person) => plan.prep.tasks.filter((t) => t.person === p).reduce((x, t) => x + t.minutes, 0) + plan.steps.filter((x) => x.person === p).reduce((x, st) => x + st.activeMin, 0);
  const cells: [string, string][] =
    mode === "duo" && plan.eve
      ? [
          ["La veille (faite)", dur(plan.eve.minutes)],
          ["Le jour J, à deux", dur(plan.totalMin)],
          [`${n.A.name} · ${n.B.name} en action`, `${dur(busy("A"))} · ${dur(busy("B"))}`],
        ]
      : mode === "duo"
        ? [
            ["À deux", dur(plan.totalMin)],
            [`${n.A.name}, en action`, dur(busy("A"))],
            [`${n.B.name}, en action`, dur(busy("B"))],
          ]
        : mode === "veille"
          ? [
              ["La veille", dur(plan.prep.eveMin ?? 0)],
              ["Le jour J : prep", dur(plan.prep.minutes)],
              ["Puis cuisson", dur(plan.cookingMin)],
            ]
          : [
              ["Prep", dur(plan.prep.minutes)],
              ["Cuisson", dur(plan.cookingMin)],
              ["Total", dur(plan.totalMin)],
            ];
  return (
    <dl className="grid grid-cols-3 gap-2">
      {cells.map(([l, v]) => (
        <div key={l} className="rounded-[8px] border border-line bg-surface px-3 py-2">
          <dt className="text-[12px] text-ink-2">{l}</dt>
          <dd className="num text-[20px] font-extrabold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Ce que le planificateur a choisi et doit dire (braisage sur la plaque…). */
export function Decisions({ plan }: { plan: SessionPlan }) {
  if (!plan.decisions?.length) return null;
  return (
    <div className="grid gap-2">
      {plan.decisions.map((d) => (
        <Alert key={d} tone="info" icon="sliders" title="Choix du planificateur">
          {d}
        </Alert>
      ))}
    </div>
  );
}

export function Issues({ plan, sessionId }: { plan: SessionPlan; sessionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  return (
    <>
      {plan.errors.length > 0 && (
        <Alert tone="ko" title="Le plan ne tient pas" role="alert">
          <ul className="mt-1 list-disc space-y-1 pl-6">
            {plan.errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </Alert>
      )}
      {plan.shortages.length > 0 && (
        <Alert tone="warn" title="Il manque des ingrédients à la commande">
          <ul className="mt-1 space-y-1">
            {plan.shortages.map((s) => (
              <li key={s.recipeIngredientId} className="num">
                {s.item} : {Math.round(s.gramsBought)} g commandés sur {Math.round(s.gramsNeeded)} g ({recipeOf(plan, s.recipeSlug)?.name})
              </li>
            ))}
          </ul>
          <span className="mt-2 flex flex-wrap gap-2">
            {plan.scaleSuggestions.map((x) => (
              <Button
                key={x.recipeSlug}
                size="sm"
                variant="secondary"
                state={pending ? "loading" : "idle"}
                loadingLabel="Je refais le plan…"
                onClick={() =>
                  start(async () => {
                    const scales = Object.fromEntries(plan.recipes.map((r) => [r.slug, r.scale]));
                    scales[x.recipeSlug] = x.factor;
                    await applyScales(sessionId, scales);
                    router.refresh();
                  })
                }
              >
                Réduire {recipeOf(plan, x.recipeSlug)?.name} à {Math.round(x.factor * 100)} %
              </Button>
            ))}
          </span>
        </Alert>
      )}
      {plan.warnings.length > 0 && (
        <div className="rounded-[8px] border border-line bg-surface px-4 py-3 text-[14px]">
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 text-left text-ink-2">
            <span className="flex items-center gap-2">
              <Icon name="info" size="s" />
              {plan.warnings.length} remarque{plan.warnings.length > 1 ? "s" : ""} du planificateur
            </span>
            <Icon name={open ? "minus" : "plus"} size="s" />
          </button>
          {open && (
            <ul className="mt-2 list-disc space-y-1 pl-6 animate-pop">
              {plan.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

/** Le plan en entier, replié pendant la cuisson : durées, origine des durées, choix du planificateur. */
export function PlanDetails({ plan, open = false }: { plan: SessionPlan; open?: boolean }) {
  return (
    <details open={open} className="group rounded-[14px] border border-line bg-surface px-4 py-3 text-[14px]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-bold [&::-webkit-details-marker]:hidden">
        Le plan
        <Icon name="chev" size="s" className="transition-transform group-open:rotate-90" />
      </summary>
      <div className="mt-3 grid gap-3">
        <Summary plan={plan} />
        <DurationOrigin plan={plan} />
        <Decisions plan={plan} />
      </div>
    </details>
  );
}

// ─── Prep la veille : reprise le jour J ───

/** Prep la veille, le jour J : seul (le plan de la veille) ou à deux (plan du jour J refait). */
export function ResumeChoice({ plan, c, choice, big }: { plan: SessionPlan; c: Controls; choice: DayChoice | null; big?: boolean }) {
  const solo = choice?.solo ?? { prepMin: plan.prep.minutes, cookingMin: plan.cookingMin, totalMin: plan.prep.minutes + plan.cookingMin };
  const busy = c.resuming != null;
  const n = usePeople();
  // Les durées du jour J se calculent au rendu serveur : si l’écran vient de passer « au frigo », on les redemande.
  const router = useRouter();
  const stale = !choice?.duo;
  useEffect(() => {
    if (stale) router.refresh();
  }, [stale, router]);
  const card = `grid w-full content-start gap-2 rounded-[14px] border-2 border-line bg-surface px-4 text-left transition-[border-color,transform] duration-[var(--dur-quick)] hover:border-accent active:scale-[0.98] disabled:opacity-50 ${big ? "min-h-28 py-4" : "min-h-24 py-4"}`;
  return (
    <div className="grid gap-2">
      <Eyebrow>Le jour J, tu cuisines…</Eyebrow>
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" disabled={busy} onClick={() => c.resume("solo")} className={card} data-action="reprendre-seul">
          <span className="flex items-center gap-3">
            <Icon name="flame" size={big ? "l" : "m"} className="text-accent" />
            <b className={`font-display ${big ? "text-[24px]" : "text-[20px]"}`}>Seul</b>
          </span>
          <span className="num text-[17px] text-ink-2">
            {dur(solo.prepMin)} de prep, puis {dur(solo.cookingMin)} de cuisson · <b className="text-ink">{dur(solo.totalMin)}</b>
          </span>
        </button>
        <button type="button" disabled={busy} onClick={() => c.resume("duo")} className={card} data-action="reprendre-a-deux">
          <span className="flex items-center gap-3">
            <span className="flex -space-x-2">
              <PersonMono person="A" size={big ? 30 : 26} />
              <PersonMono person="B" size={big ? 30 : 26} />
            </span>
            <b className={`font-display ${big ? "text-[24px]" : "text-[20px]"}`}>{c.resuming === "duo" ? "Je refais le plan à deux…" : "À deux"}</b>
          </span>
          <span className="num text-[17px] text-ink-2">
            {choice?.duo ? (
              <>
                <b className="text-ink">{dur(choice.duo.totalMin)}</b> · {n.A.name} {dur(choice.duo.aMin)} en action, {n.B.name} {dur(choice.duo.bMin)}
              </>
            ) : (
              `deux fils, ${n.A.name} et ${n.B.name}`
            )}
            {" · "}les bols du frigo restent prêts
          </span>
        </button>
      </div>
    </div>
  );
}

// ─── Fin de session ───

export function DoneView({ plan, c, startedAt }: { plan: SessionPlan; c: Controls; startedAt: string | null }) {
  const test = useContext(SessionTest) != null;
  return (
    <div className="grid gap-12">
      <FridgeDone plan={plan} events={c.events} test={test} />
      {!test && <SessionBoxes id={c.id} plan={plan} />}
      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-6">
        <div className="min-w-0 flex-1">
          <h2 className="text-h2">{test ? "Bilan du test" : "Bilan de la session"}</h2>
          <p className="mt-2 text-[17px] text-ink-2">{test ? "Prévu et réel, comme pour une vraie session. Rien n’est compté." : "Prévu et réel, geste par geste. Ces durées corrigent les prochaines sessions."}</p>
        </div>
        <Button variant="quiet" icon="refresh" onClick={() => c.setStatus("cooking")}>
          Rouvrir la session
        </Button>
      </div>
      <DurationReport plan={plan} events={c.events} startedAt={startedAt} />
      <PlanDetails plan={plan} />
    </div>
  );
}

/** Relais d’une personne à venir (à deux) : « B libère le faitout pour A », à l’heure prévue. */
export function handoffsFor(plan: SessionPlan, c: Controls, person: Person) {
  return (plan.handoffs ?? []).filter((h) => (h.to === person || h.from === person) && stepStatus(c.state, h.toStepId) === "todo");
}
export function Handoff({ plan, c, h }: { plan: SessionPlan; c: Controls; h: NonNullable<SessionPlan["handoffs"]>[number] }) {
  void plan;
  const n = usePeople();
  return (
    <HandoffRow from={h.from} at={clock(c.cookingStart + h.atMin * 60000)}>
      {handoffLine(h, n)}
    </HandoffRow>
  );
}
