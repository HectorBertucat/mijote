"use client";

// Vue simple à deux : chacun son fil (gestes de prep et étapes mêlés, comme le planificateur les a
// répartis), une consigne à la fois. Téléphone d'une personne (?personne=A ou B) : son fil seul, son
// « Suivant » en bas. Grand écran sans personne : les deux fils côte à côte, touches A et B.
// Les relais (qui libère quoi) et ce qui sonne bientôt restent ; le reste est dans la vue détaillée.
import type { Person, PrepTask, SessionPlan } from "@/lib/session/planner";
import { currentPhase, itemStatus, passiveMin, personFocus, personNext, stepTimer, threadOf, type ThreadItem, type TimerState } from "@/lib/session/state";
import { Icon, RecipeTile } from "@/components/ui";
import { FoodIllu, StepIllu } from "@/components/illus/Illu";
import type { Controls } from "./SessionApp";
import { handoffsFor, timerMinutes } from "./blocks";
import { prepTitle } from "./Prep";
import { Bowl, bowlOf, clock, HandoffRow, PersonMono, recipeOf, stepTitle } from "./parts";
import { MainButton, personOf, RingBar, Ringing, Shell, SimpleHead, Soon, StepNow } from "./Simple";

type Wake = { on: boolean; request: () => Promise<void> };

export function SimpleDuo({ plan, c, person, overlay, dark, wake, detail, onEnd, ringing }: { plan: SessionPlan; c: Controls; person: Person | null; overlay: boolean; dark: boolean; wake: Wake; detail: string; onEnd: () => void; ringing: TimerState[] }) {
  if (person) {
    const mine = ringing.filter((t) => personOf(plan, t) !== (person === "A" ? "B" : "A"));
    const thread = threadOf(plan, person);
    const done = thread.filter((it) => itemStatus(c.state, it) === "done").length;
    return (
      <Shell overlay={overlay} dark={dark} wakeOn={wake.on} onWake={() => void wake.request()} bar={<PersonBar plan={plan} c={c} person={person} ringing={mine} />}>
        <SimpleHead plan={plan} c={c} stage="cook" wake={wake} detail={detail} overlay={overlay} onEnd={onEnd} lead={<PersonMono person={person} size={30} />} title={`Fil de ${person} · ${done} sur ${thread.length}`} />
        <PersonNow plan={plan} c={c} person={person} ringing={mine} />
      </Shell>
    );
  }
  return (
    <Shell overlay={overlay} dark={dark} wakeOn={wake.on} onWake={() => void wake.request()} bar={null} wide>
      <SimpleHead plan={plan} c={c} stage="cook" wake={wake} detail={detail} overlay={overlay} onEnd={onEnd} title="Session à deux" />
      <div className="grid gap-6 md:grid-cols-2">
        {(["A", "B"] as const).map((p) => {
          const mine = ringing.filter((t) => personOf(plan, t) !== (p === "A" ? "B" : "A"));
          return (
            <section key={p} className="grid content-start gap-4" aria-label={`Fil de ${p}`}>
              <h2 className="flex items-center gap-2.5 px-4 font-display text-[20px] font-extrabold">
                <PersonMono person={p} size={34} />
                Fil de {p}
                <kbd className="ml-auto rounded-[5px] border border-line bg-surface-2 px-1.5 font-sans text-[12px] font-normal text-ink-2">touche {p}</kbd>
              </h2>
              <PersonNow plan={plan} c={c} person={p} ringing={mine} />
              <div className="px-4">
                <PersonBar plan={plan} c={c} person={p} ringing={mine} who={p} />
              </div>
            </section>
          );
        })}
      </div>
    </Shell>
  );
}

function PersonNow({ plan, c, person, ringing }: { plan: SessionPlan; c: Controls; person: Person; ringing: TimerState[] }) {
  if (ringing.length) return <Ringing plan={plan} c={c} timers={ringing} />;
  const focus = personFocus(plan, c.state, person, c.now);
  const next = personNext(plan, c.state, person, focus);
  const relay = handoffsFor(plan, c, person)[0];
  if (!focus)
    return (
      <div className="grid justify-items-center gap-2 px-4 py-8 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-accent-soft text-accent">
          <Icon name="check" size="l" />
        </span>
        <b className="font-display text-[26px]">{person} a tout fini</b>
        <p className="text-ink-2">L&apos;autre termine son fil ; ensuite, on range.</p>
      </div>
    );
  return (
    <div className="grid gap-5 px-4 pt-2">
      <Soon plan={plan} c={c} exclude={focus.type === "step" ? focus.id : null} person={person} />
      {focus.type === "step" ? <StepNow plan={plan} c={c} step={focus.step} /> : <PrepNow plan={plan} task={focus.task} />}
      {relay && (
        <HandoffRow from={relay.from} at={clock(c.cookingStart + relay.atMin * 60000)}>
          {relay.text}
        </HandoffRow>
      )}
      {next && (
        <p className="flex items-center gap-3 rounded-[14px] border border-dashed border-line-strong px-3.5 py-3 text-[15px] text-ink-2">
          {next.type === "step" ? <StepIllu kind={next.step.kind} text={next.step.text} size={32} className="shrink-0" /> : <StepIllu kind="prep" text={next.task.title} size={32} className="shrink-0" />}
          <span className="min-w-0">
            Ensuite · <b className="text-ink">{next.type === "step" ? stepTitle(plan, next.step) : prepTitle(next.task)}</b> · {clock(c.cookingStart + next.startMin * 60000)}
          </span>
        </p>
      )}
    </div>
  );
}

/** Un geste de prep à faire maintenant : ce qu'on coupe, combien, et dans quel bol. */
function PrepNow({ plan, task }: { plan: SessionPlan; task: PrepTask }) {
  const slug = task.recipeSlug ?? bowlOf(plan, task.bowls?.[0] ?? "")?.recipeSlug ?? task.items[0]?.recipeSlug ?? null;
  const recipe = recipeOf(plan, slug);
  return (
    <article key={task.id} className="grid animate-pop gap-4" aria-live="polite">
      <p className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.1em] text-ink-2">
        {recipe && <RecipeTile color={recipe.color} name={recipe.name} size="sm" />}
        Maintenant · prep
      </p>
      <div className="flex items-center gap-4">
        {task.kind === "cut" && task.items[0] ? <FoodIllu food={task.items[0].food} item={task.title} size={88} live className="shrink-0" /> : <StepIllu kind="prep" text={task.text ?? task.title} size={88} live className="shrink-0" />}
        <h1 className="min-w-0 font-display text-[clamp(2rem,9vw,2.9rem)] leading-[1.05] font-extrabold tracking-[-0.02em] [font-stretch:88%]">
          {prepTitle(task)}
          {task.total && <span className="num block text-[0.55em] text-ink-2">{task.total}</span>}
        </h1>
      </div>
      {task.kind === "cut" ? (
        <ul className="grid gap-2.5 text-[18px]">
          {task.items.map((i, k) => {
            const b = i.bowl ? bowlOf(plan, i.bowl) : undefined;
            return (
              <li key={k} className="flex items-center gap-3">
                {b ? <Bowl bowl={b} size="lg" /> : <span className="rounded-full border-2 border-dashed border-line-strong px-2 py-0.5 text-[12px] text-ink-2">plateau</span>}
                <span className="min-w-0 leading-tight">
                  {i.qty && <b className="num">{i.qty} </b>}
                  {i.gesture}
                  <span className="block text-[14px] text-ink-2">{b ? `dans le bol ${b.letter}` : "sur le plateau"} · {recipeOf(plan, i.recipeSlug)?.name}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex items-start gap-3">
          {task.bowls?.map((l) => {
            const b = bowlOf(plan, l);
            return b ? <Bowl key={l} bowl={b} size="lg" /> : null;
          })}
          <p className="text-[18px] leading-snug">{task.text}</p>
        </div>
      )}
      {task.tools?.length ? <p className="text-[15px] text-ink-2">Avec : {task.tools.join(" · ")}</p> : null}
      {task.notes?.map((n) => (
        <p key={n} className="flex items-start gap-2 rounded-[12px] border border-line px-3.5 py-2.5 text-[15px]">
          <Icon name="swap" size="s" className="mt-0.5 shrink-0" />
          {n}
        </p>
      ))}
    </article>
  );
}

function PersonBar({ plan, c, person, ringing, who }: { plan: SessionPlan; c: Controls; person: Person; ringing: TimerState[]; who?: Person }) {
  if (ringing.length) return <RingBar plan={plan} c={c} t={ringing[0]} who={who ?? person} />;
  const item: ThreadItem | null = personFocus(plan, c.state, person, c.now);
  if (!item) return null;
  const st = itemStatus(c.state, item);
  const step = item.type === "step" ? item.step : null;
  const auto = step && st === "active" && !stepTimer(c.state, step.id) && passiveMin(step) >= 3;
  const ph = step && st === "active" ? currentPhase(c.state, step) : null;
  const label = item.type === "prep" ? "Fait" : st === "todo" ? "Commencer" : ph != null && ph < step!.phases!.length - 1 ? "Suivant" : auto ? `Suivant · minuteur ${timerMinutes(step!)} min` : "Suivant";
  return (
    <MainButton icon={st === "todo" && step ? "play" : "check"} who={who ?? person} onClick={() => c.nextFor(person)}>
      {label}
    </MainButton>
  );
}

