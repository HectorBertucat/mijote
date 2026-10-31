"use client";

// Santé > Aujourd'hui : ce que la personne a mangé, en un tap pour le prévu.
// Haut : jauges kcal et protéines contre la cible de la semaine. Puis « À cocher » (repas de la
// Semaine, habitudes du jour), le journal par repas, « Ajouter » (recette, hors appli avec
// estimation IA, récents), et « Journée complète » qui fait compter la journée pour la cible.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonClass, Check, Field, Input, RecipeTile, Segmented, Sheet, Stepper, Tabs, Textarea } from "@/components/ui";
import { HowCalc, NB, Note, qty, Section, Verdict } from "./carnet";
import { useToast } from "@/components/cart/Toast";
import { changeUnits, eatFree, eatRecipe, eatTemplate, estimateFree, markComplete, removeEntry } from "@/app/sante/actions";
import type { MealEstimate } from "@/lib/health/estimate";
import { MEAL_LABEL, MEALS, type LogMeal } from "@/lib/health/log";

type Entry = { id: string; meal: LogMeal; kind: "recipe" | "template" | "free"; label: string; units: number | null; kcal: number; proteinG: number; source: string; slug: string | null };
type Planned = { meal: "lunch" | "dinner"; place: "home" | "office"; recipeId: string; slug: string; name: string; units: number; kcal: number | null; proteinG: number | null; color: string };
type Habit = { id: string; label: string; meal: LogMeal; kcal: number; proteinG: number; suggested: boolean };
type Recent = { label: string; meal: LogMeal; kcal: number; proteinG: number; fatG: number | null; carbsG: number | null; ai: boolean };
type LibItem = { id: string; slug: string; name: string; kcalUnit: number | null; proteinUnit: number | null; color: string };

export interface TodayProps {
  personId: string;
  personName: string;
  date: string;
  portionUnits: number;
  target: { kcal: number; proteinG: number } | null;
  totals: { kcal: number; proteinG: number };
  planned: Planned[];
  habits: Habit[];
  /** La personne a au moins une habitude (cochée ou non aujourd'hui). */
  hasHabits: boolean;
  entries: Entry[];
  recents: Recent[];
  library: LibItem[];
  complete: boolean;
  colors: Record<string, string>;
}

const fr = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");
// « Ajouter » part sur « À côté » (un extra ne remplace pas le repas prévu) ; le matin, sur « Matin ».
const mealNow = (): LogMeal => (new Date().getHours() < 11 ? "breakfast" : "snack");

export function TodayLog(p: TodayProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState<LogMeal | null>(null);
  const { show, node } = useToast();

  const run = (key: string, fn: () => Promise<{ ok: boolean; message: string }>, after?: () => void) => {
    setBusy(key);
    start(async () => {
      const r = await fn();
      show(r.message, r.ok);
      setBusy(null);
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });
  };

  const t = p.target;
  const left = t ? t.kcal - p.totals.kcal : null;
  const kcalTone = !t ? undefined : p.totals.kcal > t.kcal + 150 ? "ko" : p.totals.kcal >= t.kcal - 150 ? "ok" : undefined;
  const protTone = !t ? undefined : p.totals.proteinG >= t.proteinG * 0.9 ? "ok" : undefined;
  const todo = p.planned.length + p.habits.filter((h) => h.suggested).length;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:gap-18">
      <section aria-label="Mangé aujourd’hui" className="grid grid-cols-2 gap-6 lg:grid-cols-12">
        <Eaten
          className="lg:col-span-5"
          label="Calories"
          value={p.totals.kcal}
          unit="kcal"
          target={t?.kcal ?? null}
          tone={kcalTone}
          word={kcalTone === "ok" ? "dans la cible" : kcalTone === "ko" ? "au-dessus" : null}
          sub={left == null ? "pas encore de cible" : left >= 0 ? `reste ${qty(Math.round(left), "kcal")}` : `${qty(Math.round(-left), "kcal")} au-dessus`}
        />
        <Eaten
          className="border-l border-line pl-6 lg:col-span-5 lg:col-start-7"
          label="Protéines"
          value={Math.round(p.totals.proteinG)}
          unit="g"
          target={t?.proteinG ?? null}
          tone={protTone}
          word={protTone === "ok" ? "atteint" : null}
          sub={t ? (p.totals.proteinG >= t.proteinG ? "cible atteinte" : `reste ${qty(Math.round(t.proteinG - p.totals.proteinG), "g")}`) : undefined}
        />
      </section>

      {(p.planned.length > 0 || p.habits.length > 0) && (
        <Section
          title={
            <>
              À cocher {todo > 0 && <span className="num-tight text-ink-3">{todo}</span>}
            </>
          }
          id="acocher"
          aside={
            p.hasHabits && (
              <Link href="/sante/habitudes" className="text-small font-bold text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink hover:decoration-ink">
                Mes habitudes
              </Link>
            )
          }
        >
          <ul className="reveal grid border-t border-line">
            {p.planned.map((m) => (
              <li key={`${m.meal}-${m.recipeId}`} className="flex flex-wrap items-center gap-4 border-b border-line py-4">
                <RecipeTile color={m.color} name={m.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{m.name}</div>
                  <div className="text-small tabular-nums text-ink-2">
                    {MEAL_LABEL[m.meal]} · {m.place === "office" ? "au bureau" : "maison"} · {fr(m.units)}{NB}unités{m.kcal != null && ` · ${qty(Math.round(m.kcal), "kcal")} · ${qty(Math.round(m.proteinG ?? 0), "g")}`}
                  </div>
                </div>
                <div className="flex basis-full justify-end gap-2 sm:basis-auto">
                  <Button variant="quiet" size="sm" onClick={() => setAdding(m.meal)}>
                    Autre chose
                  </Button>
                  <Button variant="primary" icon="check" state={busy === m.recipeId + m.meal ? "loading" : "idle"} disabled={m.kcal == null || pending} onClick={() => run(m.recipeId + m.meal, () => eatRecipe(p.personId, p.date, m.meal, m.recipeId, m.units, true))}>
                    Mangé
                  </Button>
                </div>
              </li>
            ))}
            {p.habits.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-4 border-b border-line py-4">
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{h.label}</div>
                  <div className="text-small tabular-nums text-ink-2">
                    {MEAL_LABEL[h.meal]} · {qty(h.kcal, "kcal")} · {fr(h.proteinG)}{NB}g{!h.suggested && " · pas prévu aujourd’hui"}
                  </div>
                </div>
                <Button variant={h.suggested ? "primary" : "secondary"} icon="check" state={busy === h.id ? "loading" : "idle"} disabled={pending} onClick={() => run(h.id, () => eatTemplate(p.personId, p.date, h.id))}>
                  Pris
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!p.hasHabits && (
        <Note
          title="Un shaker ou un petit-déjeuner chaque matin ?"
          action={
            <Link href="/sante/habitudes" className={buttonClass({ size: "sm" })}>
              Noter mes habitudes
            </Link>
          }
        >
          Note-le une fois en habitude : il sera proposé ici d’office, et ta part en tiendra compte.
        </Note>
      )}

      <Section
        title="Journal"
        id="journal"
        aside={
          <Button icon="plus" onClick={() => setAdding(mealNow())}>
            Ajouter
          </Button>
        }
      >
        {p.entries.length === 0 ? (
          <p className="max-w-[52ch] text-body text-ink-2">Rien de noté pour l’instant. Coche les repas prévus, ou ajoute ce que tu as mangé ailleurs.</p>
        ) : (
          <div className="grid gap-8">
            {MEALS.filter((m) => p.entries.some((e) => e.meal === m)).map((m) => (
              <div key={m} className="grid gap-2">
                <div className="label text-ink-2">{MEAL_LABEL[m]}</div>
                <ul className="grid border-t border-line">
                  {p.entries
                    .filter((e) => e.meal === m)
                    .map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-3">
                        {e.slug ? <RecipeTile color={p.colors[e.slug] ?? 1} name={e.label} size="sm" /> : null}
                        <div className="min-w-0 flex-1">
                          <div className="font-bold">{e.label}</div>
                          <div className="flex flex-wrap items-center gap-x-3 text-small tabular-nums text-ink-2">
                            {qty(e.kcal, "kcal")} · {fr(e.proteinG)}{NB}g de protéines
                            {e.source === "ai" && <span className="label text-ink-3">estimation</span>}
                          </div>
                        </div>
                        <div className={`flex items-center justify-end gap-1 ${e.units != null ? "basis-full sm:basis-auto" : ""}`}>
                          {e.units != null && (
                            <Stepper size="sm" value={e.units} min={0.5} max={20} step={0.5} unit="u." busy={busy === e.id} onChange={(u) => run(e.id, () => changeUnits(e.id, u))} decLabel="Une demi-unité de moins" incLabel="Une demi-unité de plus" />
                          )}
                          <Button variant="quiet" size="sm" iconOnly icon="trash" aria-label={`Retirer ${e.label}`} onClick={() => run(e.id + "x", () => removeEntry(e.id))} />
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="grid gap-2 border-t border-line-strong pt-4">
        <Check checked={p.complete} strike={false} disabled={pending} onChange={(e) => run("complete", () => markComplete(p.personId, p.date, e.currentTarget.checked))}>
          <span className="text-h3">Journée complète</span>
        </Check>
        <HowCalc title="Pourquoi la cocher">
          <p>Coche-la quand tout ce que tu as mangé est noté. Seules les journées complètes servent à mesurer ta dépense ; une journée oubliée ne compte pas comme zéro, elle est ignorée.</p>
        </HowCalc>
      </div>

      <AddSheet key={adding ?? "closed"} open={adding != null} onClose={() => setAdding(null)} initialMeal={adding ?? "lunch"} {...p} onRun={run} pending={pending} />
      {node}
    </div>
  );
}

function AddSheet({ open, onClose, initialMeal, personId, date, portionUnits, recents, library, onRun, pending }: TodayProps & { open: boolean; onClose: () => void; initialMeal: LogMeal; onRun: (key: string, fn: () => Promise<{ ok: boolean; message: string }>, after?: () => void) => void; pending: boolean }) {
  const [meal, setMeal] = useState<LogMeal>(initialMeal);
  const [tab, setTab] = useState<"outside" | "recipe" | "recent">(recents.length ? "recent" : "outside");
  const [text, setText] = useState("");
  const [est, setEst] = useState<MealEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState({ label: "", kcal: "", prot: "" });
  const [recipeId, setRecipeId] = useState(library[0]?.id ?? "");
  const [units, setUnits] = useState(portionUnits);
  const r = library.find((x) => x.id === recipeId);

  const estimate = async () => {
    setEstimating(true);
    setErr(null);
    const res = await estimateFree(personId, text);
    setEstimating(false);
    if (res.ok) {
      setEst(res.estimate);
      setManual({ label: res.estimate.label, kcal: String(Math.round(res.estimate.kcal)), prot: String(Math.round(res.estimate.proteinG)) });
    } else setErr(res.message);
  };
  const n = (s: string) => Number(s.replace(",", "."));

  return (
    <Sheet open={open} onClose={onClose} title="Ajouter au journal">
      <div className="grid gap-4">
        <Segmented<LogMeal> label="Repas" value={meal} onChange={setMeal} options={MEALS.map((m) => ({ value: m, label: MEAL_LABEL[m] }))} />
        <Tabs<"outside" | "recipe" | "recent">
          label="Source"
          value={tab}
          onChange={setTab}
          items={[
            ...(recents.length ? [{ value: "recent" as const, label: "Récents" }] : []),
            { value: "outside", label: "Hors appli" },
            { value: "recipe", label: "Une recette" },
          ]}
        />

        {tab === "recent" && (
          <div className="grid gap-2">
            {recents.map((x) => (
              <button
                key={x.label}
                type="button"
                disabled={pending}
                onClick={() => onRun("recent" + x.label, () => eatFree(personId, date, meal, { ...x }), onClose)}
                className="flex min-h-tap items-center justify-between gap-3 rounded-[8px] border border-line bg-surface px-4 py-3 text-left hover:border-line-strong"
              >
                <span className="font-semibold">{x.label}</span>
                <span className="num whitespace-nowrap text-small text-ink-2">
                  {x.kcal} kcal · {fr(x.proteinG)} g
                </span>
              </button>
            ))}
          </div>
        )}

        {tab === "outside" && (
          <div className="grid gap-3">
            <Field label="Ce que tu as mangé" help="Par exemple : « burger frites et un coca au resto », « 2 parts de pizza 4 fromages ».">
              {(id, d) => <Textarea id={id} aria-describedby={d} rows={2} value={text} onChange={(e) => setText(e.target.value)} />}
            </Field>
            <Button icon="sparkdraft" state={estimating ? "loading" : "idle"} loadingLabel="Estimation…" disabled={text.trim().length < 3} onClick={estimate}>
              Estimer avec l’IA
            </Button>
            {err && <p className="text-small text-ko-ink">{err}</p>}
            {est && <p className="text-small text-ink-2">{est.note}</p>}
            <div className="grid grid-cols-[minmax(0,1fr)_88px_76px] items-end gap-2">
              <Field label="Nom">{(id) => <Input id={id} value={manual.label} onChange={(e) => setManual({ ...manual, label: e.target.value })} placeholder="Resto" />}</Field>
              <Field label="kcal">{(id) => <Input id={id} num inputMode="numeric" value={manual.kcal} onChange={(e) => setManual({ ...manual, kcal: e.target.value })} />}</Field>
              <Field label="Prot. g">{(id) => <Input id={id} num inputMode="numeric" value={manual.prot} onChange={(e) => setManual({ ...manual, prot: e.target.value })} />}</Field>
            </div>
            <Button
              variant="primary"
              disabled={pending || !manual.label.trim() || !(n(manual.kcal) >= 0) || manual.kcal === ""}
              onClick={() =>
                onRun(
                  "free",
                  () =>
                    eatFree(personId, date, meal, {
                      label: manual.label,
                      kcal: n(manual.kcal),
                      proteinG: n(manual.prot) || 0,
                      fatG: est && est.label === manual.label ? est.fatG : null,
                      carbsG: est && est.label === manual.label ? est.carbsG : null,
                      ai: est != null && String(Math.round(est.kcal)) === manual.kcal,
                    }),
                  onClose
                )
              }
            >
              Ajouter
            </Button>
          </div>
        )}

        {tab === "recipe" && (
          <div className="grid gap-3">
            <Field label="Recette">
              {(id) => (
                <select id={id} value={recipeId} onChange={(e) => setRecipeId(e.target.value)} className="min-h-12 w-full rounded-[8px] border border-line-strong bg-surface px-4 text-[17px] text-ink">
                  {library.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="flex items-center justify-between gap-3">
              <Stepper value={units} min={0.5} max={20} step={0.5} unit="unités" onChange={setUnits} />
              {r?.kcalUnit != null && (
                <span className="num text-small text-ink-2">
                  {Math.round(r.kcalUnit * units)} kcal · {Math.round((r.proteinUnit ?? 0) * units)} g
                </span>
              )}
            </div>
            <Button variant="primary" disabled={pending || !r || r.kcalUnit == null} onClick={() => onRun("recipe", () => eatRecipe(personId, date, meal, recipeId, units, false), onClose)}>
              Ajouter
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Ce qui est mangé contre la cible : le chiffre en grand, un trait d'encre qui avance, le verdict en mot. */
function Eaten({ label, value, unit, target, tone, word, sub, className = "" }: { label: string; value: number; unit: string; target: number | null; tone?: "ok" | "ko"; word: string | null; sub?: string; className?: string }) {
  const pct = target ? Math.min(100, (value / (target * 1.15)) * 100) : 0;
  const mark = target ? (1 / 1.15) * 100 : null;
  return (
    <div className={`grid min-w-0 content-start gap-3 ${className}`}>
      <span className="label text-ink-2">{label}</span>
      <b className="num-tight text-num-xl whitespace-nowrap">
        {Math.round(value).toLocaleString("fr-FR")}
        <span className="ml-2 text-[0.3em] font-[650] text-ink-2 [font-stretch:100%]">{target ? `/ ${target.toLocaleString("fr-FR")}${NB}${unit}` : unit}</span>
      </b>
      {target != null && (
        <span className="relative block h-1 bg-surface-2" aria-hidden>
          <span className={`block h-full transition-[width] duration-[var(--dur-3)] ease-[var(--ease-out)] ${tone === "ko" ? "bg-ko" : "bg-ink"}`} style={{ width: `${pct}%` }} />
          {mark != null && <span className="absolute -top-1 h-3 w-px bg-ink-2" style={{ left: `${mark}%` }} />}
        </span>
      )}
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-small text-ink-2">
        {sub}
        {word && tone && <Verdict tone={tone}>{word}</Verdict>}
      </span>
    </div>
  );
}
