// Réglages du module Course, par personne : activé ou non, jours et heures où courir, nombre de sorties,
// objectif, jour de la sortie longue, FC mesurées (facultatives). Un formulaire serveur, relu et borné par
// saveRunSettings (src/lib/running/store.ts).
import Link from "next/link";
import { Section } from "@/components/sante/carnet";
import { Button, Icon, Input } from "@/components/ui";
import { db } from "@/lib/db/client";
import { activePerson } from "@/lib/health/active";
import { WEEKDAY_LABEL } from "@/lib/running/dates";
import { GOAL_LABEL, GOALS } from "@/lib/running/plan";
import { getRunProfile } from "@/lib/running/store";
import { saveSettingsAction } from "../actions";

export const dynamic = "force-dynamic";

const GOAL_HINT: Record<(typeof GOALS)[number], string> = {
  reprendre: "Jusqu’à une heure de sortie longue, en base continue.",
  plus_longtemps: "La sortie longue monte jusqu’à 1 h 30.",
  sortie_longue: "La sortie longue monte jusqu’à 2 h.",
  semi: "Après l’endurance, un peu de vitesse ; la date se choisira plus tard.",
};
const CELL =
  "grid min-h-tap cursor-pointer place-items-center rounded-[8px] border border-line-strong bg-surface px-3 font-bold text-ink transition-colors duration-[var(--dur-1)] ease-[var(--ease-out)] hover:border-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-bg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent";
const SELECT = "min-h-12 w-full rounded-[8px] border border-line-strong bg-surface px-3 text-[17px] text-ink";

export default async function CourseSettings({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const person = await activePerson();
  const { erreur } = await searchParams;
  const p = getRunProfile(db, person.id);
  const days = new Map((p?.days ?? [{ weekday: 1 }, { weekday: 3 }, { weekday: 6 }]).map((d) => [d.weekday, d.time ?? ""]));

  return (
    <div className="grid max-w-[720px] gap-12">
      <header className="grid gap-3">
        <Link href="/sante/course" className="inline-flex min-h-tap items-center gap-1 justify-self-start text-small font-bold text-ink-2 hover:text-ink">
          <Icon name="chev" size="s" className="rotate-180" />
          Course
        </Link>
        <h2 className="text-h1">Réglages de la course</h2>
        <p className="text-lead text-ink-2">Pour {person.name}. Le plan se recalcule tout de suite ; les séances déjà faites ne bougent pas.</p>
        {erreur && (
          <p role="alert" className="text-ko-ink">
            {erreur}
          </p>
        )}
      </header>

      <form action={saveSettingsAction} className="grid gap-12">
        <Section title="Le module" id="module" level={3}>
          <label className="flex min-h-tap items-center gap-3 text-body font-bold">
            <input type="checkbox" name="enabled" defaultChecked={p?.enabled ?? true} className="size-5 accent-[var(--c-ink)]" />
            Course activée pour {person.name}
          </label>
          <p className="text-small text-ink-2">Désactivée, la page ne montre plus le plan et la montre ne reçoit plus de séance ; tout est gardé.</p>
        </Section>

        <Section title="Quand courir" id="jours" level={3}>
          <fieldset className="grid gap-2">
            <legend className="label pb-2 text-ink-2">Les jours possibles, et l’heure (facultative)</legend>
            {WEEKDAY_LABEL.map((label, d) => (
              <div key={d} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3">
                <label className={`${CELL} justify-start capitalize`}>
                  <input type="checkbox" name={`day${d}`} defaultChecked={days.has(d)} className="sr-only" />
                  {label}
                </label>
                <Input type="time" name={`time${d}`} defaultValue={days.get(d) ?? ""} aria-label={`Heure du ${label}`} />
              </div>
            ))}
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="label pb-2 text-ink-2">Sorties par semaine</legend>
            <div className="grid grid-cols-3 gap-1">
              {[2, 3, 4].map((n) => (
                <label key={n} className={`${CELL} num`}>
                  <input type="radio" name="perWeek" value={n} defaultChecked={(p?.perWeek ?? 3) === n} className="sr-only" />
                  {n}
                </label>
              ))}
            </div>
            <span className="text-small text-ink-2">Trois est le bon rythme pour reprendre ; il faut au moins autant de jours possibles.</span>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2">
              <span className="label text-ink-2">Jour de la sortie longue</span>
              <select name="longRunDay" className={SELECT} defaultValue={p?.longRunDay != null ? String(p.longRunDay) : ""}>
                <option value="">samedi ou dimanche</option>
                {WEEKDAY_LABEL.map((label, d) => (
                  <option key={d} value={d}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2">
              <span className="label text-ink-2">Heure par défaut</span>
              <Input type="time" name="time" defaultValue={p?.time ?? ""} />
              <span className="text-small text-ink-2">Sinon 7 h sur la montre.</span>
            </label>
          </div>
        </Section>

        <Section title="L’objectif" id="objectif" level={3}>
          <fieldset className="grid gap-1">
            <legend className="sr-only">Objectif</legend>
            {GOALS.map((g) => (
              <label key={g} className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-[8px] border border-line px-4 py-3 hover:border-line-strong has-[:checked]:border-ink">
                <input type="radio" name="goal" value={g} defaultChecked={(p?.goal ?? "plus_longtemps") === g} className="mt-1 size-4 accent-[var(--c-ink)]" />
                <span className="grid gap-0.5">
                  <b>{GOAL_LABEL[g]}</b>
                  <span className="text-small text-ink-2">{GOAL_HINT[g]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="grid gap-2">
            <span className="label text-ink-2">En tes mots (facultatif)</span>
            <Input name="goalNote" defaultValue={p?.goalNote ?? ""} maxLength={300} placeholder="Tenir une heure sans m’arrêter…" />
          </label>
        </Section>

        <Section title="Fréquences cardiaques" id="fc" level={3}>
          <p className="text-small text-ink-2">Facultatif : sans elles, l’appli les calcule d’après tes courses et ton âge. Saisis seulement une valeur mesurée (test encadré, course à fond).</p>
          <div className="grid grid-cols-3 gap-3">
            <label className="grid gap-2">
              <span className="label text-ink-2">FC max</span>
              <Input type="number" name="hrMax" min={120} max={230} defaultValue={p?.hrMax ?? ""} num />
            </label>
            <label className="grid gap-2">
              <span className="label text-ink-2">Au repos</span>
              <Input type="number" name="hrRest" min={30} max={100} defaultValue={p?.hrRest ?? ""} num />
            </label>
            <label className="grid gap-2">
              <span className="label text-ink-2">Au seuil</span>
              <Input type="number" name="hrThreshold" min={80} max={220} defaultValue={p?.hrThreshold ?? ""} num />
            </label>
          </div>
          <label className="flex min-h-tap items-center gap-3 text-small">
            <input type="checkbox" name="thresholdTest" defaultChecked={p?.thresholdSource === "test"} className="size-5 accent-[var(--c-ink)]" /> La FC au seuil vient d’un test de 30 min
          </label>
        </Section>

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" variant="primary" icon="check">
            Enregistrer
          </Button>
          <Link href="/sante/course" className="inline-flex min-h-tap items-center font-bold text-ink-2 hover:text-ink">
            Annuler
          </Link>
        </div>
      </form>
    </div>
  );
}
