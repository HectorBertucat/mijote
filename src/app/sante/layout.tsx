import Link from "next/link";
import { PageTransition } from "@/components/PageTransition";
import { SanteNav } from "@/components/sante/SanteNav";
import { Note } from "@/components/sante/carnet";
import { buttonClass } from "@/components/ui";
import { GOAL_LABEL } from "@/lib/health/core";
import { activePerson } from "@/lib/health/active";

export const dynamic = "force-dynamic";

export default async function SanteLayout({ children }: { children: React.ReactNode }) {
  const person = await activePerson();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <header className="grid gap-3">
        <p className="label text-ink-2">Santé · {person.goal ? GOAL_LABEL[person.goal] : "objectif à choisir"}</p>
        <h1 className="text-h1">{person.name}</h1>
      </header>
      <SanteNav />
      {!person.setupDoneAt && (
        <Note
          tone="warn"
          title={`${person.name}, ta mise en route n’est pas faite`}
          action={
            <Link href="/sante/demarrer" className={buttonClass({ size: "sm", variant: "primary" })}>
              Faire la mise en route
            </Link>
          }
        >
          Quelques chiffres, ton objectif et ce que tu manges hors batch : ta part de chaque recette suivra ta cible.
        </Note>
      )}
      <div className="pt-4">
        <PageTransition nested>{children}</PageTransition>
      </div>
    </div>
  );
}
