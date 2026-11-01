// Prudence : ce qui retient le plan aujourd'hui (douleur récente, variabilité basse, FC au repos haute, nuits
// courtes, fatigue, chaleur), seulement quand cela compte ; sinon, les repères du matin en une ligne discrète.
// Pas de diagnostic : Mijote dit quoi faire de la course, pas ce qu'est la douleur.
import type { CourseView } from "@/lib/running/page";
import { dayLabel } from "@/lib/running/dates";
import { typo } from "@/lib/typo";
import { NB, Note } from "../carnet";

export function Cautions({ v }: { v: CourseView }) {
  const c = v.caution;
  const notes: { title: string; text: string }[] = [];
  if (c.painRecent && !v.plan.paused)
    notes.push({
      title: `Douleur ${c.painRecent.pain} sur 10${c.painRecent.where ? ` (${c.painRecent.where})` : ""}, ${dayLabel(c.painRecent.date)}`,
      text: "La prochaine course est remplacée par du repos ou de la natation et la semaine suivante allège. Note de nouveau demain matin ; si elle dure ou revient, l’avis d’un professionnel de santé.",
    });
  for (const s of c.signals) notes.push({ title: s.text.split(" : ")[0], text: s.text.split(" : ").slice(1).join(" : ") });
  if (!notes.length) return null;
  return (
    <section aria-label="Prudence" className="grid gap-4">
      {notes.map((n) => (
        <Note key={n.title} tone="warn" title={typo(n.title)}>
          {n.text ? typo(`${n.text[0].toUpperCase()}${n.text.slice(1)}`) : null}
        </Note>
      ))}
    </section>
  );
}

/** Les repères du matin, quand rien ne retient : FC au repos et variabilité face à leur habitude. */
export function MorningLine({ v }: { v: CourseView }) {
  const m = v.caution.morning;
  const parts: string[] = [];
  if (m.rest) parts.push(`FC au repos ${Math.round(m.rest.mean7)}${NB}bpm sur 7 jours (habitude ${Math.round(m.rest.ref)})`);
  if (m.hrv) parts.push(`variabilité ${Math.round(Math.exp(m.hrv.mean7))}${NB}ms (habitude ${Math.round(Math.exp(m.hrv.mean60))})`);
  if (!parts.length || v.caution.signals.length) return null;
  return (
    <div className="grid content-start gap-2">
      <span className="label text-ink-2">Ce matin</span>
      <p className="text-small text-ink-2">{`${parts.join(", ")} : rien ne retient le plan.`}</p>
    </div>
  );
}
