"use client";

// Santé › Habitudes : ce que la personne mange hors des repas du batch (shaker, petit-déjeuner,
// en-cas), composé d’aliments de la table nutritionnelle, avec ses jours. Les macros sont
// recalculées en direct (src/lib/eaters/habits.ts, le même calcul que le serveur) ; le hors batch
// du jour, et donc la part de chaque recette, en découle.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Chip, Chips, Field, Input, Segmented, Sheet } from "@/components/ui";
import { NB } from "./carnet";
import { FoodIllu } from "@/components/illus/Illu";
import { useToast } from "@/components/cart/Toast";
import { dropHabit, nothingOutside, saveHabitAction } from "@/app/sante/actions";
import { daysLabel, EVERY_DAY, HABIT_FOODS, HABIT_PRESETS, habitMacros, WEEKDAY_NAMES, WEEKDAYS, type HabitMeal, type HabitPreset } from "@/lib/eaters/habits";
import { FOODS, isFoodId, type FoodId } from "@/lib/nutrition/foods";

export interface HabitView {
  id: string;
  label: string;
  meal: "breakfast" | "lunch" | "dinner" | "snack";
  weekdays: number[];
  items: { food: string; grams: number }[];
  kcal: number;
  proteinG: number;
  /** Habitude commune au foyer (person_id nul) : visible, pas modifiable ici. */
  shared: boolean;
}

type Draft = { id: string | null; label: string; meal: HabitMeal; weekdays: number[]; items: { food: FoodId; grams: string }[] };

const MEAL: Record<HabitMeal, string> = { breakfast: "Le matin", snack: "En-cas" };
const fr = (n: number) => Math.round(n).toLocaleString("fr-FR");
const num = (s: string) => Number(s.replace(",", ".").trim());
const SELECT = "min-h-12 w-full min-w-0 rounded-[8px] border border-line-strong bg-surface px-4 text-[17px] text-ink focus:border-accent focus:shadow-[0_0_0_3px_var(--c-accent-soft)] focus:outline-none";

// Les aliments de l’éditeur : ceux du matin d’abord, puis le reste de la table.
const OTHER_FOODS = (Object.keys(FOODS) as FoodId[]).filter((id) => id !== "zero" && !HABIT_FOODS.includes(id)).sort((a, b) => FOODS[a].name.localeCompare(FOODS[b].name, "fr"));

const fromPreset = (p: HabitPreset): Draft => ({ id: null, label: p.label, meal: p.meal, weekdays: [...EVERY_DAY], items: p.items.map((i) => ({ food: i.food, grams: String(i.grams) })) });

export function Habits({ personId, name, habits }: { personId: string; name: string; habits: HabitView[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
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

  const mine = habits.filter((h) => !h.shared);

  return (
    <div className="grid gap-12">
      {habits.length > 0 && (
        <ul className="reveal grid border-t border-line">
          {habits.map((h) => (
            <li key={h.id} className="grid gap-3 border-b border-line py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <b className="block text-h3">{h.label}</b>
                  <span className="text-small tabular-nums text-ink-2">
                    {h.meal === "snack" ? "En-cas" : "Le matin"} · {daysLabel(h.weekdays)} · <span className="num">{fr(h.kcal)}{NB}kcal</span> · <span className="num">{fr(h.proteinG)}{NB}g</span> de protéines
                    {h.shared && " · pour tout le foyer"}
                  </span>
                </div>
                {!h.shared && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        setDraft({
                          id: h.id,
                          label: h.label,
                          meal: h.meal === "snack" ? "snack" : "breakfast",
                          weekdays: h.weekdays,
                          items: h.items.filter((i) => isFoodId(i.food)).map((i) => ({ food: i.food as FoodId, grams: String(i.grams) })),
                        })
                      }
                    >
                      Modifier
                    </Button>
                    <Button variant="quiet" size="sm" iconOnly icon="trash" aria-label={`Retirer ${h.label}`} state={busy === h.id ? "loading" : "idle"} disabled={pending} onClick={() => run(h.id, () => dropHabit(personId, h.id))} />
                  </div>
                )}
              </div>
              {h.items.length > 0 ? (
                <ul className="flex flex-wrap gap-x-6 gap-y-2">
                  {h.items.map((i, n) => (
                    <li key={n} className="flex items-center gap-2 text-small">
                      <FoodIllu food={i.food} size="s" />
                      <span>{isFoodId(i.food) ? FOODS[i.food].name : i.food}</span>
                      <span className="num text-ink-2">{fr(i.grams)}{NB}g</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-small text-ink-2">Chiffres saisis à la main. Modifie-la pour la composer d’aliments : ses macros seront calculées.</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <section className="grid gap-6 border-t border-line-strong pt-4" aria-labelledby="hab-new">
        <h2 id="hab-new" className="text-h2">
          {mine.length ? "Ajouter une habitude" : `${name}, que manges-tu hors batch\u00a0?`}
        </h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {HABIT_PRESETS.map((p) => {
            const m = habitMacros(p.items);
            return (
              <button
                key={p.id}
                type="button"
                disabled={pending}
                onClick={() => (p.id === "rien" ? run("rien", () => nothingOutside(personId)) : setDraft(fromPreset(p)))}
                className="grid min-h-tap content-start gap-1 rounded-[8px] border border-line px-4 py-3 text-left transition-colors duration-[var(--dur-1)] ease-[var(--ease-out)] hover:border-ink hover:bg-surface disabled:opacity-40"
              >
                <span className="flex items-center gap-2">
                  {p.items[0] ? <FoodIllu food={p.items[0].food} size="s" /> : null}
                  <b>{p.label}</b>
                </span>
                <span className="text-small text-ink-2">
                  {p.hint}
                  {p.items.length > 0 && (
                    <>
                      {" "}
                      · <span className="num">~{fr(m.kcal)}{NB}kcal, {fr(m.proteinG)}{NB}g</span>
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div>
          <Button icon="plus" variant="quiet" onClick={() => setDraft({ id: null, label: "", meal: "snack", weekdays: [...EVERY_DAY], items: [{ food: "pomme", grams: "150" }] })}>
            Une autre habitude
          </Button>
        </div>
      </section>

      {draft && (
        <Editor
          key={draft.id ?? "new"}
          draft={draft}
          busy={busy === "save"}
          onClose={() => setDraft(null)}
          onSave={(d) =>
            run(
              "save",
              () => saveHabitAction(personId, d.id, { label: d.label, meal: d.meal, weekdays: d.weekdays, items: d.items.map((i) => ({ food: i.food, grams: num(i.grams) })) }),
              () => setDraft(null)
            )
          }
        />
      )}
      {node}
    </div>
  );
}

function Editor({ draft, busy, onClose, onSave }: { draft: Draft; busy: boolean; onClose: () => void; onSave: (d: Draft) => void }) {
  const [d, setD] = useState<Draft>(draft);
  const m = habitMacros(d.items.map((i) => ({ food: i.food, grams: num(i.grams) || 0 })));
  const valid = d.label.trim() && d.weekdays.length > 0 && d.items.length > 0 && d.items.every((i) => num(i.grams) > 0 && num(i.grams) <= 1000);
  const setItem = (n: number, patch: Partial<Draft["items"][number]>) => setD({ ...d, items: d.items.map((x, k) => (k === n ? { ...x, ...patch } : x)) });

  return (
    <Sheet
      open
      onClose={onClose}
      title={d.id ? "Modifier l’habitude" : "Nouvelle habitude"}
      width={520}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="num text-small text-ink-2">
            {fr(m.kcal)}{NB}kcal · {fr(m.proteinG)}{NB}g de protéines
          </span>
          <Button variant="primary" state={busy ? "loading" : "idle"} loadingLabel="J’enregistre…" disabled={!valid} onClick={() => onSave(d)}>
            Enregistrer
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <Field label="Nom">{(id) => <Input id={id} value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} placeholder="Shaker du matin" maxLength={120} />}</Field>
        <div className="grid gap-2">
          <span className="label text-ink-2">Quand</span>
          <Segmented<HabitMeal> label="Quand" value={d.meal} onChange={(meal) => setD({ ...d, meal })} options={(Object.keys(MEAL) as HabitMeal[]).map((v) => ({ value: v, label: MEAL[v] }))} />
        </div>
        <div className="grid gap-2">
          <span className="label text-ink-2">Les jours où tu la prends</span>
          <Chips>
            {WEEKDAYS.map((w, i) => (
              <Chip
                key={i}
                pressed={d.weekdays.includes(i)}
                aria-label={WEEKDAY_NAMES[i]}
                onClick={() => setD({ ...d, weekdays: d.weekdays.includes(i) ? d.weekdays.filter((x) => x !== i) : [...d.weekdays, i].sort() })}
              >
                {w}
              </Chip>
            ))}
          </Chips>
          <span className="text-small text-ink-2">Proposée d’office ces jours-là dans le journal, et comptée dans ton hors batch ces jours-là seulement.</span>
        </div>
        <div className="grid gap-2">
          <span className="label text-ink-2">Ce qu’il y a dedans</span>
          {d.items.map((i, n) => (
            <div key={n} className="grid grid-cols-[28px_minmax(0,1fr)_84px_auto] items-center gap-2">
              <FoodIllu food={i.food} size="s" />
              <select aria-label={`Aliment ${n + 1}`} value={i.food} onChange={(e) => setItem(n, { food: e.target.value as FoodId })} className={SELECT}>
                <optgroup label="Petit-déjeuner, en-cas">
                  {HABIT_FOODS.map((f) => (
                    <option key={f} value={f}>
                      {FOODS[f].name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Autres aliments">
                  {OTHER_FOODS.map((f) => (
                    <option key={f} value={f}>
                      {FOODS[f].name}
                    </option>
                  ))}
                </optgroup>
              </select>
              <Input aria-label={`Grammes de l’aliment ${n + 1}`} num inputMode="decimal" value={i.grams} onChange={(e) => setItem(n, { grams: e.target.value })} invalid={!(num(i.grams) > 0 && num(i.grams) <= 1000)} />
              <Button variant="quiet" size="sm" iconOnly icon="x" aria-label={`Retirer l’aliment ${n + 1}`} onClick={() => setD({ ...d, items: d.items.filter((_, k) => k !== n) })} />
            </div>
          ))}
          <div>
            <Button size="sm" icon="plus" disabled={d.items.length >= 12} onClick={() => setD({ ...d, items: [...d.items, { food: "banane", grams: "120" }] })}>
              Un aliment
            </Button>
          </div>
          <span className="text-small text-ink-2">En grammes (1 ml de lait = 1 g). Une banane pèse ~120 g sans la peau, une dose de protéine ~30 g.</span>
        </div>
      </div>
    </Sheet>
  );
}
