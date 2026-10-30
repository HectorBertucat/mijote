"use client";

// Vue téléphone, posé à côté du feu (DA « Session sur téléphone ») : plein écran par-dessus la
// navigation, l'écran reste allumé (Wake Lock). Pendant la cuisson, fond d'encre quel que soit le
// thème (.kitchen-dark) : l'étape en text-step, le minuteur en text-giant, deux gros boutons fixes
// en bas. Prep : le prochain bol en grand, les bols et les gestes à cocher. Au frigo : la reprise.
import { FridgeDone } from "./FridgeDone";
import { SessionBoxes } from "./SessionBoxes";
import { DropGuide, wantsDropGuide } from "./DropGuide";
import { useContext } from "react";
import Link from "next/link";
import type { Person, SessionPlan } from "@/lib/session/planner";
import { batchOf, currentPhase, passiveMin, phaseTimer, stepStatus } from "@/lib/session/state";
import { Button, Icon, Induction, OvenLevel } from "@/components/ui";
import type { Controls, DayChoice } from "./SessionApp";
import { PhasePanel, ResumeChoice, timerMinutes } from "./blocks";
import { DuringBowls, PrepBowlRow, PrepGesture, prepScope } from "./Prep";
import { DuoPhone, DuoPick } from "./DuoView";
import { Bowl, BowlFoods, bowlName, bowlOf, bowlOrdered, bowlQty, clock, cueParts, Eyebrow, hobName, mmss, NextCard, RecipeMark, recipeOf, SessionHead, SessionTest, splitStep, TimerList, useWakeLock, WakePill } from "./parts";
import { StepIllu } from "@/components/illus/Illu";

export function PhoneView({ plan, c, person, choice }: { plan: SessionPlan; c: Controls; person?: Person | null; choice?: DayChoice | null }) {
  const { state } = c;
  const wake = useWakeLock();
  const cooking = state.status === "cooking";
  return (
    <div className={`fixed inset-0 z-30 overflow-y-auto bg-bg text-ink ${cooking ? "kitchen-dark" : ""}`} onPointerDown={() => !wake.on && void wake.request()}>
      <div className="pt-[env(safe-area-inset-top)]">
        {c.mode === "duo" ? (
          person ? (
            <DuoPhone plan={plan} c={c} person={person} wake={wake} />
          ) : (
            <DuoPick />
          )
        ) : state.status === "fridge" ? (
          <PhoneFridge plan={plan} c={c} choice={choice ?? null} wake={wake} />
        ) : state.status === "prep" || state.status === "planned" ? (
          <PhonePrep plan={plan} c={c} wake={wake} />
        ) : state.status === "done" || state.status === "abandoned" ? (
          <PhoneDone plan={plan} c={c} />
        ) : (
          <PhoneCook plan={plan} c={c} wake={wake} />
        )}
      </div>
    </div>
  );
}

type Wake = { on: boolean; request: () => Promise<void> };

const fullLink = (
  <Link href="?" className="text-[13px] underline-offset-2 opacity-75 hover:underline">
    vue complète
  </Link>
);

function BottomBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[color-mix(in_srgb,var(--c-bg)_92%,transparent)] px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-md">
      <div className="mx-auto max-w-lg">{children}</div>
    </div>
  );
}

// ─── Cuisson : fond d'encre, l'étape, le minuteur, deux boutons ───

function PhoneCook({ plan, c, wake }: { plan: SessionPlan; c: Controls; wake: Wake }) {
  const { state, focus, upcoming, now, cookingStart } = c;
  if (!focus)
    return (
      <div className="mx-auto grid max-w-lg gap-4 px-4 pt-10 text-center">
        <Icon name="check" size="l" className="justify-self-center" />
        <p className="font-display text-[36px] font-extrabold">Tout est cuit</p>
        <Button variant="ink" size="kitchen" icon="check" onClick={() => c.setStatus("done")} className="min-h-[88px]">
          Terminer la session
        </Button>
        {fullLink}
      </div>
    );
  const st = stepStatus(state, focus.id);
  const { head, rest } = splitStep(focus.text);
  const recipe = recipeOf(plan, focus.recipeSlug);
  const timer = c.timers.find((t) => t.stepId === focus.id && t.phase == null);
  const ph = st === "active" ? currentPhase(state, focus) : null;
  const phTimer = ph != null ? phaseTimer(state, focus.id, ph) : undefined;
  const morePhases = ph != null && ph < focus.phases!.length - 1;
  const others = c.timers.filter((t) => t !== timer && t !== phTimer);
  const auto = st === "active" && !timer && passiveMin(focus) >= 3;
  const cue = focus.cue ? cueParts(focus.cue) : null;
  const done = plan.steps.filter((s) => stepStatus(state, s.id) === "done").length;
  const late = st === "todo" ? Math.round((now - (cookingStart + focus.startMin * 60000)) / 60000) : 0;
  return (
    <>
      <div className="mx-auto flex min-h-[calc(100dvh-env(safe-area-inset-top))] max-w-lg flex-col gap-4 px-[18px] pt-3 pb-[calc(env(safe-area-inset-bottom)+8.5rem)]">
        <div className="flex items-center justify-between gap-2 text-[14px] text-ink-2">
          <span className="flex items-center gap-2 whitespace-nowrap">
            <RecipeMark plan={plan} slug={focus.recipeSlug} />
            étape {focus.no} sur {plan.steps.length}
            {st === "active" && batchOf(state, focus) ? ` · fournée ${batchOf(state, focus)!.at}/${batchOf(state, focus)!.of}` : ""}
            <span className={`size-2 rounded-full bg-current ${c.online ? "k-live" : "opacity-40"}`} title={c.online ? "en direct" : "reconnexion…"} />
          </span>
          <WakePill wake={wake} onInk={false} />
        </div>
        <p className="-mb-2 text-[14px] font-bold uppercase tracking-[0.1em] text-ink-2">
          {st === "todo" ? `À lancer · prévue ${clock(cookingStart + focus.startMin * 60000)}${late > 2 ? ` · ${late} min de retard` : ""}` : "Maintenant"}
          {recipe ? ` · ${recipe.name}` : ""}
        </p>
        <div className="flex items-center gap-3.5">
          <StepIllu kind={focus.kind} text={focus.text} size={76} live={st === "active"} className="illu-tile shrink-0" style={{ "--tile": recipe?.color ?? "var(--c-ink-3)" }} />
          <h1 className="min-w-0 font-display text-[clamp(2rem,10vw,2.6rem)] leading-[1.05] font-extrabold tracking-[-0.02em] [font-stretch:88%]">{head}</h1>
        </div>
        <PhasePanel c={c} step={focus} onInk />
        {(focus.hobId || focus.equipmentName) && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            {focus.hobId && focus.hobLevel != null && !focus.hobLevelLabel && <Induction level={focus.hobLevel} size="big" />}
            {focus.hobLevelLabel && <span className="num text-[40px] leading-none font-extrabold">{focus.hobLevelLabel}</span>}
            <span className="text-[18px] leading-tight text-ink-2">
              {focus.equipmentName}
              {focus.hobId && (
                <>
                  <br />
                  {hobName(plan, focus.hobId)}
                </>
              )}
            </span>
            {focus.oven && (
              <span className="flex items-center gap-2.5 text-[18px] text-ink-2">
                {focus.oven.levels[0] ? <OvenLevel level={focus.oven.levels[0]} /> : <Icon name="oven" />}
                <b className="num text-[28px] text-ink">{focus.oven.temp} °C</b>
                {focus.oven.levels.length ? `niveau${focus.oven.levels.length > 1 ? "x" : ""} ${focus.oven.levels.join(" et ")}` : ""}
              </span>
            )}
          </div>
        )}
        {wantsDropGuide(focus, ph, st === "active") && <DropGuide onInk />}
        {cue && (
          <p className="text-[18px] leading-snug text-ink-2">
            <q className="font-bold text-ink" style={{ quotes: '"« " " »"' }}>
              {cue.quote}
            </q>{" "}
            {cue.rest}
          </p>
        )}
        {rest && <p className={`leading-snug ${focus.phases?.length ? "text-[15px] text-ink-2" : "text-[18px]"}`}>{rest}</p>}
        {focus.notes.map((n) => (
          <p key={n} className="rounded-[12px] border border-line px-3.5 py-2.5 text-[16px]">
            {n}
          </p>
        ))}
        {focus.bowls.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <Eyebrow>{focus.tasks ? "Remplis" : "Prends"}</Eyebrow>
            {focus.bowls.map((l) => {
              const b = bowlOf(plan, l);
              return b ? <Bowl key={l} bowl={b} size="lg" ready={state.bowlsReady.has(l)} /> : null;
            })}
          </div>
        )}
        {timer && (
          <div className="mt-auto grid justify-items-center gap-1 pt-2">
            <span className="text-[15px] text-ink-2">{timer.label}</span>
            <span className="num-tight text-[clamp(5rem,28vw,var(--text-giant))] leading-none font-extrabold" aria-live="off">
              {mmss(timer.endsAt - now)}
            </span>
          </div>
        )}
        {others.length > 0 && <TimerList plan={plan} timers={others} now={now} onAdd={c.addMinutes} onStop={c.stopTimer} empty={false} />}
        {upcoming && <NextCard plan={plan} step={upcoming} at={cookingStart + upcoming.startMin * 60000} />}
        <p className="num flex justify-center gap-3 text-center text-[13px] text-ink-2">
          {done} / {plan.steps.length} étapes faites · {fullLink}
        </p>
      </div>
      <BottomBar>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2.5">
          {phTimer ? (
            <Button size="kitchen" onClick={() => c.addMinutes(phTimer, 1)} className="min-h-[88px]" icon="plus">
              1 min
            </Button>
          ) : timer ? (
            <Button size="kitchen" onClick={() => c.addMinutes(timer, 1)} className="min-h-[88px]" icon="plus">
              1 min
            </Button>
          ) : st === "active" ? (
            <Button size="kitchen" variant="secondary" onClick={() => c.toggleStep(focus)} className="min-h-[88px]">
              Finie
            </Button>
          ) : (
            <span />
          )}
          <Button variant="ink" size="kitchen" icon={st === "todo" ? "play" : "check"} onClick={c.next} className="min-h-[88px] text-[22px]" data-action="fait">
            {st === "todo" ? "Commencer" : morePhases ? "Suivante" : auto ? `Fait · ${timerMinutes(focus)} min` : "Fait"}
          </Button>
        </div>
      </BottomBar>
    </>
  );
}

// ─── Prep : le prochain bol en grand ───

function PhonePrep({ plan, c, wake }: { plan: SessionPlan; c: Controls; wake: Wake }) {
  const { state } = c;
  const p = prepScope(plan, c);
  const next = p.bowls.find((b) => !state.bowlsReady.has(b.letter));
  const ordered = next ? bowlOrdered(next) : "";
  const used = next?.usedBy ? plan.steps.find((s) => s.id === next.usedBy!.stepId) : null;
  return (
    <>
      <SessionHead
        compact
        title={p.evening ? "Prep de la veille" : "Prep"}
        sub={`${p.ready} bol${p.ready > 1 ? "s" : ""} prêt${p.ready > 1 ? "s" : ""} sur ${p.bowls.length} · ${p.done} geste${p.done > 1 ? "s" : ""} sur ${p.tasks.length}`}
        online={c.online}
        right={
          <span className="flex items-center gap-2">
            <WakePill wake={wake} />
            {fullLink}
          </span>
        }
      />
      <div className="mx-auto grid max-w-lg gap-4 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+8.5rem)]">
        {next ? (
          <div key={next.letter} className="grid animate-pop gap-3 rounded-[18px] border-2 border-ink bg-surface p-4">
            <Eyebrow>Prochain bol</Eyebrow>
            <div className="flex items-center gap-4">
              <Bowl bowl={next} size="xl" />
              <div className="min-w-0">
                <b className="block font-display text-[24px] leading-tight [font-stretch:100%]">{bowlName(next)}</b>
                {bowlQty(next) && <span className="num block text-[16px] text-ink-2">{bowlQty(next)}</span>}
                <BowlFoods bowl={next} live className="mt-1.5" />
              </div>
            </div>
            {used && (
              <p className="text-[15px] text-ink-2">
                Sert à l&apos;<b className="text-ink">étape {used.no}</b> · {recipeOf(plan, next.recipeSlug)?.name}
              </p>
            )}
            {ordered && (
              <p className="flex items-center gap-1.5 text-[14px] text-ink-2">
                <Icon name="basket" size="s" />
                {ordered}
              </p>
            )}
          </div>
        ) : (
          <div className="grid justify-items-center gap-2 rounded-[18px] border-2 border-ink bg-surface p-5 text-center">
            <Icon name="check" size="l" className="text-accent" />
            <b className="font-display text-[22px]">Tous les bols sont prêts</b>
          </div>
        )}
        <div className="grid grid-cols-5 gap-2.5">
          {p.bowls.map((b) => (
            <button key={b.letter} type="button" onClick={() => c.toggleBowl(b.letter)} aria-pressed={state.bowlsReady.has(b.letter)} className={`grid place-items-center rounded-full active:scale-95 ${state.bowlsReady.has(b.letter) ? "opacity-55" : ""}`}>
              <Bowl bowl={b} size="lg" ready={state.bowlsReady.has(b.letter)} />
            </button>
          ))}
        </div>
        {p.duringBowls.length > 0 && <DuringBowls plan={plan} />}
        {p.tasks.length > 0 && (
          <section className="grid gap-2">
            <Eyebrow>Gestes</Eyebrow>
            {p.tasks.map((t) => (
              <PrepGesture key={t.id} plan={plan} c={c} t={t} />
            ))}
          </section>
        )}
        <Button variant="secondary" size="kitchen" icon={p.evening ? "fridge" : "flame"} onClick={() => c.setStatus(p.evening ? "fridge" : "cooking")} block>
          {p.evening ? "C'est au frigo · à demain" : "Passer à la cuisson"}
        </Button>
      </div>
      <BottomBar>
        {next ? (
          <Button variant="primary" size="kitchen" icon="check" block onClick={() => c.toggleBowl(next.letter)} className="min-h-[80px] text-[22px]">
            Bol {next.letter} prêt
          </Button>
        ) : (
          <Button variant="primary" size="kitchen" icon={p.evening ? "fridge" : "flame"} block onClick={() => c.setStatus(p.evening ? "fridge" : "cooking")} className="min-h-[80px] text-[22px]">
            {p.evening ? "C'est au frigo" : "Passer à la cuisson"}
          </Button>
        )}
      </BottomBar>
    </>
  );
}

// ─── Au frigo : reprise ───

function PhoneFridge({ plan, c, choice, wake }: { plan: SessionPlan; c: Controls; choice: DayChoice | null; wake: Wake }) {
  const inFridge = plan.bowls.filter((b) => c.state.bowlsReady.has(b.letter));
  const first = plan.steps[0];
  return (
    <>
      <SessionHead compact title="Reprise" sub={`${inFridge.length} bols au frigo`} online={c.online} right={<span className="flex items-center gap-2"><WakePill wake={wake} />{fullLink}</span>} />
      <div className="mx-auto grid max-w-lg gap-4 px-4 pt-4 pb-10">
        <div className="grid justify-items-center gap-2.5 rounded-[18px] border border-line bg-surface px-4 py-6 text-center">
          <span className="grid size-[72px] place-items-center rounded-full bg-surface-2 text-ink-2">
            <Icon name="moonset" size="l" />
          </span>
          <b className="font-display text-[22px]">Prep d&apos;hier terminée</b>
          <p className="max-w-[34ch] text-[15px] text-ink-2">
            {inFridge.length} bol{inFridge.length > 1 ? "s" : ""} au frigo, filmé{inFridge.length > 1 ? "s" : ""}. Le jour J : le reste de la prep, puis la cuisson{first ? `, qui commence à l'étape ${first.no}` : ""}.
          </p>
        </div>
        <ResumeChoice plan={plan} c={c} choice={choice} big />
        <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
          {inFridge.map((b) => (
            <PrepBowlRow key={b.letter} plan={plan} c={c} b={b} fridge />
          ))}
        </div>
      </div>
    </>
  );
}

function PhoneDone({ plan, c }: { plan: SessionPlan; c: Controls }) {
  const test = useContext(SessionTest) != null;
  return (
    <div className="mx-auto grid max-w-lg justify-items-center gap-4 px-4 pt-8 text-center">
      <FridgeDone plan={plan} events={c.events} compact />
      {!test && (
        <div className="w-full">
          <SessionBoxes id={c.id} plan={plan} />
        </div>
      )}
      <p className="text-ink-2">Le bilan prévu / réel est sur la vue complète.</p>
      <Link href="?" className="font-semibold text-accent">
        Voir le bilan
      </Link>
      <Button variant="quiet" icon="refresh" onClick={() => c.setStatus("cooking")}>
        Rouvrir la session
      </Button>
    </div>
  );
}
