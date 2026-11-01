import { PageSkeleton, Skeleton, SkeletonLine } from "@/components/ui";

// Les réglages de la course en chargement : le retour, le titre et sa phrase, puis les sections à filet du
// formulaire (le module, les jours en deux colonnes, l'objectif).
export default function Loading() {
  return (
    <PageSkeleton label="les réglages" className="grid max-w-[720px] gap-12">
      <header className="grid gap-3">
        <SkeletonLine text="text-small" w="w-20" />
        <SkeletonLine text="text-h1" w="w-[12ch]" />
        <SkeletonLine text="text-lead" w="w-full" />
      </header>
      <section className="grid gap-4 border-t border-line-strong pt-4">
        <SkeletonLine text="text-h3" w="w-32" />
        <SkeletonLine text="text-body" w="w-56" />
      </section>
      <section className="grid gap-2 border-t border-line-strong pt-4">
        <SkeletonLine text="text-h3" w="w-40" />
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className="grid grid-cols-2 gap-3">
            <Skeleton className="h-tap w-full" />
            <Skeleton className="h-tap w-full" />
          </span>
        ))}
      </section>
      <section className="grid gap-2 border-t border-line-strong pt-4">
        <SkeletonLine text="text-h3" w="w-28" />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </section>
    </PageSkeleton>
  );
}
