"use client";

// Le foyer : qui mange. Ajouter une personne (prénom, taille de part, et de quoi estimer sa cible),
// renommer, retirer. Le reste du profil (goûts, hors batch, objectifs) se règle dans Santé.
import { useActionState, useState, useTransition } from "react";
import { Alert, Button, Card, Field, Input, Segmented } from "@/components/ui";
import { addPersonAction, removePersonAction, renamePersonAction, type FormState } from "@/app/reglages/actions";
import { ACTIVITY_LABEL, GOAL_LABEL } from "@/lib/health/core";

export type PersonRow = { id: string; name: string; portionUnits: number };

const PORTIONS = [
  { value: "3", label: "Petite" },
  { value: "4", label: "Moyenne" },
  { value: "5", label: "Grande" },
];
const SELECT = "min-h-tap w-full rounded-[12px] border border-line-strong bg-surface px-3 text-[16px]";

export function Household({ people }: { people: PersonRow[] }) {
  const [state, add, adding] = useActionState<FormState, FormData>(addPersonAction, null);
  const [msg, setMsg] = useState<FormState>(null);
  const [pending, start] = useTransition();
  const [portion, setPortion] = useState("4");
  return (
    <div className="grid gap-3">
      {people.length > 0 && (
        <ul className="grid gap-2">
          {people.map((p) => (
            <PersonLine key={p.id} p={p} busy={pending} onSave={(name, u) => start(async () => setMsg(await renamePersonAction(p.id, name, u)))} onRemove={() => start(async () => setMsg(await removePersonAction(p.id)))} />
          ))}
        </ul>
      )}
      {msg && !msg.ok && <Alert tone="ko">{msg.message}</Alert>}
      <Card pad="md" className="grid gap-3">
        <b className="text-[16px]">{people.length ? "Ajouter quelqu'un" : "Qui mange ici ?"}</b>
        <form action={add} className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Prénom">{(id) => <Input id={id} name="name" required maxLength={40} autoComplete="off" />}</Field>
            <div className="grid gap-1.5">
              <span className="text-[14px] font-semibold">Taille de part</span>
              <Segmented label="Taille de part" value={portion} onChange={setPortion} options={PORTIONS} />
              <input type="hidden" name="portion" value={portion} />
            </div>
          </div>
          <details className="group">
            <summary className="cursor-pointer text-[14px] font-semibold text-accent">Pour une part juste (facultatif, modifiable dans Santé)</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Sexe">
                {(id) => (
                  <select id={id} name="sex" className={SELECT} defaultValue="">
                    <option value="">—</option>
                    <option value="f">Femme</option>
                    <option value="m">Homme</option>
                  </select>
                )}
              </Field>
              <Field label="Année de naissance">{(id) => <Input id={id} name="birthYear" inputMode="numeric" num placeholder="1995" />}</Field>
              <Field label="Taille (cm)">{(id) => <Input id={id} name="height" inputMode="numeric" num placeholder="170" />}</Field>
              <Field label="Poids (kg)">{(id) => <Input id={id} name="weight" inputMode="decimal" num placeholder="65" />}</Field>
              <Field label="Activité">
                {(id) => (
                  <select id={id} name="activity" className={SELECT} defaultValue="">
                    <option value="">—</option>
                    {Object.entries(ACTIVITY_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Objectif">
                {(id) => (
                  <select id={id} name="goal" className={SELECT} defaultValue="">
                    <option value="">—</option>
                    {Object.entries(GOAL_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          </details>
          <div>
            <Button type="submit" variant="primary" icon="plus" state={adding ? "loading" : "idle"} loadingLabel="Ajout…">
              Ajouter
            </Button>
          </div>
          {state && !state.ok && <Alert tone="ko">{state.message}</Alert>}
        </form>
      </Card>
    </div>
  );
}

function PersonLine({ p, busy, onSave, onRemove }: { p: PersonRow; busy: boolean; onSave: (name: string, units: number) => void; onRemove: () => void }) {
  const [name, setName] = useState(p.name);
  const [units, setUnits] = useState(String(Math.min(5, Math.max(3, p.portionUnits))));
  const changed = name.trim() !== p.name || Number(units) !== p.portionUnits;
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-surface px-3 py-2">
      <Input aria-label="Prénom" value={name} onChange={(e) => setName(e.target.value)} className="!w-auto min-w-0 flex-1" />
      <Segmented label={`Part de ${p.name}`} value={units} onChange={setUnits} options={PORTIONS} />
      {changed && (
        <Button size="sm" icon="check" disabled={busy} onClick={() => onSave(name, Number(units))}>
          Enregistrer
        </Button>
      )}
      <Button size="sm" variant="quiet" icon="trash" disabled={busy} onClick={onRemove} aria-label={`Retirer ${p.name}`}>
        Retirer
      </Button>
    </li>
  );
}
