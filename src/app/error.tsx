"use client";

import Link from "next/link";
import { Button, buttonClass } from "@/components/ui";
import { PageHead } from "@/components/cart/Carnet";

// Erreur inattendue d’une page : en français, dans la coque de l’appli, avec de quoi réessayer. Le détail reste
// dans le journal du serveur ; on montre seulement sa référence.
export default function Erreur({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12">
      <PageHead kicker="Erreur" title="Ça a accroché." lead="Cette page n’a pas pu s’afficher. Réessaie ; si ça recommence, le journal du serveur dit pourquoi.">
        {error.digest && <p className="text-small text-ink-2">Référence : <span className="num">{error.digest}</span></p>}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="primary" icon="refresh" onClick={reset}>
            Réessayer
          </Button>
          <Link href="/" className={buttonClass()}>
            Accueil
          </Link>
        </div>
      </PageHead>
    </div>
  );
}
