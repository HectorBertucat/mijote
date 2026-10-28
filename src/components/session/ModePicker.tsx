// Choix du mode au lancement d'une session : seul, à deux, prep la veille. Des boutons
// radio dans le formulaire « Lancer la session » (rien côté client), avec la durée que
// le planificateur prévoit pour chaque mode (DA : cartes du kit, l'option choisie en accent).
import type { SessionMode, SessionPlan } from "@/lib/session/planner";
import { MODE_LABELS } from "@/lib/session/planner";
import { Icon, type IconName } from "@/components/ui";
import { DurationOrigin } from "./Durations";

const ICON: Record<SessionMode, IconName> = { solo: "flame", duo: "swap", veille: "moonset" };
const WHAT: Record<SessionMode, string> = { solo: "prep puis cuisson, un seul fil", duo: "deux fils, A et B, relais dits", veille: "les bols la veille, au frigo" };

const fmt = (m: number) => {
  const r = Math.round(m / 5) * 5;
  return r >= 60 ? `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, "0")}` : `${r} min`;
};

export function modeHint(mode: SessionMode, plan: SessionPlan | undefined): string {
  if (!plan) return "";
  if (mode === "veille") return `${fmt(plan.prep.eveMin ?? 0)} la veille · ${fmt(plan.totalMin)} le jour J seul, moins à deux`;
  if (mode === "duo") return `${fmt(plan.totalMin)} à deux`;
  return fmt(plan.totalMin);
}

export function ModePicker({ plans, defaultMode = "solo" }: { plans?: Partial<Record<SessionMode, SessionPlan>>; defaultMode?: SessionMode }) {
  const modes: SessionMode[] = ["solo", "duo", "veille"];
  const any = plans?.solo ?? plans?.duo ?? plans?.veille;
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-[12px] font-bold uppercase tracking-[0.1em] text-ink-2">Mode</legend>
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
        {modes.map((m) => {
          const plan = plans?.[m];
          return (
            <label
              key={m}
              className="grid min-h-[92px] cursor-pointer content-start gap-1 rounded-[14px] border-2 border-line bg-surface px-3.5 py-3 transition-[border-color,background-color,transform] duration-[var(--dur-quick)] hover:border-line-strong active:scale-[0.98] has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus"
            >
              <input type="radio" name="mode" value={m} defaultChecked={m === defaultMode} className="sr-only" />
              <span className="flex items-center gap-2">
                <Icon name={ICON[m]} size="s" className="text-accent" />
                <b className="font-display text-[16px] [font-stretch:100%]">{MODE_LABELS[m]}</b>
              </span>
              {plan ? <span className="num text-[20px] leading-tight font-extrabold">{fmt(m === "veille" ? (plan.prep.eveMin ?? 0) : plan.totalMin)}{m === "veille" ? <span className="text-[13px] font-semibold text-ink-2"> le soir</span> : null}</span> : null}
              <span className="text-[13px] leading-snug text-ink-2">{modeHint(m, plan) && m !== "solo" ? modeHint(m, plan) : WHAT[m]}</span>
            </label>
          );
        })}
      </div>
      {/* D'où viennent ces durées : la référence, ou les dernières sessions terminées. */}
      {any && <DurationOrigin plan={any} className="pt-0.5" />}
    </fieldset>
  );
}
