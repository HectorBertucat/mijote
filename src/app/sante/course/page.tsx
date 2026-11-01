// Course (docs/course.md) : page minimale du moteur. Activer et régler le module, lire le plan en texte (semaine
// en cours, ferme, et la suivante, indicative), noter le ressenti d’une sortie, mettre en pause ou rouvrir.
// L’interface riche (graphiques du § 7) viendra avec le kit src/components/ui/charts/.
import { Section } from "@/components/sante/carnet";
import { Button, Input } from "@/components/ui";
import { db } from "@/lib/db/client";
import { activePerson } from "@/lib/health/active";
import { todayParis } from "@/lib/health/store";
import { DEFAULT_AGE, getRunProfile, PAIN_PLACES, syncPlan } from "@/lib/running/store";
import { dayLabel, WEEKDAY_LABEL } from "@/lib/running/dates";
import { acwr, FORM_LABEL, formBand, LOAD_SOURCE_LABEL } from "@/lib/running/load";
import { GOAL_LABEL, GOALS, PHASE_LABEL } from "@/lib/running/plan";
import { describe, type RunSession } from "@/lib/running/workout";
import { METHOD_LABEL, ZONE_NAMES, zoneRange } from "@/lib/running/zones";
import { feedbackAction, pauseAction, resumeAction, saveSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { prevue: "prévue", programmee: "sur la montre", faite: "faite", manquee: "manquée", annulee: "annulée" };
const pace = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}/km` : "");
const SELECT = "min-h-12 w-full rounded-[8px] border border-line-strong bg-surface px-3 text-[17px] text-ink";

export default async function Course({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const person = await activePerson();
  const { erreur } = await searchParams;
  const profile = getRunProfile(db, person.id);
  const state = profile?.enabled ? syncPlan(db, person.id) : null;
  const p = state ? getRunProfile(db, person.id)! : profile;
  const today = todayParis();
  const days = new Map((p?.days ?? []).map((d) => [d.weekday, d.time ?? ""]));

  return (
    <div className="grid gap-12">
      <header className="grid max-w-[62ch] gap-2">
        <h1 className="text-h1">Course</h1>
        <p className="text-lead text-ink-2">Un plan de reprise prudent, calculé en code d’après tes courses, ton cœur et ton ressenti ; les séances partent sur la montre par l’app Mijote Santé.</p>
        {erreur && <p className="text-ko-ink">{erreur}</p>}
      </header>

      {state && (
        <>
          <Section title="Où j’en suis" id="etat">
            <ul className="grid gap-1.5">
              <li>
                Phase {state.plan.phase} : {PHASE_LABEL[state.plan.phase]}
                {state.plan.level ? `, niveau ${state.plan.level} sur 8` : ""}, semaine {state.plan.weekInPhase}.
              </li>
              {state.plan.paused && <li className="font-bold">En pause ({state.plan.paused.reason}).</li>}
              {state.plan.messages.map((m) => (
                <li key={m}>{m}</li>
              ))}
              {state.plan.next && (
                <li>
                  Vers la phase {state.plan.next.phase} : {state.plan.next.criteria.map((c) => `${c.ok ? "✓" : "·"} ${c.label}`).join(" ; ")}.
                </li>
              )}
            </ul>
            <form className="flex gap-3">
              {state.plan.paused ? (
                <Button type="submit" formAction={resumeAction} variant="secondary">
                  Rouvrir le plan
                </Button>
              ) : (
                <Button type="submit" formAction={pauseAction} variant="quiet">
                  Mettre en pause
                </Button>
              )}
            </form>
          </Section>

          <Section title="Le plan" id="plan">
            {state.plan.weeks.slice(-2).map((w) => (
              <div key={w.weekStart} className="grid gap-2">
                <h3 className="text-h3">
                  Semaine du {dayLabel(w.weekStart)}
                  {w.weekStart > today ? " (indicative)" : ""}
                </h3>
                {w.phase > 0 && (
                  <p className="text-ink-2">
                    {w.volume} min de course, sortie longue {w.long} min{w.deload ? ", semaine de décharge" : ""}.
                  </p>
                )}
                {w.notes.map((n) => (
                  <p key={n} className="text-small text-ink-2">
                    {n}
                  </p>
                ))}
                <ul className="grid gap-3">
                  {state.sessions
                    .filter((s) => s.weekStart === w.weekStart)
                    .map((s) => {
                      const session = s.session as unknown as RunSession;
                      return (
                        <li key={s.id} className={`border-l-2 border-line pl-3 ${s.status === "annulee" ? "text-ink-3" : ""}`}>
                          <p className="font-bold">
                            {dayLabel(s.date)}
                            {s.time ? ` à ${s.time.replace(":", " h ")}` : ""} : {session.title} ({s.minutes} min) — {STATUS[s.status]}
                            {s.watchError ? ` (montre : ${s.watchError})` : ""}
                          </p>
                          <p className="text-small text-ink-2">{describe(session).join(" · ")}</p>
                          <p className="text-small text-ink-2">{session.notes}</p>
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))}
          </Section>

          <Section title="Zones et charge" id="zones">
            <p className="text-ink-2">
              FC max {state.data.zones.max} bpm ({METHOD_LABEL[state.data.zones.maxSource]}
              {!state.data.ageKnown && state.data.zones.maxSource === "age" ? `, sur ${DEFAULT_AGE} ans faute de date de naissance` : ""}), au repos {state.data.zones.rest} bpm
              {state.data.zones.restSource === "defaut" ? " (par défaut)" : ""}, au seuil {state.data.zones.threshold} bpm
              {state.data.zones.thresholdSource === "estimee" ? " (estimée)" : ""}.
              {state.data.observed.maxPending ? ` Pic de ${state.data.observed.maxPending} bpm à confirmer.` : ""}
            </p>
            <ul className="grid gap-1 text-small">
              {([1, 2, 3, 4, 5] as const).map((k) => (
                <li key={k}>
                  Z{k} {ZONE_NAMES[k]} : {zoneRange(state.data.zones, k).join("–")} bpm
                </li>
              ))}
            </ul>
            {(() => {
              const f = state.data.fitness[state.data.fitness.length - 1];
              const ratio = acwr(state.data.dailyRun, today);
              return f ? (
                <p className="text-ink-2">
                  Condition {Math.round(f.ctl)}, fatigue {Math.round(f.atl)}
                  {f.tsbPct != null ? `, fraîcheur ${Math.round(f.tsbPct)} % (${FORM_LABEL[formBand(f.tsbPct)].toLowerCase()})` : ""}.
                  {ratio ? ` Rapport aigu/chronique de course : ${ratio.value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} (indicatif, bande 0,8–1,3 ; il ne décide de rien).` : ""}
                </p>
              ) : null;
            })()}
          </Section>

          {state.data.runs.length > 0 && (
            <Section title="Dernières courses" id="courses">
              <ul className="grid gap-2">
                {state.data.runs
                  .slice(-8)
                  .reverse()
                  .map((r) => {
                    const a = r.analysis;
                    const tot = a.seiler.easy + a.seiler.moderate + a.seiler.hard;
                    return (
                      <li key={r.sampleId}>
                        <span className="font-bold">{dayLabel(r.date)}</span> : {Math.round(a.movingMin || r.minutes)} min
                        {a.distanceKm ? `, ${a.distanceKm.toLocaleString("fr-FR")} km, ${pace(a.pace)}` : ""}
                        {a.gap && a.gap !== a.pace ? ` (ajustée à la pente ${pace(a.gap)})` : ""}
                        {tot ? `, ${Math.round((100 * a.seiler.easy) / tot)} % en facile` : ""}, charge {Math.round(a.load)} ({LOAD_SOURCE_LABEL[a.loadSource]})
                        {a.decoupling.ok ? `, découplage ${a.decoupling.value.toLocaleString("fr-FR")} %` : ""}
                        {a.heat ? ", chaleur" : ""}
                        {r.feedback?.pain ? `, douleur ${r.feedback.pain}` : ""}
                      </li>
                    );
                  })}
              </ul>
            </Section>
          )}

          <Section title="Après une sortie" id="ressenti">
            <form action={feedbackAction} className="grid max-w-[480px] gap-3">
              <label className="grid gap-1.5">
                <span className="label text-ink-2">Jour</span>
                <Input type="date" name="date" defaultValue={today} max={today} />
              </label>
              <label className="grid gap-1.5">
                <span className="label text-ink-2">Effort (1 à 10)</span>
                <Input type="number" name="effort" min={1} max={10} num />
              </label>
              <label className="grid gap-1.5">
                <span className="label text-ink-2">Une douleur ? (0 à 10)</span>
                <Input type="number" name="pain" min={0} max={10} num />
              </label>
              <label className="grid gap-1.5">
                <span className="label text-ink-2">Où</span>
                <select name="painWhere" className={SELECT} defaultValue="">
                  <option value="">—</option>
                  {PAIN_PLACES.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="sick" /> Malade (fièvre, symptômes sous le cou)
              </label>
              <Button type="submit" variant="primary">
                Noter
              </Button>
            </form>
          </Section>
        </>
      )}

      <Section title={p?.enabled ? "Réglages" : "Activer la course"} id="reglages">
        <form action={saveSettingsAction} className="grid max-w-[560px] gap-4">
          <label className="flex items-center gap-2 font-bold">
            <input type="checkbox" name="enabled" defaultChecked={p?.enabled ?? true} /> Module Course activé pour {person.name}
          </label>
          <fieldset className="grid gap-2">
            <legend className="label text-ink-2">Jours où tu peux courir, et l’heure</legend>
            {WEEKDAY_LABEL.map((label, d) => (
              <div key={d} className="grid grid-cols-[140px_1fr] items-center gap-3">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name={`day${d}`} defaultChecked={days.has(d)} /> {label}
                </label>
                <Input type="time" name={`time${d}`} defaultValue={days.get(d) ?? ""} aria-label={`Heure du ${label}`} />
              </div>
            ))}
          </fieldset>
          <label className="grid gap-1.5">
            <span className="label text-ink-2">Sorties par semaine</span>
            <select name="perWeek" className={SELECT} defaultValue={String(p?.perWeek ?? 3)}>
              {[2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="label text-ink-2">Objectif</span>
            <select name="goal" className={SELECT} defaultValue={p?.goal ?? "plus_longtemps"}>
              {GOALS.map((g) => (
                <option key={g} value={g}>
                  {GOAL_LABEL[g]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="label text-ink-2">En tes mots (facultatif)</span>
            <Input name="goalNote" defaultValue={p?.goalNote ?? ""} maxLength={300} />
          </label>
          <label className="grid gap-1.5">
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
          <label className="grid gap-1.5">
            <span className="label text-ink-2">Heure préférée (sinon 7 h sur la montre)</span>
            <Input type="time" name="time" defaultValue={p?.time ?? ""} />
          </label>
          <fieldset className="grid gap-2">
            <legend className="label text-ink-2">Fréquences cardiaques mesurées (facultatif : sinon calculées)</legend>
            <div className="grid grid-cols-3 gap-3">
              <Input type="number" name="hrMax" placeholder="FC max" min={120} max={230} defaultValue={p?.hrMax ?? ""} num aria-label="FC max" />
              <Input type="number" name="hrRest" placeholder="Au repos" min={30} max={100} defaultValue={p?.hrRest ?? ""} num aria-label="FC au repos" />
              <Input type="number" name="hrThreshold" placeholder="Au seuil" min={80} max={220} defaultValue={p?.hrThreshold ?? ""} num aria-label="FC au seuil" />
            </div>
            <label className="flex items-center gap-2 text-small">
              <input type="checkbox" name="thresholdTest" defaultChecked={p?.thresholdSource === "test"} /> La FC au seuil vient d’un test de 30 min
            </label>
          </fieldset>
          <Button type="submit" variant="primary">
            Enregistrer
          </Button>
        </form>
      </Section>
    </div>
  );
}
