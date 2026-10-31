// Repère visuel pour saisir à la poêle (inox) : la poêle est prête quand quelques gouttes d'eau perlent et
// glissent en dansant (effet Leidenfrost, vers 190-200 °C), pas quand elles grésillent et s'évaporent.
// S'affiche au début d'une saisie à la poêle inox (avant la première sous-étape finie). Pas un défi : un repère.
import type { PlanStep } from "@/lib/session/planner";

/** Saisie à la poêle inox, au tout début (sans sous-étape, ou la première encore en cours). */
export function wantsDropGuide(step: PlanStep, phase: number | null, active: boolean): boolean {
  if (!active || step.kind !== "sear") return false;
  if (!/poele|poêle|inox/i.test(`${step.equipmentId ?? ""} ${step.equipmentName ?? ""}`)) return false;
  return !step.phases?.length || phase === 0;
}

export function DropGuide({ onInk = false }: { onInk?: boolean }) {
  const pan = onInk ? "var(--c-ink-3)" : "var(--i-steel-2)";
  return (
    <div className={`grid gap-2 rounded-[14px] border px-4 py-3 ${onInk ? "border-line" : "border-line bg-surface-2"}`}>
      <b className="text-[17px]">Le test de la goutte</b>
      <div className="grid grid-cols-2 gap-3">
        <figure className="grid justify-items-center gap-1 text-center">
          <svg viewBox="0 0 120 56" width="100%" className="max-w-[150px]" aria-hidden fill="none">
            <ellipse cx="60" cy="42" rx="52" ry="9" fill={pan} opacity="0.55" />
            <g className="k-drop-sizzle">
              <circle cx="44" cy="36" r="4" fill="var(--i-water)" />
              <circle cx="66" cy="38" r="3" fill="var(--i-water)" />
              <path d="M44 28c-2-3 2-5 0-8M66 30c-2-3 2-5 0-8M78 32c-2-3 2-5 0-8" stroke="var(--i-steam)" strokeWidth="2.2" strokeLinecap="round" />
            </g>
          </svg>
          <figcaption className="text-small leading-tight text-ink-2">
            <b className="block text-ink">Elles grésillent</b>
            pas encore chaud
          </figcaption>
        </figure>
        <figure className="grid justify-items-center gap-1 text-center">
          <svg viewBox="0 0 120 56" width="100%" className="max-w-[150px]" aria-hidden fill="none">
            <ellipse cx="60" cy="42" rx="52" ry="9" fill={pan} opacity="0.55" />
            <g className="k-drop-dance">
              <circle cx="52" cy="34" r="6" fill="var(--i-water)" />
              <circle cx="51" cy="32" r="1.8" fill="var(--i-shine)" />
              <circle cx="72" cy="36" r="4" fill="var(--i-water)" />
            </g>
          </svg>
          <figcaption className="text-small leading-tight text-ink-2">
            <b className="block text-ink">Elles perlent et dansent</b>
            c&apos;est prêt : baisse d&apos;un cran
          </figcaption>
        </figure>
      </div>
      <p className="text-small text-ink-2">Poêle à sec, niveau 6 à 7, 2 à 3 min. Quand elles dansent : un cran de moins, l&apos;huile, et la viande dès que l&apos;huile ondule. Ensuite n&apos;y touche plus : elle se décolle seule quand la croûte est faite.</p>
    </div>
  );
}
