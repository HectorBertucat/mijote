import { PageSkeleton, Skeleton, SkeletonLine } from "@/components/ui";

// Une sortie en chargement : le titre et le verdict, les chiffres clés entre filets, la courbe de FC.
export default function Loading() {
  return (
    <PageSkeleton label="la sortie" className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:gap-18">
      <header className="grid gap-4">
        <SkeletonLine text="text-small" w="w-20" />
        <SkeletonLine text="label" w="w-48" />
        <SkeletonLine text="text-h1" w="w-[10ch]" />
        <SkeletonLine text="text-lead" w="w-72" />
      </header>
      <section className="grid grid-cols-2 gap-x-6 gap-y-8 border-t border-line-strong pt-6 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="grid content-start gap-3">
            <SkeletonLine text="label" w="w-20" />
            <SkeletonLine text="text-h1" w="w-[4ch]" />
          </span>
        ))}
      </section>
      <section className="grid gap-6 border-t border-line-strong pt-4">
        <SkeletonLine text="text-h2" w="w-64" />
        <Skeleton className="h-60 w-full" />
      </section>
    </PageSkeleton>
  );
}
