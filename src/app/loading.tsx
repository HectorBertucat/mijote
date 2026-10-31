"use client";

// Chargement de l’accueil, et squelette commun des pages qui n’ont pas le leur (placard, coûts, composer, atelier…) :
// ce fichier enveloppe toutes les rubriques, d’où le choix par le chemin.
import { usePathname } from "next/navigation";
import { PageSkeleton, Skeleton, SkeletonLine, SkeletonRows } from "@/components/ui";

export default function Loading() {
  return usePathname() === "/" ? <Home /> : <Page />;
}

// Accueil : la semaine en grand à gauche (titre sur deux lignes, phrase, action, plats), frigo et courses à droite.
function Home() {
  return (
    <PageSkeleton label="l’accueil" className="grid grid-cols-[minmax(0,1fr)] gap-y-12 lg:grid-cols-12 lg:gap-x-6 lg:gap-y-18">
      <section className="min-w-0 lg:col-span-7">
        <SkeletonLine text="label" w="w-40" />
        <span className="mt-4 grid">
          <SkeletonLine text="text-display" w="w-[7ch]" />
          <SkeletonLine text="text-display" w="w-[5ch]" />
        </span>
        <span className="mt-6 grid max-w-[38ch]">
          <SkeletonLine text="text-lead" w="w-full" />
          <SkeletonLine text="text-lead" w="w-1/2" />
        </span>
        <Skeleton className="mt-8 h-tap w-52 rounded-[8px]" />
        <SkeletonRows count={3} lead="size-11 rounded-[4px]" className="mt-18 border-t border-line-strong" />
      </section>
      <div className="grid min-w-0 content-start gap-12 lg:col-span-5 lg:border-l lg:border-line lg:pl-8">
        {[2, 1].map((n, i) => (
          <section key={i}>
            <div className="border-b border-line-strong pb-4">
              <SkeletonLine text="text-h2" w="w-28" />
            </div>
            <SkeletonRows count={n} lead={i === 0 ? "size-7 rounded-[4px]" : undefined} title="text-body" />
          </section>
        ))}
      </div>
    </PageSkeleton>
  );
}

// Une page : titre, phrase, une rangée de chiffres sous filet fort, puis des lignes.
function Page() {
  return (
    <PageSkeleton label="la page" className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:gap-18">
      <header className="grid gap-3">
        <SkeletonLine text="text-display" w="w-[6ch]" />
        <SkeletonLine text="text-lead" w="w-80" />
      </header>
      <SkeletonRows count={5} title="text-body" className="border-t border-line-strong" />
    </PageSkeleton>
  );
}
