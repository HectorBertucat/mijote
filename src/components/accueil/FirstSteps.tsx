// Premiers pas de l’accueil (src/lib/tour/core.ts) : les cinq gestes de la première semaine, cochés d’après ce
// que l’instance a vraiment fait, le prochain en gras. La liste disparaît quand tout est fait, ou se masque.
// Composant serveur ; la dernière étape de la visite guidée montre son en-tête (data-tour="premiers-pas").
import Link from "next/link";
import { Icon } from "@/components/ui";
import { firstStepsAction } from "@/app/reglages/actions";
import type { FirstStepsView } from "@/lib/tour/core";
import { typo } from "@/lib/typo";

const QUIET = "inline-flex min-h-tap items-center rounded-[8px] text-small font-semibold text-ink-2 underline decoration-line-strong decoration-1 underline-offset-[6px] hover:text-ink hover:decoration-ink";

export function FirstSteps({ view }: { view: FirstStepsView }) {
  return (
    <section aria-labelledby="pas-titre">
      <div data-tour="premiers-pas" className="flex items-end justify-between gap-4 border-b border-line-strong pb-4">
        <h2 id="pas-titre" className="text-h2">
          Premiers pas
        </h2>
        <p className="flex items-baseline gap-2" aria-label={`${view.done} sur ${view.total} faits`}>
          <span className="num-tight text-num-xl">{view.done}</span>
          <span className="label text-faint">sur {view.total}</span>
        </p>
      </div>
      <ol className="reveal">
        {view.items.map((s) => {
          const next = s.id === view.next;
          const mark = (
            <span aria-hidden className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-[4px] border ${s.done ? "border-ink bg-ink text-bg" : next ? "border-ink" : "border-line-strong"}`}>
              {s.done && <Icon name="check" size="s" strokeWidth={2.4} />}
            </span>
          );
          const text = (
            <span className="grid min-w-0 flex-1 gap-1">
              <span className={s.done ? "text-ink-3 line-through decoration-1" : next ? "font-bold" : "font-semibold text-ink-2"}>{s.label}</span>
              {!s.done && <span className="text-small text-ink-2">{typo(s.hint)}</span>}
            </span>
          );
          return (
            <li key={s.id} className="border-b border-line">
              {s.done ? (
                <span className="flex items-start gap-3 py-4">
                  {mark}
                  {text}
                  <span className="sr-only">fait</span>
                </span>
              ) : (
                <Link href={s.href} className="-mx-3 flex min-w-0 items-start gap-3 rounded-[8px] px-3 py-4 hover:bg-surface-2">
                  {mark}
                  {text}
                  <Icon name="chev" className="mt-0.5 shrink-0 text-faint" />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-x-6">
        <Link href="/?visite=1" className={QUIET}>
          Revoir la visite
        </Link>
        <form action={firstStepsAction}>
          <input type="hidden" name="hidden" value="1" />
          <button type="submit" className={QUIET}>
            Masquer la liste
          </button>
        </form>
      </div>
    </section>
  );
}
