// Bandeau de la démo (MIJOTE_DEMO=1), en tête de chaque page : discret (filet, texte courant), il dit que
// les changements s'effacent, propose de recommencer, et renvoie vers l'installation.
import { buttonClass, Icon } from "@/components/ui";
import { demoLimits, INSTALL_URL } from "@/lib/demo/core";
import { restartDemo } from "./actions";

export function DemoBanner() {
  const hours = Math.round(demoLimits().idleMs / 3_600_000);
  const idle = hours >= 1 ? `${hours} h` : `${Math.round(demoLimits().idleMs / 60_000)} min`;
  return (
    <div data-demo-banner className="border-b border-line bg-surface-2">
      {/* Au téléphone, une seule ligne : la phrase courte, « Recommencer » en icône, « Installer ». Plus large,
          la phrase entière ; à la tablette, elle prend sa ligne et les deux boutons passent dessous, ensemble. */}
      <div className="mx-auto flex max-w-[1240px] items-center gap-x-3 gap-y-1 px-5 py-1.5 text-small text-ink-2 sm:flex-wrap sm:gap-x-4 sm:px-10 sm:py-2">
        <p className="min-w-0 flex-1 truncate sm:basis-[28rem] sm:whitespace-normal">
          <b className="text-ink">Démo</b>
          <span className="sm:hidden"> · s’efface après {idle}</span>
          <span className="max-sm:hidden"> : tes changements s’effacent après {idle} sans visite. Pas d’IA ni de catalogue ici.</span>
        </p>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <form action={restartDemo}>
            <button type="submit" title="Recommencer la démo" className={buttonClass({ variant: "quiet", size: "sm", className: "max-sm:w-9 max-sm:!px-0" })}>
              <Icon name="refresh" size="s" className="sm:hidden" />
              <span className="max-sm:sr-only">Recommencer</span>
            </button>
          </form>
          <a href={INSTALL_URL} className={buttonClass({ variant: "secondary", size: "sm" })} target="_blank" rel="noopener">
            Installer<span className="max-sm:hidden"> Mijote</span>
          </a>
        </div>
      </div>
    </div>
  );
}
