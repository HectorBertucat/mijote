"use client";

// Repère d’un repas (Santé › Profil) : automatique par défaut (il suit la cible de Santé chaque lundi), ou
// fixe pour qui connaît déjà ses chiffres. Un repère fixe enregistré passe en mode fixe : il ne suit plus
// la cible, et « Où j’en suis » le dit.
import { useState, useTransition } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { saveFixedRef } from "@/app/sante/actions";
import { RefModeSwitch } from "./WhereIAmActions";

type Ref = { kcalMin: number; kcalMax: number; proteinMin: number; proteinMax: number };
const KEYS: [keyof Ref, string][] = [
  ["kcalMin", "kcal min."],
  ["kcalMax", "kcal max."],
  ["proteinMin", "Protéines min. (g)"],
  ["proteinMax", "Protéines max. (g)"],
];

export function FixedRefForm({ personId, value, auto, current }: { personId: string; value: Ref | null; auto: boolean; current: string | null }) {
  const [v, setV] = useState<Record<keyof Ref, string>>({
    kcalMin: value ? String(value.kcalMin) : "",
    kcalMax: value ? String(value.kcalMax) : "",
    proteinMin: value ? String(value.proteinMin) : "",
    proteinMax: value ? String(value.proteinMax) : "",
  });
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const save = (clear = false) =>
    start(async () => {
      const ref = clear ? null : (Object.fromEntries(KEYS.map(([k]) => [k, Number(v[k].replace(",", "."))])) as Ref);
      if (clear) setV({ kcalMin: "", kcalMax: "", proteinMin: "", proteinMax: "" });
      setMsg(await saveFixedRef(personId, ref));
    });
  return (
    <section className="grid max-w-2xl gap-6 border-t border-line-strong pt-4" aria-labelledby="repere-fixe">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 id="repere-fixe" className="text-h2">
          Repère d’un repas
        </h2>
        <span className="label text-ink-2">{auto ? "Automatique" : "Fixe"}</span>
      </div>
      <p className="text-small text-ink-2">
        {auto
          ? "Automatique : chaque lundi, il se recalcule depuis ta cible de Santé, moins le hors batch, d’au plus 100 kcal par semaine. Les parts de la réserve et de la Semaine le suivent."
          : "Fixe : il sert à ta part de chaque recette tel quel, et ne suit pas ta cible de Santé. En automatique, il se recalcule chaque lundi depuis ta cible."}
        {current && ` Aujourd’hui : ${current}.`}
      </p>
      <RefModeSwitch personId={personId} auto={auto} />
      <p className="text-small text-ink-2">Un repère fixe, si tu connais déjà ce qu’un repas principal doit t’apporter (l’enregistrer passe en mode fixe) :</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {KEYS.map(([k, label]) => (
          <Field key={k} label={label}>
            {(id) => <Input id={id} num inputMode="numeric" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button icon="check" state={pending ? "loading" : "idle"} loadingLabel="…" onClick={() => save()}>
          Enregistrer
        </Button>
        {value && (
          <Button variant="quiet" disabled={pending} onClick={() => save(true)}>
            Retirer le repère fixe
          </Button>
        )}
      </div>
      {msg && <Alert tone={msg.ok ? "ok" : "ko"} role={msg.ok ? "status" : "alert"}>{msg.message}</Alert>}
    </section>
  );
}
