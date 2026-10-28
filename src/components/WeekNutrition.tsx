// Apports moyens de la semaine par personne (src/lib/week/nutrition.ts), DA « Plan de travail » :
// gros chiffres par jour colorés selon le repère, barres jour par jour (DayBars), jauges (Gauge),
// répartition protéines / glucides / lipides et le repas moyen. Repère = cible du jour de Santé
// (dayRef) ; sans cible (profil incomplet), moyennes seules.
import { Card, DayBars, Gauge, Macro, MacroRow, verdictTone, verdictWord, type DayBar, type Tone } from "@/components/ui";
import type { Macros } from "@/lib/nutrition/compute";
import { REF_KCAL, type DayRef, type PersonWeek } from "@/lib/week/nutrition";

type Verdict = "ok" | "low" | "high";
const verdict = (v: number, min: number, max: number): Verdict => (v < min ? "low" : v > max ? "high" : "ok");
const fr = (n: number) => Math.round(n).toLocaleString("fr-FR");
const LETTER = ["L", "M", "M", "J", "V", "S", "D"];
const tone = (v: number, min: number, max: number): Tone => verdictTone(verdict(v, min, max));

export function WeekNutrition({ people, stack = false }: { people: { id: string; name: string; week: PersonWeek; ref: DayRef | null }[]; stack?: boolean }) {
  return (
    <section className="grid gap-2.5" aria-labelledby="nutri-titre">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 id="nutri-titre" className="text-[18px] font-bold">
          Bilan nutrition
        </h2>
        <p className="text-[13px] text-ink-2">moyenne par jour, sur les repas du batch</p>
      </div>
      <div className={`grid gap-3 sm:grid-cols-2 ${stack ? "lg:grid-cols-1" : ""}`}>
        {people.map((p) => (
          <PersonCard key={p.id} name={p.name} w={p.week} T={p.ref} />
        ))}
      </div>
      <p className="text-[13px] leading-snug text-ink-2">
        Les repas pris ailleurs ne sont pas comptés.{" "}
        {people
          .filter((p) => p.week.outsideDays > 0)
          .map((p) => (
            <span key={p.id}>{p.name} : son hors batch (petit-déjeuner, en-cas) est ajouté chaque jour. </span>
          ))}
        {people.some((p) => p.ref?.source === "sante" || p.ref?.source === "estimation") ? (
          <>Repère par jour = la cible de la semaine calculée dans Santé (±{REF_KCAL} kcal ; « estimation » tant que la dépense n&apos;est pas mesurée), comparée aux 2 repas du batch et au hors batch. </>
        ) : null}
        {people
          .filter((p) => p.ref)
          .map((p) => (
            <span key={p.id}>
              {p.name} :{" "}
              <span className="num">
                {fr(p.ref!.kcalMin)}-{fr(p.ref!.kcalMax)}
              </span>{" "}
              kcal,{" "}
              <span className="num">
                {p.ref!.proteinMin}-{p.ref!.proteinMax}
              </span>{" "}
              g de protéines{p.ref!.source === "fixe" ? " (repère fixe du profil, remplacé par la cible de Santé quand la dépense sera mesurée)" : p.ref!.source === "estimation" ? " (estimation par formule)" : ""}.{" "}
            </span>
          ))}
        Barres : énergie jour par jour ; colorées seulement les jours à 2 repas du batch.
      </p>
    </section>
  );
}

function PersonCard({ name, w, T }: { name: string; w: PersonWeek; T: DayRef | null }) {
  const counts = [`${w.meals} repas`, `${w.days} jour${w.days > 1 ? "s" : ""}`].filter(Boolean).join(" · ");
  const maxDay = Math.max((T?.kcalMax ?? 2000) * 1.15, ...w.byDay.map((d) => d?.macros.kcal ?? 0));
  const bars: DayBar[] = w.byDay.map((d, i) => ({
    label: LETTER[i],
    value: d ? d.macros.kcal : null,
    tone: d && T && d.meals >= 2 ? tone(d.macros.kcal, T.kcalMin, T.kcalMax) : undefined,
    title: d ? `${fr(d.macros.kcal)} kcal · ${fr(d.macros.protein)} g de protéines · ${d.meals} repas` : "aucun repas du batch",
  }));
  return (
    <Card pad="md" className="grid content-start gap-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <b className="font-display text-[17px]">{name}</b>
        <span className="text-[13px] tabular-nums text-ink-2">{counts}</span>
      </div>
      {!w.perDay || !w.perMeal ? (
        <p className="text-[15px] text-ink-2">Aucun repas du batch cette semaine.</p>
      ) : (
        <>
          <MacroRow>
            {T ? (
              <>
                <Macro value={fr(w.perDay.kcal)} unit="kcal" tone={tone(w.perDay.kcal, T.kcalMin, T.kcalMax)} sub={verdictWord(verdict(w.perDay.kcal, T.kcalMin, T.kcalMax))} />
                <Macro value={fr(w.perDay.protein)} unit="g" tone={tone(w.perDay.protein, T.proteinMin, T.proteinMax)} sub="protéines" />
              </>
            ) : (
              <>
                <Macro value={fr(w.perDay.kcal)} unit="kcal" sub="par jour" />
                <Macro value={fr(w.perDay.protein)} unit="g" sub="protéines" />
              </>
            )}
          </MacroRow>
          <DayBars days={bars} max={maxDay} target={T ? (T.kcalMin + T.kcalMax) / 2 : undefined} />
          {T && (
            <div className="grid gap-3">
              <Gauge label="Énergie" unit="kcal" display={fr(w.perDay.kcal)} value={w.perDay.kcal} max={T.kcalMax * 1.25} target={[T.kcalMin, T.kcalMax]} tone={tone(w.perDay.kcal, T.kcalMin, T.kcalMax)} left={verdictWord(verdict(w.perDay.kcal, T.kcalMin, T.kcalMax))} right={`repère ${fr(T.kcalMin)} à ${fr(T.kcalMax)}`} />
              <Gauge label="Protéines" unit="g" value={w.perDay.protein} max={T.proteinMax * 1.25} target={[T.proteinMin, T.proteinMax]} tone={tone(w.perDay.protein, T.proteinMin, T.proteinMax)} left={verdictWord(verdict(w.perDay.protein, T.proteinMin, T.proteinMax))} right={`repère ${T.proteinMin} à ${T.proteinMax} g`} />
            </div>
          )}
          <Split m={w.perDay} />
          <PerMeal m={w.perMeal} t={T?.meal ?? null} />
        </>
      )}
      {w.unknownMeals > 0 && <p className="text-[13px] text-warn-ink">{w.unknownMeals} repas sans valeurs nutritionnelles, non comptés.</p>}
    </Card>
  );
}

/** Répartition de l'énergie entre protéines, glucides et lipides, et les grammes. */
function Split({ m }: { m: Macros }) {
  const parts = [
    { key: "P", label: "protéines", g: m.protein, kcal: m.protein * 4, cls: "bg-accent" },
    { key: "G", label: "glucides", g: m.carbs, kcal: m.carbs * 4, cls: "bg-ink-2" },
    { key: "L", label: "lipides", g: m.fat, kcal: m.fat * 9, cls: "bg-line-strong" },
  ];
  const sum = parts.reduce((t, p) => t + p.kcal, 0) || 1;
  return (
    <div className="grid gap-1.5">
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.kcal / sum) * 100)} %`).join(", ")}>
        {parts.map((p) => (
          <div key={p.key} className={p.cls} style={{ width: `${(p.kcal / sum) * 100}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] tabular-nums text-ink-2">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1">
            <span className={`size-2 rounded-full ${p.cls}`} aria-hidden />
            <b className="font-semibold text-ink">{fr(p.g)} g</b> {p.label} <span className="text-faint">{Math.round((p.kcal / sum) * 100)} %</span>
          </span>
        ))}
        <span>
          <b className="font-semibold text-ink">{fr(m.fiber)} g</b> fibres
        </span>
      </div>
    </div>
  );
}

function PerMeal({ m, t }: { m: Macros; t: DayRef["meal"] | null }) {
  const kc = t ? { ok: "text-ok", low: "text-warn", high: "text-ko" }[verdict(m.kcal, t.kcalMin, t.kcalMax)] : "";
  const pc = t ? { ok: "text-ok", low: "text-warn", high: "text-ko" }[verdict(m.protein, t.proteinMin, t.proteinMax)] : "";
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line pt-2.5 text-[14px] tabular-nums">
      <span>
        <span className="text-ink-2">Repas moyen : </span>
        <b className={kc}>{fr(m.kcal)} kcal</b> · <b className={pc}>{fr(m.protein)} g</b>
      </span>
      {t && (
        <span className="text-[12px] text-faint">
          repère {t.kcalMin}-{t.kcalMax} kcal · {t.proteinMin}-{t.proteinMax} g
        </span>
      )}
    </div>
  );
}
