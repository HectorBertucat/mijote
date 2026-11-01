"use client";

// Repère fixe d’un repas (Santé › Profil) : pour qui connaît déjà ses chiffres. Il sert à la part de
// chaque recette tant que Santé n’a pas mesuré la dépense ; ensuite, la cible mesurée prend le relais.
import { useState, useTransition } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { saveFixedRef } from "@/app/sante/actions";

type Ref = { kcalMin: number; kcalMax: number; proteinMin: number; proteinMax: number };
const KEYS: [keyof Ref, string][] = [
  ["kcalMin", "kcal min."],
  ["kcalMax", "kcal max."],
  ["proteinMin", "Protéines min. (g)"],
  ["proteinMax", "Protéines max. (g)"],
];

export function FixedRefForm({ personId, value }: { personId: string; value: Ref | null }) {
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
          Repère fixe d’un repas
        </h2>
        <span className="label text-ink-2">Facultatif</span>
      </div>
      <p className="text-small text-ink-2">
        Si tu connais déjà ce qu’un repas principal doit t’apporter, il sert à ta part de chaque recette tant que Santé n’a pas mesuré ta dépense (environ trois semaines de pesées et de journées complètes). Ensuite, la cible mesurée prend le relais.
      </p>
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
            Retirer le repère
          </Button>
        )}
      </div>
      {msg && <Alert tone={msg.ok ? "ok" : "ko"} role={msg.ok ? "status" : "alert"}>{msg.message}</Alert>}
    </section>
  );
}
