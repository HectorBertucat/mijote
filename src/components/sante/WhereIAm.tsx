// « Où j'en suis » (Santé) : l'objectif et le rythme, la cible et d'où elle vient, ce qui manque pour
// qu'elle s'ajuste lundi, les protéines, et ce que ça change pour les portions. Les chiffres et les phrases
// viennent du code (src/lib/health/status.ts) ; ce composant ne fait que les poser.
// `WhereIAm` : la section entière (Santé › Objectifs) ; `WhereIAmSummary` : deux lignes et un lien
// (vue d'ensemble de Santé, accueil).
import Link from "next/link";
import { GOAL_LABEL, type Confidence } from "@/lib/health/core";
import { frDay, type Status } from "@/lib/health/status";
import type { StatusView } from "@/lib/health/status-store";
import { HowCalc, KeyFigure, NB, Note, Section, signed, Verdict } from "./carnet";
import { ProteinSwitch, RefModeSwitch } from "./WhereIAmActions";

const TONE: Record<Confidence, "ok" | "warn" | "idle"> = { adaptive: "ok", holding: "warn", estimate: "idle" };
const kg1 = (v: number) => v.toFixed(1).replace(".", ",");
const short = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", timeZone: "UTC" });
const LINK = "inline-flex min-h-tap items-center text-small font-bold text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink hover:decoration-ink";

export function WhereIAm({ s, className = "" }: { s: StatusView; className?: string }) {
  const t = s.target;
  const c = s.update.complete;
  const w = s.update.weighIns;
  return (
    <Section title="Où j’en suis" id="ou-j-en-suis" className={className} aside={<span className="label text-ink-2">Mise à jour {frDay(s.update.next)}</span>}>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
        <KeyFigure
          size="lg"
          label="Objectif"
          value={s.goal ? GOAL_LABEL[s.goal] : "—"}
          className="col-span-2 sm:col-span-1 [&_b]:text-h2 [&_b]:whitespace-normal"
          sub={s.trend ? <>Tendance {kg1(s.trend.kg)}{NB}kg{s.targetWeightKg ? `, objectif ${kg1(s.targetWeightKg)}${NB}kg` : ""}. {s.trend.text}</> : "Pas encore de pesée."}
        />
        <KeyFigure size="lg" label="Cible du jour" value={t ? t.kcal.toLocaleString("fr-FR") : "—"} unit={t ? "kcal" : undefined} sub={t && <Verdict tone={TONE[t.confidence]}>{`dépense ${t.word}`}</Verdict>} />
        <KeyFigure
          size="lg"
          label="Protéines"
          value={s.protein.target ?? "—"}
          unit={s.protein.target != null ? "g" : undefined}
          sub={
            s.protein.avg != null
              ? `${s.protein.avg}${NB}g en moyenne sur ${s.protein.days} ${s.protein.fromComplete ? (s.protein.days > 1 ? "journées complètes" : "journée complète") : s.protein.days > 1 ? "jours notés" : "jour noté"}`
              : "pas encore de journée notée"
          }
        />
      </div>

      <div className="grid gap-4">
        <h3 className="text-h3">Pour que la cible s’ajuste</h3>
        {s.update.ready ? (
          <Verdict tone="ok">{t?.confidence === "adaptive" ? "La dépense reste mesurée lundi" : "Lundi, la dépense sera mesurée"}</Verdict>
        ) : (
          <ul className="grid max-w-[62ch] gap-2 text-body">
            {s.todo.map((x) => (
              <li key={x} className="border-l-2 border-line-strong pl-3">
                {x}
              </li>
            ))}
          </ul>
        )}
        <DayStrip s={s} />
        <p className="text-small tabular-nums text-ink-2">
          Sur les trois semaines qui finissent dimanche : <b className="text-ink">{c.have}</b> sur {c.need} journées complètes, <b className="text-ink">{w.have}</b> {w.have > 1 ? "pesées" : "pesée"} ({w.need} au moins).
          {!s.update.ready && ` Sinon, lundi, la cible reste «${NB}${s.update.nextConfidence === "holding" ? "en attente" : "estimation"}${NB}».`}{" "}
          <Link href="/sante/aujourdhui" className={LINK}>
            Noter aujourd’hui
          </Link>
        </p>
      </div>

      <div className="grid gap-4">
        <h3 className="text-h3">Tes portions</h3>
        {s.portions.mode === "fixe" ? (
          <Note tone="warn" title="Ton repère est fixe : il ne suit pas ta cible" action={<RefModeSwitch personId={s.person.id} auto={false} />}>
            {s.portions.text} En automatique, il se recalcule chaque lundi depuis ta cible, moins le hors batch, d’au plus 100{NB}kcal par semaine.
          </Note>
        ) : (
          <div className="grid max-w-[62ch] gap-2 text-body">
            <p>{s.portions.text}</p>
            {s.portions.next && <p className="text-small text-ink-2">{s.portions.next}</p>}
            {s.portions.ref && <RefModeSwitch personId={s.person.id} auto />}
          </div>
        )}
        {s.protein.suggestPerKg != null && (
          <Note
            title={`Protéines en g/kg plutôt qu’en grammes fixes`}
            action={<ProteinSwitch personId={s.person.id} perKg={s.protein.suggestPerKg} />}
          >
            {`Tes ${s.protein.target}${NB}g par jour font ${s.protein.perKg!.toFixed(1).replace(".", ",")}${NB}g/kg aujourd’hui. En recomposition, le poids bouge : en g/kg, la cible de protéines le suit.`}
          </Note>
        )}
      </div>

      <HowCalc>
        {t && <p>{t.text}</p>}
        <p>
          Chaque lundi, la dépense se mesure sur les 21 jours qui précèdent : apports moyens des journées complètes, moins la variation de la tendance du poids (7{NB}700{NB}kcal par kilo). Il faut 12 journées complètes (4 par semaine) et 3 pesées sur ces trois semaines. Sinon, la cible garde la dernière dépense mesurée («{NB}en attente{NB}»), ou la formule s’il n’y en a jamais eu («{NB}estimation{NB}»).
        </p>
        <p>Une journée complète, c’est une journée où tout ce qui a été mangé est noté. Une journée oubliée n’est pas comptée comme zéro : elle est ignorée.</p>
        {s.trend?.ratePct != null && <p>{`Rythme réel : ${signed(s.trend.ratePct, 2)} % du poids par semaine, visé ${signed(s.trend.aimedPct, 2)} %.`}</p>}
      </HowCalc>
    </Section>
  );
}

/** Les jours de la fenêtre du lundi : complets, notés sans être complets, vides. Un tap ouvre le jour. */
function DayStrip({ s }: { s: StatusView }) {
  const days = [...s.days].reverse();
  return (
    <ol aria-label="Journées des trois semaines" className="flex flex-wrap gap-1">
      {days.map((d) => {
        const state = d.complete ? "complète" : d.kcal != null ? `notée sans être complète, ${d.kcal}${NB}kcal` : "rien de noté";
        return (
          <li key={d.date}>
            <Link
              href={`/sante/aujourdhui?jour=${d.date}`}
              title={`${short(d.date)} : ${state}`}
              aria-label={`${frDay(d.date)} : ${state}`}
              className={`flex size-7 items-center justify-center rounded-[4px] border text-[0.625rem] font-bold tabular-nums ${d.complete ? "border-ok bg-ok-soft text-ok" : d.kcal != null ? "border-line-strong text-ink-2" : "border-dashed border-line text-ink-3"}`}
            >
              {Number(d.date.slice(8))}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/** En deux lignes : la cible et sa source, la première chose à faire, un lien vers le détail. */
export function WhereIAmSummary({ s, href = "/sante/objectifs#ou-j-en-suis", className = "" }: { s: Status; href?: string; className?: string }) {
  const t = s.target;
  return (
    <div className={`flex flex-wrap items-center justify-between gap-4 border-l-2 py-1 pl-4 ${s.portions.mode === "fixe" || (t && t.confidence !== "adaptive") ? "border-warn" : "border-line-strong"} ${className}`}>
      <div className="grid min-w-0 max-w-[62ch] gap-1">
        <b className="text-body">
          {t ? (
            <>
              Cible {t.kcal.toLocaleString("fr-FR")}
              {NB}kcal, {t.proteinG}
              {NB}g de protéines · <Verdict tone={TONE[t.confidence]}>{`dépense ${t.word}`}</Verdict>
            </>
          ) : (
            "Pas encore de cible"
          )}
        </b>
        <span className="text-small text-ink-2">
          {s.headline}
          {s.portions.mode === "fixe" && " Ton repère de repas est fixe : il ne suit pas la cible."}
        </span>
      </div>
      <Link href={href} className={LINK}>
        Où j’en suis
      </Link>
    </div>
  );
}
