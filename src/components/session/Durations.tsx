// Durées réelles à l’écran : l’origine des durées d’un plan (écran de lancement, en-tête
// de session) et le bilan prévu / réel de fin de session, par geste et par étape. Sans
// hook : utilisable dans une page serveur (ModePicker) comme dans les vues de session.
import type { SessionPlan } from "@/lib/session/planner";
import type { SessionEvent } from "@/lib/session/state";
import { cookedEnough, durationsOrigin, measureSession, sessionReport, type ReportRow } from "@/lib/session/durations";

const fmt = (m: number) => {
  if (m >= 60) {
    const r = Math.round(m);
    return `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, "0")}`;
  }
  const x = m < 10 ? Math.round(m * 2) / 2 : Math.round(m);
  return `${String(x).replace(".", ",")} min`;
};

/** « Durées corrigées d’après tes 2 dernières sessions », avec le détail dépliable. */
export function DurationOrigin({ plan, className = "" }: { plan: Pick<SessionPlan, "durations">; className?: string }) {
  if (!plan.durations) return null; // plan d'avant le 20/10 : rien à dire
  const o = durationsOrigin(plan);
  if (!o.detail.length) return <p className={`text-xs text-muted ${className}`}>{o.text}</p>;
  return (
    <details className={`group text-xs text-muted ${className}`}>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className="mr-2 inline-block size-2 rounded-full bg-accent align-middle" aria-hidden />
        <span className="font-medium text-ink">{o.text}</span>
        <span className="ml-1 group-open:hidden">· {o.detail.length} correction{o.detail.length > 1 ? "s" : ""}, voir</span>
      </summary>
      <ul className="mt-2 space-y-1 pl-4">
        {o.detail.map((d) => (
          <li key={d}>{d}</li>
        ))}
        <li className="pt-1">Moyenne prudente avec la référence (elle compte pour 2 sessions), écart plafonné ; une mesure seule trop loin ne change rien.</li>
      </ul>
    </details>
  );
}

function Gap({ row }: { row: ReportRow }) {
  if (row.realMin == null) return <span className="text-xs text-muted">non mesuré</span>;
  const d = row.realMin - row.plannedMin;
  const small = Math.abs(d) < Math.max(0.5, row.plannedMin * 0.1);
  return (
    <span className={`num inline-flex h-6 items-center rounded-full px-2 text-small font-semibold ${small ? "bg-surface-2 text-ink-2" : d > 0 ? "border border-line-strong text-ink" : "bg-accent-soft text-accent"}`}>
      {small ? "≈ prévu" : `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}`}
    </span>
  );
}

function Rows({ rows }: { rows: ReportRow[] }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface text-[17px]">
      {rows.map((r) => (
        <li key={r.ref} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate">{r.label}</span>
            {(r.phase === "veille" || r.shared || (r.realMin != null && !r.kept) || r.perKg != null) && (
              <span className="block text-xs text-muted">
                {[
                  r.phase === "veille" ? "la veille" : null,
                  r.perKg != null ? `${String(Math.round(r.perKg * 10) / 10).replace(".", ",")} min/kg` : null,
                  r.shared ? "au prorata du bol coché" : null,
                  r.realMin != null && !r.kept ? "trop loin du prévu : pas retenu" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center justify-end gap-3">
            <span className="num text-ink-2">prévu {fmt(r.plannedMin)}</span>
            <span className="num w-24 text-right font-bold">{r.realMin != null ? `réel ${fmt(r.realMin)}` : "—"}</span>
            <span className="w-24 text-right">
              <Gap row={r} />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Bilan de fin de session : prévu / réel par geste de prep et par étape (mêmes mesures que les corrections). */
export function DurationReport({ plan, events, startedAt }: { plan: SessionPlan; events: SessionEvent[]; startedAt: string | null }) {
  const { gestures, steps } = sessionReport(plan, measureSession(plan, events, startedAt));
  const measured = (rows: ReportRow[]) => rows.filter((r) => r.realMin != null).length;
  const stepRows = steps.filter((r) => r.realMin != null);
  return (
    <div className="space-y-4">
      <p className="text-[17px] text-ink-2">
        Mesuré : {measured(gestures)} geste{measured(gestures) > 1 ? "s" : ""} de prep sur {gestures.length}, {stepRows.length} étape{stepRows.length > 1 ? "s" : ""} sur {steps.length}. Un geste dure
        du « fait » d’avant au sien ; un bol coché sans ses gestes se partage entre eux au prorata.
      </p>
      {gestures.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[20px] font-bold">Gestes de prep</h2>
          <Rows rows={gestures} />
        </section>
      )}
      {steps.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[20px] font-bold">Étapes</h2>
          <Rows rows={stepRows.length ? stepRows : steps} />
          {stepRows.length < steps.length && stepRows.length > 0 && (
            <p className="text-xs text-muted">{steps.length - stepRows.length} étape{steps.length - stepRows.length > 1 ? "s" : ""} sans début ou sans fin dans le journal : pas mesurée{steps.length - stepRows.length > 1 ? "s" : ""}.</p>
          )}
        </section>
      )}
      <p className="text-xs text-muted">
        {cookedEnough(plan, events)
          ? "Ces durées corrigent les prochaines sessions : moyenne prudente avec la référence, sur tes 5 dernières sessions cuisinées ; une mesure trop loin (pause, oubli de toucher, coché en passant) est écartée."
          : "Session terminée avant d’avoir cuisiné une étape : ces durées ne corrigent pas les prochaines sessions."}
      </p>
    </div>
  );
}
