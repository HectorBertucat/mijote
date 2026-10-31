"use client";

// Vue simple à deux : chacun son fil (gestes de prep et étapes mêlés, comme le planificateur les a
// répartis), une consigne à la fois. Téléphone d’une personne (?personne=A ou B) : son fil seul, son
// « Suivant » en bas. Grand écran sans personne : les deux fils côte à côte, touches A et B.
// Les relais (qui libère quoi) et ce qui sonne bientôt restent ; le reste est dans la vue détaillée.
import type { Person, PrepTask, SessionPlan } from "@/lib/session/planner";
import { currentPhase, itemStatus, passiveMin, personFocus, personNext, stepTimer, threadOf, type ThreadItem, type TimerState } from "@/lib/session/state";
import { Icon, Tape } from "@/components/ui";
import { handoffLine, ofName } from "@/lib/session/people";
import { FoodIllu, StepIllu } from "@/components/illus/Illu";
import type { Controls } from "./SessionApp";
import { handoffsFor, timerMinutes } from "./blocks";
import { prepTitle } from "./Prep";
import { Bowl, bowlOf, clock, HandoffRow, PersonMono, recipeOf, usePeople, stepTitle } from "./parts";
import { COLUMN, MainButton, personOf, RingBar, Ringing, Shell, SimpleHead, Soon, StepNow } from "./Simple";

type Wake = { on: boolean; request: () => Promise<void> };

export function SimpleDuo({ plan, c, person, overlay, dark, wake, detail, onEnd, ringing }: { plan: SessionPlan; c: Controls; person: Person | null; overlay: boolean; dark: boolean; wake: Wake; detail: string; onEnd: () => void; ringing: TimerState[] }) {
  const n = usePeople();
  if (person) {
    const mine = ringing.filter((t) => personOf(plan, t) !== (person === "A" ? "B" : "A"));
    const thread = threadOf(plan, person);
    const done = thread.filter((it) => itemStatus(c.state, it) === "done").length;
    return (
      <Shell overlay={overlay} dark={dark} tone={mine.length ? "hot" : "paper"} wakeOn={wake.on} onWake={() => void wake.request()} bar={<PersonBar plan={plan} c={c} person={person} ringing={mine} />}>
        <SimpleHead plan={plan} c={c} stage="cook" wake={wake} detail={detail} overlay={overlay} onEnd={onEnd} tone={mine.length ? "hot" : "paper"} lead={<PersonMono person={person} size={32} />} title={`Fil ${ofName(n[person].name)} · ${done} sur ${thread.length}`} />
        {mine.length ? <Ringing plan={plan} c={c} timers={mine} /> : <div className={COLUMN}><PersonNow plan={plan} c={c} person={person} ringing={mine} /></div>}
      </Shell>
    );
  }
  return (
    <Shell overlay={overlay} dark={dark} wakeOn={wake.on} onWake={() => void wake.request()} bar={null} wide>
      <SimpleHead plan={plan} c={c} stage="cook" wake={wake} detail={detail} overlay={overlay} onEnd={onEnd} title="Session à deux" />
      <div className={`${COLUMN} grid gap-12 pt-6 md:grid-cols-2 md:gap-6`}>
        {(["A", "B"] as const).map((p) => {
          const mine = ringing.filter((t) => personOf(plan, t) !== (p === "A" ? "B" : "A"));
          return (
            <section key={p} className={`grid content-start gap-6 md:border-l md:border-line md:pl-6 md:first:border-l-0 md:first:pl-0 ${mine.length ? "rounded-[14px] bg-hot p-4 text-on-hot" : ""}`} aria-label={`Fil ${ofName(n[p].name)}`}>
              <h2 className="flex items-center gap-3 text-h3">
                <PersonMono person={p} size={32} />
                Fil {ofName(n[p].name)}
                <kbd className="label ml-auto rounded-[4px] border border-line px-2 py-1 font-normal text-ink-2">Touche {p}</kbd>
              </h2>
              <PersonNow plan={plan} c={c} person={p} ringing={mine} />
              <PersonBar plan={plan} c={c} person={p} ringing={mine} who={p} />
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
  const n = usePeople();
  if (!focus)
    return (
      <div className="grid gap-3 border-y border-line py-8">
        <p className="label text-ink-2">Fil terminé</p>
        <b className="text-h2">{n[person].name} a tout fini.</b>
        <p className="text-[17px] text-ink-2">L’autre termine son fil ; ensuite, on range.</p>
      </div>
    );
  return (
    <div className="grid gap-8 pt-6">
      <Soon plan={plan} c={c} exclude={focus.type === "step" ? focus.id : null} person={person} />
      {focus.type === "step" ? <StepNow plan={plan} c={c} step={focus.step} /> : <PrepNow plan={plan} task={focus.task} />}
      {relay && (
        <HandoffRow from={relay.from} at={clock(c.cookingStart + relay.atMin * 60000)}>
          {handoffLine(relay, n)}
        </HandoffRow>
      )}
      {next && (
        <section className="grid gap-3">
          <h2 className="label text-ink-2">
            Ensuite · <span className="num">{clock(c.cookingStart + next.startMin * 60000)}</span>
          </h2>
          <p className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3 border-y border-line py-3 text-[17px] text-ink-2">
            {next.type === "step" ? <StepIllu kind={next.step.kind} text={next.step.text} size={40} /> : <StepIllu kind="prep" text={next.task.title} size={40} />}
            <span className="min-w-0">{next.type === "step" ? stepTitle(plan, next.step) : prepTitle(next.task)}</span>
          </p>
        </section>
      )}
    </div>
  );
}

/** Un geste de prep à faire maintenant : ce qu’on coupe, combien, et dans quel bol. */
function PrepNow({ plan, task }: { plan: SessionPlan; task: PrepTask }) {
  const slug = task.recipeSlug ?? bowlOf(plan, task.bowls?.[0] ?? "")?.recipeSlug ?? task.items[0]?.recipeSlug ?? null;
  const recipe = recipeOf(plan, slug);
  return (
    <article key={task.id} className="sx-swap grid gap-6" aria-live="polite">
      <header className="flex items-center gap-4">
        {task.kind === "cut" && task.items[0] ? <FoodIllu food={task.items[0].food} item={task.title} size={80} live className="shrink-0" /> : <StepIllu kind="prep" text={task.text ?? task.title} size={80} live className="shrink-0" />}
        <div className="grid min-w-0 justify-items-start gap-2">
          {recipe && (
            <Tape tint={recipe.color} seed={recipe.slug}>
              {recipe.name}
            </Tape>
          )}
          <p className="label">
            <span className="text-accent">Maintenant</span> <span className="text-ink-2">· prep</span>
          </p>
        </div>
      </header>
      <h1 className="sx-consigne">
        {prepTitle(task)}
        {task.total && <span className="num-tight block text-[0.7em] text-ink-2">{task.total}</span>}
      </h1>
      {task.kind === "cut" ? (
        <ul className="grid border-b border-line text-[19px]">
          {task.items.map((i, k) => {
            const b = i.bowl ? bowlOf(plan, i.bowl) : undefined;
            return (
              <li key={k} className="flex items-center gap-4 border-t border-line py-3">
                {b ? <Bowl bowl={b} size="lg" /> : <span className="label grid size-16 shrink-0 place-items-center rounded-full border-2 border-dashed border-line-strong text-ink-2">plateau</span>}
                <span className="min-w-0 leading-tight">
                  {i.qty && <b className="num">{i.qty} </b>}
                  {i.gesture}
                  <span className="block text-small text-ink-2">{b ? `dans le bol ${b.letter}` : "sur le plateau"} · {recipeOf(plan, i.recipeSlug)?.name}</span>
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
          <p className="text-lead">{task.text}</p>
        </div>
      )}
      {task.tools?.length ? <p className="text-[17px] text-ink-2">Avec : {task.tools.join(" · ")}</p> : null}
      {task.notes?.map((n) => (
        <p key={n} className="flex items-start gap-3 border-t border-line pt-3 text-[17px]">
          <Icon name="swap" size="s" className="mt-1 shrink-0 text-ink-2" />
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

