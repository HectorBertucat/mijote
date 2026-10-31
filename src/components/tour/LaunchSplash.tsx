// Écran de lancement : le mot-symbole au centre du papier, la vapeur monte de la cocotte, puis fondu vers l’appli
// (660 ms en tout, sans jamais bloquer le toucher). Le script, lu avant le premier rendu, décide s’il s’affiche :
// une fois par lancement pour l’appli installée, une seule fois par appareil dans un navigateur, jamais avec
// prefers-reduced-motion. Sans script (ou ensuite), il reste caché : rien n’attend après lui. Composant serveur.
import { Wordmark } from "@/components/ui/wordmark";
import "./tour.css";

const LAUNCH_SCRIPT = `try{if(!matchMedia("(prefers-reduced-motion: reduce)").matches){var a=matchMedia("(display-mode: standalone)").matches||navigator.standalone===true,s=a?sessionStorage:localStorage;if(!s.getItem("mijote.launch")){s.setItem("mijote.launch","1");document.documentElement.setAttribute("data-launch","")}}}catch(e){}`;

export function LaunchSplash() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: LAUNCH_SCRIPT }} />
      <div className="k-launch" aria-hidden>
        <span className="k-launch-mark">
          <Wordmark />
        </span>
      </div>
    </>
  );
}
