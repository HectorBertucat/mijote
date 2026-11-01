"use client";

// Le foyer : qui mange. Ajouter une personne (prénom, taille de part, et de quoi estimer sa cible),
// renommer, retirer. Le reste du profil (goûts, hors batch, objectifs) se règle dans Santé.
// DA v3 : une ligne à filet par personne, le formulaire d’ajout ouvert dessous, sans carte.
import { useActionState, useState, useTransition } from "react";
import { Alert, Button, Field, Icon, Input, Segmented } from "@/components/ui";
import { addPersonAction, removePersonAction, renamePersonAction, type FormState } from "@/app/reglages/actions";
import { ACTIVITY_LABEL, GOAL_LABEL } from "@/lib/health/core";
import { ofName } from "@/lib/session/people";

export type PersonRow = { id: string; name: string; portionUnits: number };

const PORTIONS = [
  { value: "3", label: "Petite" },
  { value: "4", label: "Moyenne" },
  { value: "5", label: "Grande" },
];
const SELECT =
  "min-h-12 w-full rounded-[8px] border border-line-strong bg-surface px-4 text-body text-ink transition-[border-color,box-shadow] duration-[var(--dur-1)] ease-[var(--ease-out)] hover:border-faint focus:border-accent focus:shadow-[0_0_0_3px_var(--c-accent-soft)] focus:outline-none";

export function Household({ people }: { people: PersonRow[] }) {
  const [state, add, adding] = useActionState<FormState, FormData>(addPersonAction, null);
  const [msg, setMsg] = useState<FormState>(null);
  const [pending, start] = useTransition();
  const [portion, setPortion] = useState("4");
  return (
    <div className="grid gap-8">
      {people.length > 0 && (
        <ul className="reveal grid border-t border-line" aria-label="Le foyer">
          {people.map((p) => (
            <PersonLine key={p.id} p={p} busy={pending} onSave={(name, u) => start(async () => setMsg(await renamePersonAction(p.id, name, u)))} onRemove={() => start(async () => setMsg(await removePersonAction(p.id)))} />
          ))}
        </ul>
      )}
      {msg && !msg.ok && <Alert tone="ko">{msg.message}</Alert>}
      <form action={add} className="grid gap-6">
        {people.length > 0 && <h3 className="text-h3">Quelqu’un d’autre</h3>}
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Prénom">{(id) => <Input id={id} name="name" required maxLength={40} autoComplete="off" />}</Field>
          <div className="grid content-start gap-2">
            <span className="label text-ink-2">Taille de part</span>
            <Segmented label="Taille de part" value={portion} onChange={setPortion} options={PORTIONS} />
            <input type="hidden" name="portion" value={portion} />
          </div>
        </div>
        <details className="group border-y border-line">
          <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 py-3 text-body font-bold text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
            <Icon name="chev" size="s" className="transition-transform duration-[var(--dur-2)] ease-[var(--ease-out)] group-open:rotate-90" />
            Pour une part au plus juste
            <span className="font-normal text-faint">facultatif</span>
          </summary>
          <div className="grid gap-6 pb-6 pt-2">
            <p className="max-w-[52ch] text-small text-ink-2">Avec l’âge, la taille, le poids et l’activité, la part de chaque recette suit une cible calculée. Tout se reprend dans Santé.</p>
            <div className="grid gap-6 sm:grid-cols-3">
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
          </div>
        </details>
        <div>
          <Button type="submit" variant={people.length ? "secondary" : "primary"} icon="plus" state={adding ? "loading" : "idle"} loadingLabel="Ajout…">
            {people.length ? "Ajouter au foyer" : "Ajouter"}
          </Button>
        </div>
        {state && !state.ok && <Alert tone="ko">{state.message}</Alert>}
      </form>
    </div>
  );
}

function PersonLine({ p, busy, onSave, onRemove }: { p: PersonRow; busy: boolean; onSave: (name: string, units: number) => void; onRemove: () => void }) {
  const [name, setName] = useState(p.name);
  const [units, setUnits] = useState(String(Math.min(5, Math.max(3, p.portionUnits))));
  const changed = name.trim() !== p.name || Number(units) !== p.portionUnits;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line py-4">
      {/* Le prénom se corrige sur place : un champ qui ne se montre qu’au survol et au focus. */}
      <input
        aria-label={`Prénom ${ofName(p.name)}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        className="min-h-12 min-w-0 flex-1 basis-40 rounded-[8px] border border-transparent bg-transparent px-3 font-display text-h3 font-bold text-ink [font-stretch:100%] transition-[border-color,background-color] duration-[var(--dur-1)] ease-[var(--ease-out)] hover:border-line-strong focus:border-accent focus:bg-surface focus:outline-none"
      />
      <Segmented label={`Part ${ofName(p.name)}`} value={units} onChange={setUnits} options={PORTIONS} />
      <div className="flex items-center gap-2">
        {changed && (
          <Button size="sm" variant="primary" icon="check" disabled={busy} onClick={() => onSave(name, Number(units))}>
            Enregistrer
          </Button>
        )}
        <Button size="sm" variant="quiet" icon="trash" iconOnly disabled={busy} onClick={onRemove} aria-label={`Retirer ${p.name}`} title={`Retirer ${p.name}`} />
      </div>
    </li>
  );
}
