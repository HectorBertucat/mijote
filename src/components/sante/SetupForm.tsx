"use client";

// Mise en route d’un mangeur : tout ce qu’il faut pour que sa part de chaque recette suive sa cible.
// Un seul formulaire en étapes numérotées (lisible au doigt sur téléphone comme au clavier).
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Check, Field, Input, Segmented } from "@/components/ui";
import { useToast } from "@/components/cart/Toast";
import { saveSetup } from "@/app/sante/actions";
import { ACTIVITY_LABEL, DEFAULT_RATE, GOAL_LABEL, type Activity, type Goal } from "@/lib/health/core";
import { OUTSIDE_PRESETS } from "@/lib/eaters/setup";
import type { ProfileValues } from "./ProfileForm";

const SELECT = "min-h-12 w-full rounded-[8px] border border-line-strong bg-surface px-3 text-body text-ink focus:border-accent focus:shadow-[0_0_0_3px_var(--c-accent-soft)] focus:outline-none";
const str = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));

function Step({ n, title, help, children }: { n: number; title: string; help?: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-6 border-t border-line-strong pt-4">
      <legend className="sr-only">{title}</legend>
      <div className="grid grid-cols-[48px_minmax(0,1fr)] items-start gap-4" aria-hidden>
        <span className="num-tight text-[48px] leading-[0.8] text-ink-3">{n}</span>
        <div className="grid gap-1">
          <b className="text-h3">{title}</b>
          {help && <span className="text-small text-ink-2">{help}</span>}
        </div>
      </div>
      {children}
    </fieldset>
  );
}

export function SetupForm({
  personId,
  name,
  values,
  lastKg,
  outside,
  habits,
  dislikes,
}: {
  personId: string;
  name: string;
  values: ProfileValues;
  lastKg: number | null;
  outside: { kcal: number; protein: number } | null;
  /** Les habitudes hors batch, en clair (« Shaker du matin, du lundi au vendredi ») ; null = aucune. */
  habits: string[] | null;
  dislikes: { id: string; text: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { show, node } = useToast();
  const [sex, setSex] = useState<"m" | "f" | "">(values.sex ?? "");
  const [goal, setGoal] = useState<Goal | "">(values.goal ?? "");
  const [rate, setRate] = useState(str(values.ratePct));
  const [proteinMode, setProteinMode] = useState<"perkg" | "fixed">(values.proteinG ? "fixed" : "perkg");
  const preset0 = outside ? (OUTSIDE_PRESETS.find((p) => p.kcal === outside.kcal && p.protein === outside.protein)?.id ?? "autre") : "";
  const [preset, setPreset] = useState<string>(preset0);
  const [outK, setOutK] = useState(str(outside?.kcal));
  const [outP, setOutP] = useState(str(outside?.protein));
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  return (
    <form
      className="grid max-w-2xl gap-12"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("sex", sex);
        fd.set("goal", goal);
        if (proteinMode === "fixed") fd.set("proteinGPerKg", "");
        else fd.set("proteinG", "");
        // Avec des habitudes, le hors batch en vient : le chiffre libre n’est pas touché.
        fd.set("outsideKcal", habits ? "" : outK);
        fd.set("outsideProteinG", habits ? "" : outP);
        for (const id of removed) fd.append("removeDislike", id);
        start(async () => {
          const r = await saveSetup(personId, fd);
          show(r.message, r.ok);
          if (r.ok) {
            setRemoved(new Set());
            router.refresh();
            document.getElementById("ta-part")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
      }}
    >
      {/* Objectifs réglés ailleurs (page Objectifs, coach) : renvoyés tels quels, saveProfile efface un champ absent. */}
      <input type="hidden" name="targetWeightKg" value={str(values.targetWeightKg)} />
      <input type="hidden" name="targetDate" value={values.targetDate ?? ""} />
      <input type="hidden" name="sportPlan" value={JSON.stringify(values.sportPlan ?? [])} />
      <input type="hidden" name="constraints" value={values.constraints ?? ""} />
      <Step n={1} title={`${name}, en quelques chiffres`} help="Pour estimer ta dépense les premières semaines ; ensuite, la balance la mesure.">
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
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date de naissance">{(id) => <Input id={id} name="birthDate" type="date" defaultValue={values.birthDate ?? ""} required />}</Field>
          <Field label="Taille (cm)">{(id) => <Input id={id} name="heightCm" inputMode="decimal" num defaultValue={str(values.heightCm)} placeholder="168" required />}</Field>
          <Field label={lastKg != null ? `Poids aujourd’hui (dernier : ${str(lastKg)} kg)` : "Poids aujourd’hui (kg)"}>
            {(id) => <Input id={id} name="kg" inputMode="decimal" num placeholder={lastKg != null ? "facultatif" : "60,5"} required={lastKg == null} />}
          </Field>
        </div>
        <Field label="Activité">
          {(id) => (
            <select id={id} name="activity" defaultValue={values.activity ?? ""} className={SELECT} required>
              <option value="">À choisir</option>
              {(Object.keys(ACTIVITY_LABEL) as Activity[]).map((a) => (
                <option key={a} value={a}>
                  {ACTIVITY_LABEL[a]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </Step>

      <Step n={2} title="Ton objectif" help="Il fixe ta cible du jour, et donc la taille de ta part.">
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
        <Field label="Rythme (% du poids par semaine)" help="Négatif pour perdre. −0,5 % pour perdre, −0,4 % en recomposition, +0,25 % pour prendre du muscle.">
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
            <Input aria-label="Protéines en grammes par jour" name="proteinG" inputMode="decimal" num defaultValue={str(values.proteinG)} placeholder="110" />
          )}
          <span className="text-small text-ink-2">1,6 g/kg suffit pour la plupart ; jusqu’à 2,2 g/kg en déficit avec du renforcement.</span>
        </div>
      </Step>

      <Step n={3} title="Hors des repas du batch" help="Le batch couvre le midi et le soir. Ce que tu manges à côté (petit-déjeuner, en-cas) est retiré de ta cible avant de la partager entre les deux repas.">
        {habits ? (
          <div className="grid gap-2">
            <ul className="grid gap-1 text-body">
              {habits.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
            <Link href={`/sante/habitudes?p=${personId}`} className="inline-flex min-h-tap items-center justify-self-start font-bold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
              Modifier mes habitudes
            </Link>
          </div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {OUTSIDE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={preset === p.id}
                  onClick={() => {
                    setPreset(p.id);
                    setOutK(String(p.kcal));
                    setOutP(String(p.protein));
                  }}
                  className={`grid min-h-tap gap-1 rounded-[8px] border px-3 py-3 text-left transition-colors duration-[var(--dur-quick)] ${preset === p.id ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-line-strong"}`}
                >
                  <b className="text-body">{p.label}</b>
                  <span className="text-small text-ink-2">
                    {p.hint} · <span className="num">~{p.kcal} kcal</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="kcal par jour hors batch">
                {(id) => (
                  <Input
                    id={id}
                    inputMode="decimal"
                    num
                    value={outK}
                    onChange={(e) => {
                      setOutK(e.target.value);
                      setPreset("autre");
                    }}
                    placeholder="350"
                  />
                )}
              </Field>
              <Field label="dont protéines (g)">
                {(id) => (
                  <Input
                    id={id}
                    inputMode="decimal"
                    num
                    value={outP}
                    onChange={(e) => {
                      setOutP(e.target.value);
                      setPreset("autre");
                    }}
                    placeholder="12"
                  />
                )}
              </Field>
            </div>
            <Link href={`/sante/habitudes?p=${personId}`} className="text-small font-bold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
              Ou détaille tes habitudes (shaker, petit-déjeuner, en-cas) et leurs jours
            </Link>
          </>
        )}
      </Step>

      <Step n={4} title="Ce que tu n’aimes pas" help="Une recette qui en contient ne t’est pas servie dans la Semaine.">
        {dislikes.length > 0 && (
          <div className="grid gap-2">
            {dislikes.map((d) => (
              <Check
                key={d.id}
                strike={false}
                checked={!removed.has(d.id)}
                onChange={(e) => {
                  const on = e.target.checked;
                  setRemoved((s) => {
                    const n = new Set(s);
                    if (on) n.delete(d.id);
                    else n.add(d.id);
                    return n;
                  });
                }}
              >
                {d.text}
              </Check>
            ))}
            <span className="text-small text-ink-2">Décoche pour retirer.</span>
          </div>
        )}
        <Field label="Ajouter" help="Séparés par des virgules : « poivron, champignons ».">
          {(id, d) => <Input id={id} aria-describedby={d} name="dislikes" placeholder="poivron, champignons" />}
        </Field>
      </Step>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" state={pending ? "loading" : "idle"} loadingLabel="J’enregistre…">
          Enregistrer et calculer mes parts
        </Button>
      </div>
      {node}
    </form>
  );
}
