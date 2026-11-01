"use client";

// Vue simple à deux : chacun son fil (gestes de prep et étapes mêlés, comme le planificateur les a
// répartis), une consigne à la fois. Téléphone d’une personne (?personne=A ou B) : son fil seul, son
// « Suivant » en bas. Grand écran sans personne : les deux fils côte à côte, touches A et B.
// Les relais (qui libère quoi) et ce qui sonne bientôt restent ; le reste est dans la vue détaillée.
import type { Person, PrepTask, SessionPlan } from "@/lib/session/planner";
import { itemStatus, personFocus, personNext, threadOf, type ThreadItem, type TimerState } from "@/lib/session/state";
import { weighItems } from "@/lib/session/guide";
import { BowlChip, BowlItems, BowlText, Lanes } from "./guide";
import { Icon, Tape } from "@/components/ui";
import { handoffLine, ofName } from "@/lib/session/people";
import { FoodIllu, StepIllu } from "@/components/illus/Illu";
import type { Controls } from "./SessionApp";
import { handoffsFor } from "./blocks";
import { prepTitle } from "./Prep";
import { Bowl, bowlOf, clock, HandoffRow, PersonMono, recipeOf, usePeople, stepTitle } from "./parts";
import { ActionBar, COLUMN, MainButton, personOf, RingBar, Ringing, Shell, SimpleHead, StepNow } from "./Simple";

type Wake = { on: boolean; request: () => Promise<void> };

export function SimpleDuo({ plan, c, person, overlay, dark, wake, detail, onEnd, ringing }: { plan: SessionPlan; c: Controls; person: Person | null; overlay: boolean; dark: boolean; wake: Wake; detail: string; onEnd: () => void; ringing: TimerState[] }) {
  const n = usePeople();
  if (person) {
    const mine = ringing.filter((t) => personOf(plan, t) !== (person === "A" ? "B" : "A"));
    const thread = threadOf(plan, person);
    const done = thread.filter((it) => itemStatus(c.state, it) === "done").length;
    return (
      <Shell overlay={overlay} dark={dark} tone={mine.length ? "hot" : "paper"} wakeOn={wake.on} onWake={() => void wake.request()} bar={<PersonBar plan={plan} c={c} person={person} ringing={mine} />}>
        <SimpleHead plan={plan} c={c} stage="cook" wake={wake} detail={detail} overlay={overlay} onEnd={onEnd} tone={mine.length ? "hot" : "paper"} lead={<PersonMono person={person} size={32} />} title={`Fil ${ofName(n[person].name)} · ${done} sur ${thread.length}`} person={person} />
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
  const other: Person = person === "A" ? "B" : "A";
  const theirs = personFocus(plan, c.state, other, c.now);
  return (
    <div className="grid gap-8 pt-6">
      {focus.type === "step" ? <StepNow plan={plan} c={c} step={focus.step} /> : <PrepNow plan={plan} task={focus.task} />}
      {theirs && (
        <p className="flex items-center gap-3 border-y border-line py-3 text-[17px] text-ink-2">
          <PersonMono person={other} size={28} />
          <span className="min-w-0">
            <b className="text-ink">{n[other].name}</b> {itemStatus(c.state, theirs) === "active" ? "fait" : "va faire"} : {theirs.type === "step" ? stepTitle(plan, theirs.step) : prepTitle(theirs.task)}
          </span>
        </p>
      )}
      <Lanes plan={plan} c={c} focus={focus.type === "step" ? focus.step : null} person={person} />
      {relay && (
        <HandoffRow from={relay.from} at={clock(c.cookingStart + relay.atMin * 60000)}>
          {handoffLine(relay, n)}
        </HandoffRow>
      )}
      {next?.type === "prep" && (
        <section className="grid gap-3">
          <h2 className="label text-ink-2">
            Ensuite, un geste de prep · <span className="num">{clock(c.cookingStart + next.startMin * 60000)}</span>
          </h2>
          <p className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3 border-y border-line py-3 text-[17px] text-ink-2">
            <StepIllu kind="prep" text={next.task.title} size={40} />
            <span className="min-w-0">{prepTitle(next.task)}</span>
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
            <Tape tint={recipe.color} seed={recipe.slug} wrap>
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
      ) : task.kind === "weigh" ? (
        <div className="grid gap-3">
          <p className="flex flex-wrap items-center gap-3 text-lead">
            Pèse et verse dans
            {task.bowls?.map((l) => <BowlChip key={l} plan={plan} letter={l} size="md" />)}
          </p>
          <BowlItems bowl={{ items: weighItems(plan, task) }} size="lg" />
        </div>
      ) : (
        <div className="flex items-start gap-3">
          {task.bowls?.map((l) => <BowlChip key={l} plan={plan} letter={l} size="lg" />)}
          <p className="text-lead"><BowlText plan={plan} text={task.text ?? ""} /></p>
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
  if (item.type === "step") return <ActionBar plan={plan} c={c} step={item.step} person={person} who={who ?? person} />;
  const u = c.undo(person);
  return (
    <div className="grid gap-2">
      <MainButton icon="check" who={who ?? person} onClick={() => c.nextFor(person)} className="!whitespace-normal leading-tight">
        Fait : {item.task.kind === "weigh" ? `bol${(item.task.bowls?.length ?? 0) > 1 ? "s" : ""} ${(item.task.bowls ?? []).join(", ")} pesé${(item.task.bowls?.length ?? 0) > 1 ? "s" : ""}` : item.task.title.toLowerCase()}
      </MainButton>
      <button type="button" onClick={() => c.back(person)} disabled={!u} title={u?.detail ?? "Rien à défaire"} className="flex min-h-11 items-center gap-2 rounded-[8px] px-2 text-left text-[15px] leading-tight opacity-85 hover:opacity-100 disabled:opacity-35">
        <Icon name="chev" size="s" className="shrink-0 rotate-180" />
        {u ? u.label : "Rien à défaire"}
      </button>
    </div>
  );
}
