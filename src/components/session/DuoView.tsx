"use client";

// Session à deux (DA « Session à deux ») : un fil par personne, A et B, en deux colonnes qui
// défilent chacune de leur côté, avec l’élément en cours en grand et son « Fait », les relais
// (qui libère quoi), puis ce qui vient. À droite : un QR par personne, les minuteurs, les foyers
// et le four, les bols. Sur le téléphone, la vue simple (SimpleDuo.tsx) montre le fil d’une personne.
// Tout passe par le même journal et la même synchro SSE que la vue seule.
import Link from "next/link";
import { useEffect, useRef } from "react";
import type { Person, PrepTask, SessionPlan } from "@/lib/session/planner";
import { ofName } from "@/lib/session/people";
import { itemStatus, personFocus, personNext, threadOf, type ThreadItem } from "@/lib/session/state";
import { weighItems } from "@/lib/session/guide";
import { BackButton, BowlChip, BowlItems, BowlText, RestartButtons } from "./guide";
import { Alert, Button, Icon } from "@/components/ui";
import type { Controls, SessionProps } from "./SessionApp";
import { Bleed, SimpleLink } from "./SessionApp";
import { DoneView, Handoff, handoffsFor, Issues, NowCard, PlanDetails, progressLine, recipesLine, sessionTitle, StepActions } from "./blocks";
import { prepTitle } from "./Prep";
import { Bowl, bowlOf, clock, dur, Eyebrow, PauseAll, PersonMono, usePeople, QrCard, RecipeMark, recipeOf, Resources, SessionHead, stepTitle, TimerList, useWakeLock, WakePill } from "./parts";

const PEOPLE: Person[] = ["A", "B"];

const itemTitle = (plan: SessionPlan, it: ThreadItem) => (it.type === "prep" ? `Prep · ${prepTitle(it.task)}` : `${it.step.kind === "preheat" ? it.step.text.split(".")[0] : stepTitle(plan, it.step)}`);
const itemSlug = (plan: SessionPlan, it: ThreadItem) => (it.type === "step" ? it.step.recipeSlug : (it.task.recipeSlug ?? bowlOf(plan, it.task.bowls?.[0] ?? "")?.recipeSlug ?? it.task.items[0]?.recipeSlug ?? null));

export function DuoView(p: SessionProps & { c: Controls }) {
  const { plan, c } = p;
  const { state } = c;
  const wake = useWakeLock();
  const started = state.status === "cooking" || state.status === "done";
  const n = usePeople();
  return (
    <Bleed>
      <SessionHead
        title={`${sessionTitle(p.startedAt, plan)} · ${n.A.name} et ${n.B.name}`}
        sub={[recipesLine(plan), plan.eve ? "prep la veille, le jour J à deux" : null, progressLine(plan, c)].filter(Boolean).join(" · ")}
        online={c.online}
        right={
          <span className="flex items-center gap-2">
            {!started && (
              <Button variant="inverse" size="sm" icon="play" onClick={() => c.setStatus("cooking")}>
                On démarre
              </Button>
            )}
            <WakePill wake={wake} />
            <SimpleLink />
          </span>
        }
      />
      <div className="mx-auto grid max-w-[90rem] gap-6 px-4 py-6 sm:px-6">
        <Issues plan={plan} sessionId={p.id} />
        {plan.eve && state.status !== "done" && <EveRecap plan={plan} c={c} />}
        {!started && (
          <Alert tone="info" icon="play" title={`${n.A.name} et ${n.B.name} démarrent en même temps`}>
            Les heures partent du démarrage ; le premier « Fait » démarre aussi la session. Chacun peut ouvrir son fil sur son téléphone avec son QR code.
          </Alert>
        )}
        {state.status === "done" ? (
          <DoneView plan={plan} c={c} startedAt={p.startedAt} />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_280px]">
            {PEOPLE.map((person) => (
              <PersonColumn key={person} plan={plan} c={c} person={person} />
            ))}
            <aside className="grid content-start gap-4 lg:col-span-2 lg:grid-cols-2 xl:col-span-1 xl:grid-cols-1 xl:sticky xl:top-4 xl:self-start">
              {p.personQrs && (
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-1">
                  {p.personQrs.map((q) => (
                    <QrCard key={q.person} svg={q.svg} url={q.url}>
                      <PersonMono person={q.person} size={24} />
                      Fil {ofName(n[q.person].name)} sur ton téléphone
                    </QrCard>
                  ))}
                </div>
              )}
              <div className="grid content-start gap-4">
                <div className="flex items-center justify-between gap-2">
                  <Eyebrow>Minuteurs</Eyebrow>
                  <PauseAll timers={c.timers} now={c.now} allPaused={c.allPaused} onClick={c.pauseAll} />
                </div>
                <TimerList plan={plan} timers={c.timers} now={c.now} onAdd={c.addMinutes} onStop={c.stopTimer} onAdjust={c.adjustTimer} onReset={c.resetTimer} onPause={c.pauseTimer} />
                <Eyebrow className="mt-1">Foyers et four</Eyebrow>
                <Resources plan={plan} state={state} now={c.now} cookingStart={c.cookingStart} scale={0.7} />
                <Eyebrow className="mt-1">Bols</Eyebrow>
                <div className="flex flex-wrap gap-3">
                  {plan.bowls.map((b) => (
                    <button key={b.letter} type="button" onClick={() => c.toggleBowl(b.letter)} aria-pressed={state.bowlsReady.has(b.letter)} title={b.items.map((i) => i.item).join(", ")} className="rounded-full active:scale-95">
                      <Bowl bowl={b} size="md" ready={state.bowlsReady.has(b.letter)} />
                    </button>
                  ))}
                </div>
                <PlanDetails plan={plan} />
                <p className="hidden text-small text-ink-2 lg:block">
                  Clavier : <Kbd>A</Kbd> ou <Kbd>espace</Kbd> = « Fait » {ofName(n.A.name)}, <Kbd>B</Kbd> = « Fait » {ofName(n.B.name)}.
                </p>
                <Button variant="quiet" icon="check" block onClick={() => c.setStatus("done")}>
                  Terminer la session
                </Button>
                <RestartButtons id={c.id} />
              </div>
            </aside>
          </div>
        )}
      </div>
    </Bleed>
  );
}

const Kbd = ({ children }: { children: React.ReactNode }) => <kbd className="rounded-[8px] border border-line bg-surface-2 px-2 text-[12px]">{children}</kbd>;

/** Prep la veille reprise à deux : les bols du frigo à sortir, et ce qui a été fait la veille. */
function EveRecap({ plan, c }: { plan: SessionPlan; c: Controls }) {
  const eve = plan.eve!;
  const bowls = plan.bowls.filter((b) => eve.bowls.includes(b.letter));
  return (
    <section className="grid gap-3 rounded-[14px] border border-line bg-surface px-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <Icon name="fridge" />
        <b>
          {bowls.length} bol{bowls.length > 1 ? "s" : ""} de la veille au frigo : sors-les.
        </b>
        <span className="flex flex-wrap gap-3">
          {bowls.map((b) => (
            <span key={b.letter} title={b.items.map((i) => i.item).join(", ")}>
              <Bowl bowl={b} size="md" ready={c.state.bowlsReady.has(b.letter)} />
            </span>
          ))}
        </span>
      </div>
      {eve.tasks.length > 0 && (
        <details className="group text-[14px]">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-ink-2 [&::-webkit-details-marker]:hidden">
            <Icon name="moonset" size="s" />
            Fait la veille · {eve.tasks.length} geste{eve.tasks.length > 1 ? "s" : ""}, {dur(eve.minutes)}
            <Icon name="chev" size="s" className="transition-transform group-open:rotate-90" />
          </summary>
          <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {eve.tasks.map((t) => (
              <li key={t.id} className="flex items-baseline gap-2 text-ink-2">
                <Icon name="check" size={14} className="text-accent" />
                <span className="text-ink">{prepTitle(t)}</span>
                {t.total && <span className="num">{t.total}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function usePerson(plan: SessionPlan, c: Controls, person: Person) {
  const { state, now } = c;
  const focus = personFocus(plan, state, person, now);
  const upcoming = personNext(plan, state, person, focus);
  const thread = threadOf(plan, person);
  const mine = new Set(thread.filter((it) => it.type === "step").map((it) => it.id));
  const timers = c.timers.filter((t) => (t.stepId ? mine.has(t.stepId) : person === "A"));
  const done = thread.filter((it) => itemStatus(state, it) === "done").length;
  return { focus, upcoming, timers, thread, done };
}

/** Ce qui vient pour une personne, relais intercalés à leur heure. */
function upcomingRows(plan: SessionPlan, c: Controls, person: Person, thread: ThreadItem[], focusId: string | undefined) {
  const todo = thread.filter((it) => it.id !== focusId && itemStatus(c.state, it) !== "done");
  const hs = handoffsFor(plan, c, person);
  const rows: ({ kind: "item"; it: ThreadItem; at: number } | { kind: "handoff"; h: (typeof hs)[number]; at: number })[] = [
    ...todo.map((it) => ({ kind: "item" as const, it, at: it.startMin })),
    ...hs.map((h) => ({ kind: "handoff" as const, h, at: h.atMin - 0.01 })),
  ];
  return rows.sort((a, b) => a.at - b.at);
}

function PersonColumn({ plan, c, person }: { plan: SessionPlan; c: Controls; person: Person }) {
  const { focus, timers, thread, done } = usePerson(plan, c, person);
  const rows = upcomingRows(plan, c, person, thread, focus?.id);
  const finished = thread.filter((it) => itemStatus(c.state, it) === "done");
  const who = usePeople()[person].name;
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [focus?.id]);
  return (
    <section ref={box} className="relative grid min-w-0 content-start gap-3 lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto lg:pr-1" aria-label={`Fil ${ofName(who)}`} data-person={person}>
      <div className="sticky top-0 z-[1] flex items-center gap-3 bg-bg pb-2">
        <PersonMono person={person} size={36} />
        <b className="font-display text-[20px]">Fil {ofName(who)}</b>
        <span className="num ml-auto text-[14px] text-ink-2">
          {done} fait{done > 1 ? "s" : ""} · {thread.length - done} à venir
        </span>
      </div>
      {focus ? (
        <ItemFocus plan={plan} c={c} item={focus} person={person} />
      ) : (
        <div className="grid justify-items-center gap-2 rounded-[14px] border-2 border-ink bg-surface p-6 text-center">
          <Icon name="check" size="l" className="text-accent" />
          <b className="font-display text-[22px]">{who} a tout fini</b>
        </div>
      )}
      {timers.length > 0 && <TimerList plan={plan} timers={timers} now={c.now} onAdd={c.addMinutes} onStop={c.stopTimer} onPause={c.pauseTimer} />}
      {rows.map((r) => (r.kind === "handoff" ? <Handoff key={`h-${r.h.toStepId}-${r.h.fromStepId}`} plan={plan} c={c} h={r.h} /> : <ThreadRow key={r.it.id} plan={plan} c={c} item={r.it} person={person} />))}
      {finished.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-small text-ink-2 [&::-webkit-details-marker]:hidden">
            <Icon name="chev" size="s" className="transition-transform group-open:rotate-90" />
            {finished.length} fait{finished.length > 1 ? "s" : ""}
          </summary>
          <div className="mt-2 grid gap-2">
            {finished.map((it) => (
              <ThreadRow key={it.id} plan={plan} c={c} item={it} person={person} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function ThreadRow({ plan, c, item, person }: { plan: SessionPlan; c: Controls; item: ThreadItem; person: Person }) {
  const st = itemStatus(c.state, item);
  const toggle = () => (item.type === "prep" ? c.togglePrep(item.task.id, person) : c.toggleStep(item.step));
  const relay = item.type === "step" && item.step.notes.some((n) => n.startsWith("Relais"));
  return (
    <button type="button" onClick={toggle} className={`grid w-full gap-1 rounded-[8px] border border-line bg-surface px-4 py-3 text-left hover:border-line-strong ${st === "done" ? "opacity-55" : ""}`}>
      <span className="flex items-center justify-between gap-2 text-[12px] font-semibold text-ink-2">
        <span className="flex items-center gap-2">
          <RecipeMark plan={plan} slug={itemSlug(plan, item)} />
          {st === "done" ? "fait" : st === "active" ? "en cours" : item.type === "step" ? `étape ${item.step.no} · ${clock(c.cookingStart + item.startMin * 60000)}` : `prep · ${clock(c.cookingStart + item.startMin * 60000)}`}
          {relay && <span className="rounded-[8px] bg-accent-soft px-2 text-accent">relais</span>}
        </span>
        <span className="num">{dur(item.type === "prep" ? item.task.minutes : item.step.durationMin)}</span>
      </span>
      <b className="text-[17px] leading-snug">{itemTitle(plan, item)}</b>
    </button>
  );
}

function ItemFocus({ plan, c, item, person, big }: { plan: SessionPlan; c: Controls; item: ThreadItem; person: Person; big?: boolean }) {
  const actions = big ? null : <PersonActions c={c} item={item} person={person} />;
  return item.type === "step" ? <NowCard plan={plan} c={c} step={item.step} size={big ? "lg" : "md"} actions={actions ?? <></>} /> : <PrepNow plan={plan} c={c} task={item.task} big={big} actions={actions} />;
}

/** Un geste de prep en cours, au format de l’étape en cours (.now). */
function PrepNow({ plan, c, task, big, actions }: { plan: SessionPlan; c: Controls; task: PrepTask; big?: boolean; actions?: React.ReactNode }) {
  const planned = c.cookingStart + (task.startMin ?? 0) * 60000;
  const slug = task.recipeSlug ?? bowlOf(plan, task.bowls?.[0] ?? "")?.recipeSlug ?? task.items[0]?.recipeSlug ?? null;
  return (
    <article key={task.id} className={`grid animate-pop gap-3 rounded-[14px] border-2 border-ink bg-surface ${big ? "p-6" : "p-4"}`}>
      <div className="flex flex-wrap items-center gap-2 label text-ink-2">
        <RecipeMark plan={plan} slug={slug} />
        Maintenant · prep
        <span className="num ml-auto font-semibold tracking-normal normal-case">
          prévue {clock(planned)} · {dur(task.minutes)}
        </span>
      </div>
      <h2 className={`font-display leading-[1.06] font-extrabold tracking-[-0.02em] [font-stretch:92%] ${big ? "text-[36px]" : "text-[26px]"}`}>
        {prepTitle(task)}
        {task.total && <span className="num text-ink-2"> · {task.total}</span>}
      </h2>
      {task.kind === "cut" ? (
        <ul className={`grid gap-2 ${big ? "text-[19px]" : "text-[17px]"}`}>
          {task.items.map((i, k) => {
            const b = i.bowl ? bowlOf(plan, i.bowl) : undefined;
            return (
              <li key={k} className="flex items-center gap-3">
                {b ? <Bowl bowl={b} size={big ? "lg" : "md"} /> : <span className="rounded-full border-2 border-dashed border-line-strong px-2 py-1 text-[12px] text-ink-2">plateau</span>}
                <span className="min-w-0 leading-tight">
                  <b className="num">{i.qty ?? ""}</b> {i.gesture}
                  <span className="block text-[14px] text-ink-2">{recipeOf(plan, i.recipeSlug)?.name}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : task.kind === "weigh" ? (
        <div className="grid gap-2">
          <p className="flex flex-wrap items-center gap-2 text-[17px]">
            Pèse et verse dans {task.bowls?.map((l) => <BowlChip key={l} plan={plan} letter={l} size="sm" />)}
          </p>
          <BowlItems bowl={{ items: weighItems(plan, task) }} />
        </div>
      ) : (
        <div className="flex items-start gap-3">
          {task.bowls?.map((l) => <BowlChip key={l} plan={plan} letter={l} size={big ? "lg" : "md"} />)}
          <p className={big ? "text-[19px] leading-snug" : "text-[17px] leading-snug"}><BowlText plan={plan} text={task.text ?? ""} /></p>
        </div>
      )}
      {task.tools?.length ? <p className="text-[14px] text-ink-2">Avec : {task.tools.join(" · ")}</p> : null}
      {task.notes?.map((n) => (
        <Alert key={n} tone="info" icon="swap">
          {n}
        </Alert>
      ))}
      {actions}
    </article>
  );
}

/** Les boutons du fil d’une personne : l’action de son étape (nommée), ou son geste de prep fait ; son propre retour. */
function PersonActions({ c, item, person }: { c: Controls; item: ThreadItem; person: Person }) {
  if (item.type === "step") return <StepActions c={c} step={item.step} person={person} compact />;
  const u = c.undo(person);
  return (
    <div className="grid gap-3">
      <Button variant="primary" size="kitchen" icon="check" onClick={() => c.nextFor(person)} data-action={`fait-${person}`} className="w-full !whitespace-normal py-3 text-left leading-tight">
        Fait : {item.task.kind === "weigh" ? `bol${(item.task.bowls?.length ?? 0) > 1 ? "s" : ""} ${(item.task.bowls ?? []).join(", ")} pesé${(item.task.bowls?.length ?? 0) > 1 ? "s" : ""}` : item.task.title.toLowerCase()}
      </Button>
      <BackButton undo={u} onBack={() => c.back(person)} className="min-h-tap" />
    </div>
  );
}

/** Téléphone sans personne choisie : « Fil A » / « Fil B ». `telephone` : garde la vue plein écran. */
export function DuoPick({ telephone = true }: { telephone?: boolean }) {
  const n = usePeople();
  return (
    <div className="mx-auto grid max-w-lg gap-4 px-4 pt-6">
      <h1 className="text-[28px] font-extrabold">Qui es-tu ?</h1>
      <div className="grid grid-cols-2 gap-3">
        {PEOPLE.map((p) => (
          <Link key={p} href={`?${telephone ? "vue=telephone&" : ""}personne=${p}`} className="grid min-h-40 justify-items-center content-center gap-3 rounded-[14px] border-2 border-line bg-surface p-6 hover:border-ink">
            <PersonMono person={p} size={56} />
            <b className="font-display text-[20px]">Fil {ofName(n[p].name)}</b>
          </Link>
        ))}
      </div>
    </div>
  );
}
