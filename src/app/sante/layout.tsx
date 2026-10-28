import { SanteNav } from "@/components/sante/SanteNav";
import { GOAL_LABEL } from "@/lib/health/core";
import { activePerson } from "@/lib/health/active";
import { Alert } from "@/components/ui";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SanteLayout({ children }: { children: React.ReactNode }) {
  const person = await activePerson();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div>
        <h1 className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[36px] sm:leading-none">Santé · {person.name}</h1>
        <p className="mt-1.5 text-ink-2">{person.goal ? GOAL_LABEL[person.goal] : "Objectif à choisir"} · le profil se change en haut de l'écran.</p>
      </div>
      <SanteNav />
      {!person.setupDoneAt && (
        <Alert tone="warn" title={`${person.name}, ta mise en route n'est pas faite`}>
          Quelques chiffres, ton objectif et ce que tu manges hors batch : ta part de chaque recette suivra ta cible.{" "}
          <Link href="/sante/demarrer" className="font-semibold underline">
            Faire la mise en route
          </Link>
        </Alert>
      )}
      {children}
    </div>
  );
}
