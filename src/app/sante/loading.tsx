import { PageSkeleton, Skeleton, SkeletonLine } from "@/components/ui";

// Une page de Santé en chargement : l’en-tête et les onglets de Santé restent affichés (layout), seul le contenu
// attend. Calqué sur la vue d’ensemble : la phrase de la semaine, les chiffres du jour entre filets, les tuiles
// de la semaine avec leur petite courbe, puis une section à graphique.
export default function Loading() {
  return (
    <PageSkeleton label="la page" className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:gap-18">
      <span className="grid max-w-[62ch] gap-1">
        <SkeletonLine text="text-lead" w="w-full" />
        <SkeletonLine text="text-lead" w="w-2/3" />
      </span>
      <section className="grid gap-8 lg:grid-cols-12 lg:gap-6">
        <div className="grid content-start gap-2 lg:col-span-5">
          <SkeletonLine text="label" w="w-32" />
          <SkeletonLine text="text-display" w="w-[5ch]" />
          <SkeletonLine text="text-small" w="w-48" />
        </div>
        <div className="grid grid-cols-2 gap-6 border-t border-line pt-6 lg:col-span-7 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          {[0, 1].map((i) => (
            <span key={i} className="grid content-start gap-2">
              <SkeletonLine text="label" w="w-24" />
              <SkeletonLine text="text-h1" w="w-[4ch]" />
              <SkeletonLine text="text-small" w="w-32" />
            </span>
          ))}
        </div>
      </section>
      <section className="grid gap-6 border-t border-line-strong pt-4">
        <SkeletonLine text="text-h2" w="w-56" />
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="grid content-start gap-2 border-t border-line pt-4">
              <SkeletonLine text="label" w="w-20" />
              <SkeletonLine text="text-h1" w="w-[5ch]" />
              <SkeletonLine text="text-small" w="w-32" />
              <Skeleton className="mt-1 h-8 w-full" />
            </span>
          ))}
        </div>
      </section>
      <section className="grid gap-6 border-t border-line-strong pt-4">
        <SkeletonLine text="text-h2" w="w-40" />
        <Skeleton className="h-40 w-full" />
      </section>
    </PageSkeleton>
  );
}
