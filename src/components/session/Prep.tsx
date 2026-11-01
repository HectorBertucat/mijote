"use client";

// Phase 1, la prep (DA « Session · prep ») : gestes regroupés à cocher (Check kitchen), bols
// lettrés aux couleurs de la recette avec l’étape qu’ils servent et le produit commandé,
// progression. Prep la veille : ce qui se fait ce soir, ce qui attend demain ; « au frigo ».
import type { PlanBowl, PrepTask, SessionPlan } from "@/lib/session/planner";
import { Alert, Button, Check, Icon, Progress } from "@/components/ui";
import type { Controls } from "./SessionApp";
import { Bowl, BowlFoods, bowlName, bowlOf, bowlOrdered, bowlQty, dur, Eyebrow, recipeOf, shortName } from "./parts";
import { FoodIllu, StepIllu } from "@/components/illus/Illu";
import { weighItems } from "@/lib/session/guide";
import { BowlItems } from "./guide";

export const prepTitle = (t: PrepTask) => (t.kind === "cut" ? t.title : t.kind === "weigh" ? `Pesée · ${t.title}` : `Avant de cuire · ${t.title}`);

/** Ce que la prep montre selon le moment : tout, ce soir (veille), ou le reste le jour J. */
export function prepScope(plan: SessionPlan, c: Controls) {
  const { state } = c;
  const veille = c.mode === "veille";
  const evening = veille && !state.eveDone;
  const resumed = veille && state.eveDone;
  const tasks = evening ? plan.prep.tasks.filter((t) => t.eve) : resumed ? plan.prep.tasks.filter((t) => !t.eve) : plan.prep.tasks;
  const later = evening ? plan.prep.tasks.filter((t) => !t.eve) : [];
  const doneEve = resumed ? plan.prep.tasks.filter((t) => t.eve) : [];
  // Seul : un bol qu’un geste finit pendant la cuisson n’est pas attendu avant (il se coche dans le fil).
  const bowls = evening ? plan.bowls.filter((b) => b.fridge) : plan.bowls.filter((b) => !b.during?.length);
  const laterBowls = evening ? plan.bowls.filter((b) => !b.fridge) : [];
  const duringBowls = evening ? [] : plan.bowls.filter((b) => b.during?.length);
  const ready = bowls.filter((b) => state.bowlsReady.has(b.letter)).length;
  const done = tasks.filter((t) => state.prepDone.has(t.id)).length;
  const minutes = evening ? (plan.prep.eveMin ?? 0) : plan.prep.minutes;
  return { veille, evening, resumed, tasks, later, doneEve, bowls, laterBowls, duringBowls, ready, done, minutes };
}

export function PrepPhase({ plan, c, aside }: { plan: SessionPlan; c: Controls; aside?: React.ReactNode }) {
  const p = prepScope(plan, c);
  return (
    <div className="grid gap-6">
      {p.veille && (
        <Alert tone="info" icon="moonset" title={p.evening ? "Prep la veille" : "Le jour J"}>
          {p.evening
            ? "Ce soir, ce qui se garde au frigo ; demain, le reste de la prep puis la cuisson."
            : "Les bols de la veille sont au frigo : sors-les. Il reste la prep qui ne se fait pas la veille, puis la cuisson."}
        </Alert>
      )}
      {!p.evening && plan.prep.notes.map((n) => <Alert key={n} tone="warn" icon="flame">{n}</Alert>)}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="grid content-start gap-3" aria-label="Gestes">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[26px] font-bold">{p.evening ? "Ce soir, gestes regroupés" : p.resumed ? "Le reste de la prep" : "Gestes regroupés"}</h2>
            <span className="num shrink-0 text-ink-2">
              {p.done} sur {p.tasks.length} · ≈ {dur(p.minutes)}
            </span>
          </div>
          {p.tasks.map((t) => (
            <PrepGesture key={t.id} plan={plan} c={c} t={t} big />
          ))}
          {p.doneEve.length > 0 && (
            <details className="group rounded-[14px] border border-line bg-surface px-4 py-3">
              <summary className="flex cursor-pointer list-none items-center gap-2 font-bold [&::-webkit-details-marker]:hidden">
                <Icon name="moonset" size="s" />
                Fait la veille · {p.doneEve.length} geste{p.doneEve.length > 1 ? "s" : ""}
                <Icon name="chev" size="s" className="ml-auto transition-transform group-open:rotate-90" />
              </summary>
              <div className="mt-3 grid gap-2">
                {p.doneEve.map((t) => (
                  <PrepGesture key={t.id} plan={plan} c={c} t={t} />
                ))}
              </div>
            </details>
          )}
          {p.later.length > 0 && <Tomorrow tasks={p.later} />}
        </section>

        <section className="grid content-start gap-3" aria-label="Bols">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[26px] font-bold">{p.evening ? "Bols pour le frigo" : "Bols"}</h2>
            <span className="num shrink-0 text-ink-2">
              {p.ready} prêt{p.ready > 1 ? "s" : ""} sur {p.bowls.length}
            </span>
          </div>
          <Progress value={p.bowls.length ? p.ready / p.bowls.length : 1} label="Bols prêts" />
          <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
            {p.bowls.map((b) => (
              <PrepBowlRow key={b.letter} plan={plan} c={c} b={b} />
            ))}
          </div>
          {p.laterBowls.length > 0 && (
            <p className="text-[14px] text-ink-2">
              Le jour même : {p.laterBowls.map((b) => `bol ${b.letter} (${bowlName(b)})`).join(" · ")}.
            </p>
          )}
          {p.duringBowls.length > 0 && <DuringBowls plan={plan} />}
          {aside}
        </section>
      </div>

      <details className="group rounded-[14px] border border-line bg-surface px-4 py-3 text-[14px]">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-bold [&::-webkit-details-marker]:hidden">
          <Icon name="book" size="s" />
          Prep des fiches d’origine
          <Icon name="chev" size="s" className="ml-auto transition-transform group-open:rotate-90" />
        </summary>
        <div className="mt-3 grid gap-3">
          {plan.prep.sources.map((s) => (
            <div key={s.recipeSlug} className="grid gap-1">
              <b>{recipeOf(plan, s.recipeSlug)?.name}</b>
              {s.texts.map((t, i) => (
                <p key={i} className="text-ink-2">
                  {t}
                </p>
              ))}
            </div>
          ))}
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-3">
        {p.evening ? (
          <Button variant="primary" size="kitchen" icon="fridge" onClick={() => c.setStatus("fridge")}>
            C’est au frigo · on reprend demain
          </Button>
        ) : (
          <Button variant="primary" size="kitchen" icon="flame" onClick={() => c.setStatus("cooking")}>
            Passer à la cuisson
          </Button>
        )}
        <span className="hidden text-small text-ink-2 lg:inline">
          <kbd className="rounded-[8px] border border-line bg-surface-2 px-2 text-[12px]">espace</kbd> = bol suivant prêt
        </span>
      </div>
    </div>
  );
}

/** Seul : les bols qu’un geste finit pendant la cuisson, quand on attend (étape du fil). */
export function DuringBowls({ plan }: { plan: SessionPlan }) {
  const list = plan.bowls.filter((b) => b.during?.length);
  return (
    <p className="text-[14px] text-ink-2">
      Pendant la cuisson : {list.map((b) => `bol ${b.letter} (${bowlName(b)}, étape ${b.during!.map((d) => d.no).join(", ")})`).join(" · ")}.
    </p>
  );
}

/** Prep la veille, le soir : ce qui attend demain (et pourquoi). */
export function Tomorrow({ tasks, title = "Demain, juste avant de cuire" }: { tasks: PrepTask[]; title?: string }) {
  return (
    <div className="grid gap-2 rounded-[14px] border border-dashed border-line-strong px-4 py-4">
      <Eyebrow className="flex items-center gap-2">
        <Icon name="sun" size="s" />
        {title}
      </Eyebrow>
      <ul className="grid gap-2 text-[17px]">
        {tasks.map((t) => (
          <li key={t.id}>
            <b>{prepTitle(t)}</b>
            {t.eveReason && <span className="text-ink-2"> · {t.eveReason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Un geste de prep : toute la carte est la case (Check kitchen), lignes par bol. */
export function PrepGesture({ plan, c, t, big }: { plan: SessionPlan; c: Controls; t: PrepTask; big?: boolean }) {
  const done = c.state.prepDone.has(t.id);
  return (
    <Check
      size="kitchen"
      strike={false}
      checked={done}
      onChange={() => c.togglePrep(t.id)}
      aria-label={`${prepTitle(t)}${done ? ", fait" : ""}`}
      className={`w-full items-start rounded-[14px] border border-line bg-surface transition-opacity duration-[var(--dur-base)] ${big ? "p-4" : "p-3"} ${done ? "opacity-55" : ""} [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1`}
    >
      <span className="grid gap-2">
        <span className="flex items-center justify-between gap-3">
          {t.kind === "cut" && t.items[0] ? (
            <FoodIllu food={t.items[0].food} item={t.title} size={big ? "m" : 34} live={!done && big} className="shrink-0" />
          ) : (
            <StepIllu kind="prep" text={t.text ?? t.title} size={big ? "m" : 34} className="shrink-0" />
          )}
          <b className={`min-w-0 flex-1 font-display leading-tight [font-stretch:100%] ${big ? "text-[20px]" : "text-[17px]"}`}>{prepTitle(t)}</b>
          <span className="num shrink-0 text-small text-ink-2">
            {t.total ? `${t.total} · ` : ""}
            {dur(t.minutes)}
          </span>
        </span>
        {t.kind === "cut" ? (
          <span className="grid gap-2">
            {t.items.map((i, k) => {
              const b = i.bowl ? bowlOf(plan, i.bowl) : undefined;
              return (
                <span key={k} className="flex items-center gap-3 text-[17px]">
                  {b ? <Bowl bowl={b} size="sm" /> : <span className="grid size-7 shrink-0 place-items-center rounded-full border-2 border-dashed border-line-strong text-[12px] text-ink-2" title="sur le plateau">·</span>}
                  <span className="min-w-0">
                    {i.qty && <b className="num">{i.qty} </b>}
                    {i.gesture}
                    <span className="text-ink-2">
                      {" "}
                      · {b ? `bol ${b.letter}` : "sur le plateau"} · {shortName(recipeOf(plan, i.recipeSlug)?.name)}
                    </span>
                  </span>
                </span>
              );
            })}
          </span>
        ) : t.kind === "weigh" ? (
          <span className="grid gap-1 text-ink-2">
            <span className="text-[17px]">Pèse et verse dans le bol {(t.bowls ?? []).join(", ")}</span>
            <BowlItems bowl={{ items: weighItems(plan, t) }} />
          </span>
        ) : (
          <span className="flex items-start gap-3 text-[17px] text-ink-2">
            {t.bowls?.map((l) => {
              const b = bowlOf(plan, l);
              return b ? <Bowl key={l} bowl={b} size="sm" /> : null;
            })}
            <span>{t.text}</span>
          </span>
        )}
        {(t.tools?.length || t.eveReason) && (
          <span className="text-small text-ink-2">
            {t.tools?.join(" · ")}
            {t.tools?.length && t.eve && t.eveReason ? " · " : ""}
            {t.eve && t.eveReason}
          </span>
        )}
      </span>
    </Check>
  );
}

/** Un bol (DA `.prepbowl`) : lettre en grand, contenu, l’étape qu’il sert, le produit commandé, prêt / à faire. */
export function PrepBowlRow({ plan, c, b, fridge }: { plan: SessionPlan; c: Controls; b: PlanBowl; fridge?: boolean }) {
  const r = c.state.bowlsReady.has(b.letter);
  const used = b.usedBy ? plan.steps.find((s) => s.id === b.usedBy!.stepId) : null;
  const recipe = recipeOf(plan, b.recipeSlug);
  const ordered = bowlOrdered(b);
  const inFridge = fridge || (b.fridge && r && c.state.eveDone);
  return (
    <button
      type="button"
      onClick={() => c.toggleBowl(b.letter)}
      aria-pressed={r}
      className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors last:border-0 hover:bg-[color-mix(in_srgb,var(--c-surface)_94%,var(--c-ink))]"
    >
      <Bowl bowl={b} size="lg" />
      <span className="min-w-0">
        <b className="block">
          {bowlName(b)}
          {b.items.some((i) => i.optional) && <span className="font-normal text-ink-2"> (facultatif en partie)</span>}
          {bowlQty(b) && <span className="num font-medium text-ink-2"> · {bowlQty(b)}</span>}
        </b>
        <BowlFoods bowl={b} size="s" className="my-1" />
        <span className="block text-small text-ink-2">
          {used ? (
            <>
              Sert à l&apos;<b className="text-ink">étape {used.no}</b> · {shortName(recipe?.name)}
            </>
          ) : (
            recipe?.name
          )}
        </span>
        {ordered && (
          <span className="mt-1 flex items-center gap-2 text-[12px] text-ink-2">
            <Icon name="basket" size="s" />
            {ordered}
          </span>
        )}
      </span>
      {inFridge ? (
        <span className="inline-flex h-6 items-center gap-1 rounded-full bg-accent-soft pr-2 pl-2 text-small font-semibold text-accent">
          <Icon name="fridge" size={14} />
          au frigo
        </span>
      ) : r ? (
        <span className="inline-flex h-6 items-center gap-1 rounded-full bg-accent-soft pr-2 pl-2 text-small font-semibold text-accent">
          <Icon name="check" size={14} strokeWidth={2.4} />
          prêt
        </span>
      ) : (
        <span className="inline-flex h-6 items-center gap-1 rounded-full bg-surface-2 pr-2 pl-2 text-small font-semibold text-ink-2">
          <Icon name="refresh" size={14} />à faire
        </span>
      )}
    </button>
  );
}
