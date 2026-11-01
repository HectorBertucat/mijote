import Link from "next/link";
import { buttonClass, Icon } from "@/components/ui";
import { PageHead } from "@/components/cart/Carnet";

// Page introuvable (lien périmé, recette ou liste effacée) : en français, dans la coque de l’appli.
export default function NotFound() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12">
      <PageHead kicker="Erreur 404" title="Rien ici." lead="Cette page n’existe pas, ou plus : une recette ou une liste a peut-être été effacée.">
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/" className={buttonClass({ variant: "primary" })}>
            <Icon name="home" />
            Accueil
          </Link>
          <Link href="/recettes" className={buttonClass()}>
            Recettes
          </Link>
        </div>
      </PageHead>
    </div>
  );
}
