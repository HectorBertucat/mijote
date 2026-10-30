"use client";

// Santé > Aujourd'hui : ce que la personne a mangé, en un tap pour le prévu.
// Haut : jauges kcal et protéines contre la cible de la semaine. Puis « À cocher » (repas de la
// Semaine, habitudes du jour), le journal par repas, « Ajouter » (recette, hors appli avec
// estimation IA, récents), et « Journée complète » qui fait compter la journée pour la cible.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Check, Field, Gauge, Icon, Input, Pill, RecipeTile, Segmented, Sheet, Stepper, Tabs, Textarea } from "@/components/ui";
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
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Card pad="md" className="grid gap-4 sm:grid-cols-2">
        <Gauge
          label="Calories"
          value={p.totals.kcal}
          unit="kcal"
          max={Math.max((t?.kcal ?? 2500) * 1.3, p.totals.kcal)}
          target={t ? [t.kcal - 150, t.kcal + 150] : undefined}
          tone={kcalTone}
          left={left == null ? "pas de cible" : left >= 0 ? `reste ${Math.round(left)} kcal` : `${Math.round(-left)} kcal au-dessus`}
          right={t ? `cible ${t.kcal}` : undefined}
        />
        <Gauge
          label="Protéines"
          value={p.totals.proteinG}
          unit="g"
          max={Math.max((t?.proteinG ?? 120) * 1.3, p.totals.proteinG)}
          target={t ? [t.proteinG * 0.9] : undefined}
          tone={protTone}
          left={t ? (p.totals.proteinG >= t.proteinG ? "cible atteinte" : `reste ${Math.round(t.proteinG - p.totals.proteinG)} g`) : undefined}
          right={t ? `cible ${t.proteinG} g` : undefined}
        />
      </Card>

      {(p.planned.length > 0 || p.habits.length > 0) && (
        <section className="grid gap-2.5" aria-labelledby="acocher">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="acocher" className="text-[18px] font-bold">
              À cocher {todo > 0 && <span className="num text-faint">{todo}</span>}
            </h2>
            {p.hasHabits && (
              <Link href="/sante/habitudes" className="text-[14px] font-semibold text-accent hover:underline">
                Mes habitudes
              </Link>
            )}
          </div>
          <Card className="divide-y divide-line">
            {p.planned.map((m) => (
              <div key={`${m.meal}-${m.recipeId}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <RecipeTile color={m.color} name={m.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{m.name}</div>
                  <div className="text-[13px] tabular-nums text-ink-2">
                    {MEAL_LABEL[m.meal]} · {m.place === "office" ? "au bureau" : "maison"} · {fr(m.units)} unités{m.kcal != null && ` · ${Math.round(m.kcal)} kcal · ${Math.round(m.proteinG ?? 0)} g`}
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
              </div>
            ))}
            {p.habits.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="grid size-9 place-items-center rounded-[10px] bg-surface-2 text-ink-2">
                  <Icon name="star" size="s" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{h.label}</div>
                  <div className="text-[13px] tabular-nums text-ink-2">
                    {MEAL_LABEL[h.meal]} · {h.kcal} kcal · {fr(h.proteinG)} g{!h.suggested && " · pas prévu aujourd'hui"}
                  </div>
                </div>
                <Button variant={h.suggested ? "primary" : "secondary"} icon="check" state={busy === h.id ? "loading" : "idle"} disabled={pending} onClick={() => run(h.id, () => eatTemplate(p.personId, p.date, h.id))}>
                  Pris
                </Button>
              </div>
            ))}
          </Card>
        </section>
      )}

      {!p.hasHabits && (
        <Card flat pad="md" className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[14px] text-ink-2">Un shaker ou un petit-déjeuner chaque matin ? Note-le une fois en habitude : il sera proposé ici d&apos;office, et ta part en tiendra compte.</p>
          <Link href="/sante/habitudes" className="text-[14px] font-semibold text-accent hover:underline">
            Noter mes habitudes
          </Link>
        </Card>
      )}

      <section className="grid gap-2.5" aria-labelledby="journal">
        <div className="flex items-center justify-between gap-2">
          <h2 id="journal" className="text-[18px] font-bold">
            Journal
          </h2>
          <Button icon="plus" onClick={() => setAdding(mealNow())}>
            Ajouter
          </Button>
        </div>
        {p.entries.length === 0 ? (
          <Card flat pad="md">
            <p className="text-ink-2">Rien de noté pour l'instant. Coche les repas prévus ci-dessus, ou ajoute ce que tu as mangé ailleurs.</p>
          </Card>
        ) : (
          <Card className="divide-y divide-line">
            {MEALS.filter((m) => p.entries.some((e) => e.meal === m)).map((m) => (
              <div key={m} className="grid gap-1 px-4 py-3">
                <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">{MEAL_LABEL[m]}</div>
                {p.entries
                  .filter((e) => e.meal === m)
                  .map((e) => (
                    <div key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
                      {e.slug ? <RecipeTile color={p.colors[e.slug] ?? 1} name={e.label} size="sm" /> : null}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{e.label}</div>
                        <div className="flex flex-wrap items-center gap-x-2 text-[13px] tabular-nums text-ink-2">
                          {e.kcal} kcal · {fr(e.proteinG)} g de protéines
                          {e.source === "ai" && (
                            <Pill tone="idle" icon="sparkdraft">
                              estimation
                            </Pill>
                          )}
                        </div>
                      </div>
                      <div className={`flex items-center justify-end gap-1 ${e.units != null ? "basis-full sm:basis-auto" : ""}`}>
                        {e.units != null && (
                          <Stepper size="sm" value={e.units} min={0.5} max={20} step={0.5} unit="u." busy={busy === e.id} onChange={(u) => run(e.id, () => changeUnits(e.id, u))} decLabel="Une demi-unité de moins" incLabel="Une demi-unité de plus" />
                        )}
                        <Button variant="quiet" size="sm" iconOnly icon="trash" aria-label={`Retirer ${e.label}`} onClick={() => run(e.id + "x", () => removeEntry(e.id))} />
                      </div>
                    </div>
                  ))}
              </div>
            ))}
          </Card>
        )}
      </section>

      <Card pad="md" className="grid gap-1.5">
        <Check checked={p.complete} strike={false} disabled={pending} onChange={(e) => run("complete", () => markComplete(p.personId, p.date, e.currentTarget.checked))}>
          <span className="font-semibold">Journée complète</span>
        </Check>
        <p className="text-[13px] text-ink-2">Coche-la quand tout ce que tu as mangé est noté. Seules les journées complètes servent à mesurer ta dépense ; une journée oubliée ne compte pas comme zéro, elle est ignorée.</p>
      </Card>

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
                className="flex min-h-tap items-center justify-between gap-3 rounded-[12px] border border-line bg-surface px-3.5 py-2.5 text-left hover:border-line-strong"
              >
                <span className="font-semibold">{x.label}</span>
                <span className="num whitespace-nowrap text-[13px] text-ink-2">
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
              Estimer avec l'IA
            </Button>
            {err && <p className="text-[13px] text-ko-ink">{err}</p>}
            {est && <p className="text-[13px] text-ink-2">{est.note}</p>}
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
                <select id={id} value={recipeId} onChange={(e) => setRecipeId(e.target.value)} className="min-h-12 w-full rounded-[10px] border border-line-strong bg-surface px-3 text-[16px] text-ink">
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
                <span className="num text-[14px] text-ink-2">
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
