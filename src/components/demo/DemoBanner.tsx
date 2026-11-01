// Bandeau de la démo (MIJOTE_DEMO=1), en tête de chaque page : discret (filet, texte courant), il dit que
// les changements s'effacent, propose de recommencer, et renvoie vers l'installation.
import { buttonClass } from "@/components/ui";
import { demoLimits, INSTALL_URL } from "@/lib/demo/core";
import { restartDemo } from "./actions";

export function DemoBanner() {
  const hours = Math.round(demoLimits().idleMs / 3_600_000);
  const idle = hours >= 1 ? `${hours} h` : `${Math.round(demoLimits().idleMs / 60_000)} min`;
  return (
    <div data-demo-banner className="border-b border-line bg-surface-2">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2 text-small text-ink-2 sm:px-10">
        {/* Au téléphone et à la tablette, le texte prend sa ligne et les deux boutons passent dessous, ensemble. */}
        <p className="min-w-0 flex-1 basis-[28rem]">
          <b className="text-ink">Démo</b> : tes changements s’effacent après {idle} sans visite. Pas d’IA ni de catalogue ici.
        </p>
        <div className="flex items-center gap-2">
          <form action={restartDemo}>
            <button type="submit" className={buttonClass({ variant: "quiet", size: "sm" })}>
              Recommencer
            </button>
          </form>
          <a href={INSTALL_URL} className={buttonClass({ variant: "secondary", size: "sm" })} target="_blank" rel="noopener">
            Installer Mijote
          </a>
        </div>
      </div>
    </div>
  );
}
