"use client";

// Phase 2, la cuisson (DA « Session · cuisson ») : l’étape en cours en très grand, la suivante en
// pointillé, le bol à prendre, ce qui tourne en fond, le fil des étapes, les minuteurs et le
// schéma des foyers et du four. Ordinateur : fil | étape | minuteurs et ressources ; iPad : deux
// colonnes, le fil sous l’étape ; téléphone sans ?vue=telephone : une colonne.
import { useEffect, useRef, type ReactNode } from "react";
import type { SessionPlan } from "@/lib/session/planner";
import { batchOf, stepStatus } from "@/lib/session/state";
import { Button } from "@/components/ui";
import { Lanes, RestartButtons } from "./guide";
import type { Controls } from "./SessionApp";
import { AllDone, NowCard, PlanDetails } from "./blocks";
import { clock, dur, Eyebrow, PauseAll, RecipeMark, Resources, stepTitle, TimerList } from "./parts";

export function CookPhase({ plan, c, side }: { plan: SessionPlan; c: Controls; side?: ReactNode }) {
  const { state, focus, now, cookingStart } = c;
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_320px]">
      <div className="grid min-w-0 content-start gap-6 md:col-start-1 md:row-start-1 xl:col-start-2">
        {focus ? <NowCard plan={plan} c={c} step={focus} /> : <AllDone c={c} />}
        <Lanes plan={plan} c={c} focus={focus} />
      </div>

      <aside className="grid min-w-0 content-start gap-4 md:col-start-2 md:row-span-2 md:row-start-1 xl:col-start-3 xl:row-span-1 md:sticky md:top-4 md:self-start">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>Minuteurs</Eyebrow>
          <PauseAll timers={c.timers} now={now} allPaused={c.allPaused} onClick={c.pauseAll} />
        </div>
        <TimerList plan={plan} timers={c.timers.filter((t) => !(t.phase != null && t.stepId === focus?.id))} now={now} onAdd={c.addMinutes} onStop={c.stopTimer} onFinish={c.finishTimer} onCancel={c.cancelTimer} onAdjust={c.adjustTimer} onReset={c.resetTimer} onPause={c.pauseTimer} />
        <Eyebrow className="mt-1">Foyers et four</Eyebrow>
        <Resources plan={plan} state={state} now={now} cookingStart={cookingStart} scale={0.9} />
        {side}
        <PlanDetails plan={plan} />
        <Button variant="quiet" icon="check" onClick={() => c.setStatus("done")} block>
          Terminer la session
        </Button>
        <RestartButtons id={c.id} />
      </aside>

      <Feed plan={plan} c={c} />
    </div>
  );
}

/** Fil de la session (DA `.feed/.fstep`) : fait, en cours, à venir ; toucher une étape la lance, la finit ou la rouvre. */
function Feed({ plan, c }: { plan: SessionPlan; c: Controls }) {
  const { state, focus, cookingStart } = c;
  const ref = useRef<HTMLOListElement>(null);
  const done = plan.steps.filter((s) => stepStatus(state, s.id) === "done").length;
  useEffect(() => {
    if (!focus) return;
    const box = ref.current;
    const el = box?.querySelector<HTMLElement>(`[data-step="${CSS.escape(focus.id)}"]`);
    if (box && el) box.scrollTo({ top: el.offsetTop - 8, behavior: "smooth" });
  }, [focus?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="grid min-w-0 content-start gap-3 md:col-start-1 md:row-start-2 xl:col-start-1 xl:row-start-1 xl:sticky xl:top-4 xl:self-start" aria-label="Fil de la session">
      <div className="flex items-baseline justify-between">
        <Eyebrow>Fil de la session</Eyebrow>
        <span className="num text-small text-ink-2">
          {done} sur {plan.steps.length}
        </span>
      </div>
      <ol ref={ref} className="relative grid max-h-[70vh] gap-2 overflow-y-auto pr-1 xl:max-h-[calc(100dvh-12rem)]">
        {plan.steps.map((s) => {
          const st = stepStatus(state, s.id);
          const cur = s.id === focus?.id;
          return (
            <li key={s.id} data-step={s.id}>
              <button
                type="button"
                onClick={() => c.toggleStep(s)}
                className={`grid w-full gap-1 rounded-[8px] bg-surface px-4 py-3 text-left transition-[opacity,border-color] duration-[var(--dur-base)] ${cur ? "border-2 border-ink" : "border border-line hover:border-line-strong"} ${st === "done" ? "opacity-55" : ""}`}
              >
                <span className="flex items-center justify-between gap-2 text-[12px] font-semibold text-ink-2">
                  <span className="flex items-center gap-2">
                    <RecipeMark plan={plan} slug={s.recipeSlug} />
                    {st === "done" ? "fait" : st === "active" ? `en cours${batchOf(state, s) ? ` · fournée ${batchOf(state, s)!.at}/${batchOf(state, s)!.of}` : ""}` : clock(cookingStart + s.startMin * 60000)}
                  </span>
                  <span className="num">{dur(s.durationMin)}</span>
                </span>
                <b className={`text-[17px] leading-snug ${st === "done" ? "line-through decoration-1" : ""}`}>
                  Étape {s.no} · {stepTitle(plan, s)}
                </b>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
