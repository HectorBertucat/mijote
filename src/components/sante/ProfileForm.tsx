"use client";

// Profil santé d’une personne : de quoi estimer la dépense de départ et fixer les cibles.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Segmented, Textarea } from "@/components/ui";
import { useToast } from "@/components/cart/Toast";
import { saveProfile } from "@/app/sante/actions";
import { ACTIVITY_LABEL, DEFAULT_RATE, GOAL_LABEL, type Activity, type Goal } from "@/lib/health/core";
import { SPORT_KEYS, SPORTS, type Sport, type SportPlanItem } from "@/lib/health/goals";

export type ProfileValues = {
  sex: "m" | "f" | null;
  birthDate: string | null;
  heightCm: number | null;
  activity: Activity | null;
  goal: Goal | null;
  ratePct: number | null;
  proteinGPerKg: number | null;
  proteinG: number | null;
  targetWeightKg: number | null;
  targetDate: string | null;
  sportPlan: SportPlanItem[];
  constraints: string | null;
};

const SELECT = "min-h-12 w-full rounded-[8px] border border-line-strong bg-surface px-4 text-body text-ink focus:border-accent focus:shadow-[0_0_0_3px_var(--c-accent-soft)] focus:outline-none";
const str = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));

export function ProfileForm({ personId, name, values, needsWeight }: { personId: string; name: string; values: ProfileValues; needsWeight: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { show, node } = useToast();
  const [sex, setSex] = useState<"m" | "f" | "">(values.sex ?? "");
  const [goal, setGoal] = useState<Goal | "">(values.goal ?? "");
  const [rate, setRate] = useState(str(values.ratePct));
  const [plan, setPlan] = useState<SportPlanItem[]>(values.sportPlan);
  const setRow = (i: number, row: Partial<SportPlanItem>) => setPlan((p) => p.map((r, k) => (k === i ? { ...r, ...row } : r)));
  const [proteinMode, setProteinMode] = useState<"perkg" | "fixed">(values.proteinG ? "fixed" : "perkg");

  return (
    <form
      className="grid max-w-2xl gap-12"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("sex", sex);
        fd.set("goal", goal);
        fd.set("sportPlan", JSON.stringify(plan.filter((r) => r.perWeek > 0)));
        if (proteinMode === "fixed") fd.set("proteinGPerKg", "");
        else fd.set("proteinG", "");
        start(async () => {
          const r = await saveProfile(personId, fd);
          show(r.message, r.ok);
          if (r.ok) router.push("/sante");
        });
      }}
    >
      <fieldset className="grid gap-6">
        <legend className="mb-6 w-full border-t border-line-strong pt-4 text-h2 font-display">Mesures</legend>
        <div className="grid gap-2">
          <span className="label text-ink-2">Sexe</span>
          <Segmented<"m" | "f" | "">
            label="Sexe"
            value={sex}
            onChange={setSex}
            options={[
              { value: "f", label: "Femme" },
              { value: "m", label: "Homme" },
            ]}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date de naissance">{(id) => <Input id={id} name="birthDate" type="date" defaultValue={values.birthDate ?? ""} />}</Field>
          <Field label="Taille (cm)">{(id) => <Input id={id} name="heightCm" inputMode="decimal" num defaultValue={str(values.heightCm)} placeholder="168" />}</Field>
        </div>
        {needsWeight && <Field label="Poids actuel (kg)" help="Ensuite, une pesée par jour (ou par semaine) suffit.">{(id) => <Input id={id} name="kg" inputMode="decimal" num placeholder="60,5" />}</Field>}
        <Field label="Activité" help="Sert seulement à l’estimation des premières semaines : ensuite, la balance mesure ta vraie dépense.">
          {(id, d) => (
            <select id={id} aria-describedby={d} name="activity" defaultValue={values.activity ?? ""} className={SELECT}>
              <option value="">À choisir</option>
              {(Object.keys(ACTIVITY_LABEL) as Activity[]).map((a) => (
                <option key={a} value={a}>
                  {ACTIVITY_LABEL[a]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </fieldset>

      <fieldset className="grid gap-6">
        <legend className="mb-6 w-full border-t border-line-strong pt-4 text-h2 font-display">Objectif</legend>
        <Segmented<Goal | "">
          label="Objectif"
          value={goal}
          onChange={(g) => {
            setGoal(g);
            if (g) setRate(str(DEFAULT_RATE[g]));
          }}
          options={(Object.keys(GOAL_LABEL) as Goal[]).map((g) => ({ value: g, label: GOAL_LABEL[g] }))}
          className="flex-wrap"
        />
        <Field label="Rythme (% du poids par semaine)" help="Négatif pour perdre. Repères : −0,5 % pour perdre, −0,4 % en recomposition, +0,25 % pour prendre du muscle sans trop de gras.">
          {(id, d) => <Input id={id} aria-describedby={d} name="ratePct" inputMode="decimal" num value={rate} onChange={(e) => setRate(e.target.value)} placeholder="−0,4" />}
        </Field>
        <div className="grid gap-2">
          <span className="label text-ink-2">Protéines</span>
          <Segmented<"perkg" | "fixed">
            label="Protéines"
            value={proteinMode}
            onChange={setProteinMode}
            options={[
              { value: "perkg", label: "En g par kg" },
              { value: "fixed", label: "En grammes fixes" },
            ]}
          />
          {proteinMode === "perkg" ? (
            <Input aria-label="Protéines en g par kg" name="proteinGPerKg" inputMode="decimal" num defaultValue={str(values.proteinGPerKg) || "1,6"} />
          ) : (
            <Input aria-label="Protéines en grammes par jour" name="proteinG" inputMode="decimal" num defaultValue={str(values.proteinG)} placeholder="160" />
          )}
          <span className="text-small text-ink-2">1,6 g/kg suffit pour la plupart ; jusqu’à 2,2 g/kg en déficit avec de la musculation.</span>
        </div>
      </fieldset>

      <fieldset className="grid gap-6">
        <legend className="mb-6 w-full border-t border-line-strong pt-4 text-h2 font-display">Cap et sport</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Poids visé (kg)" help="Facultatif. L’appli calcule quand tu y arrives au rythme choisi.">
            {(id, d) => <Input id={id} aria-describedby={d} name="targetWeightKg" inputMode="decimal" num defaultValue={str(values.targetWeightKg)} placeholder="72" />}
          </Field>
          <Field label="Échéance souhaitée" help="Facultatif.">
            {(id, d) => <Input id={id} aria-describedby={d} name="targetDate" type="date" defaultValue={values.targetDate ?? ""} />}
          </Field>
        </div>
        <Field label="Ce que tu peux faire" help="Matériel, temps, douleurs, envies : le coach en tient compte.">
          {(id, d) => <Textarea id={id} aria-describedby={d} name="constraints" rows={2} defaultValue={values.constraints ?? ""} placeholder="Kettlebell 12 kg à la maison, piscine 3 fois par semaine, 30 min max en semaine" />}
        </Field>
        <div className="grid gap-2">
          <span className="label text-ink-2">Séances visées par semaine</span>
          {plan.map((r, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_4.5rem_5rem_auto] items-center gap-2">
              <select aria-label="Sport" value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value as Sport })} className={SELECT}>
                {SPORT_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {SPORTS[k]}
                  </option>
                ))}
              </select>
              <Input aria-label="Séances par semaine" inputMode="numeric" num value={String(r.perWeek)} onChange={(e) => setRow(i, { perWeek: Math.max(0, Math.min(14, Number(e.target.value.replace(/\D/g, "")) || 0)) })} />
              <Input aria-label="Minutes par séance" inputMode="numeric" num value={String(r.minutes)} onChange={(e) => setRow(i, { minutes: Math.max(0, Math.min(180, Number(e.target.value.replace(/\D/g, "")) || 0)) })} />
              <Button size="sm" variant="quiet" icon="x" iconOnly aria-label="Retirer ce sport" onClick={() => setPlan((p) => p.filter((_, k) => k !== i))} />
            </div>
          ))}
          {plan.length > 0 && <span className="text-small text-ink-2">Sport, séances par semaine, minutes par séance. L’activité du profil suit ce plan.</span>}
          <div>
            <Button size="sm" variant="secondary" icon="plus" onClick={() => setPlan((p) => [...p, { kind: "kettlebell", perWeek: 2, minutes: 30 }])}>
              Ajouter un sport
            </Button>
          </div>
        </div>
      </fieldset>

      <div>
        <Button type="submit" variant="primary" state={pending ? "loading" : "idle"}>
          Enregistrer
        </Button>
      </div>
      {node}
    </form>
  );
}
