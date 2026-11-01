import { PageSkeleton, Skeleton, SkeletonLine, SkeletonRows } from "@/components/ui";

// La page Course en chargement, calquée sur la vraie : la séance du jour (repère, type et durée en grand, profil,
// blocs à filets, la phrase) avec sa colonne à côté, puis la semaine en sept colonnes et une section à graphique.
export default function Loading() {
  return (
    <PageSkeleton label="la course" className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:gap-18">
      <section className="grid gap-12 lg:grid-cols-12 lg:gap-6">
        <div className="grid content-start gap-6 lg:col-span-7">
          <span className="grid gap-3">
            <SkeletonLine text="label" w="w-32" />
            <SkeletonLine text="text-h1" w="w-[11ch]" />
          </span>
          <span className="flex h-14 items-end gap-[2px]">
            <Skeleton className="h-[18%] flex-1" />
            <Skeleton className="h-[38%] flex-[6]" />
            <Skeleton className="h-[18%] flex-1" />
          </span>
          <SkeletonRows count={3} title="text-body" sub={false} trail="h-5 w-20" className="border-t border-line-strong" rowClassName="py-3" />
          <span className="grid max-w-[62ch] gap-1">
            <SkeletonLine text="text-lead" w="w-full" />
            <SkeletonLine text="text-lead" w="w-2/3" />
          </span>
        </div>
        <div className="grid content-start gap-3 border-t border-line pt-6 lg:col-span-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
          <SkeletonLine text="label" w="w-20" />
          <SkeletonRows count={3} title="text-body" className="border-t border-line" rowClassName="py-3" />
        </div>
      </section>
      <section className="grid gap-6 border-t border-line-strong pt-4">
        <SkeletonLine text="text-h2" w="w-48" />
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className="grid content-start gap-2 border-t-2 border-line pt-2">
              <SkeletonLine text="label" w="w-8" />
              <SkeletonLine text="text-h3" w="w-6" />
              <Skeleton className="h-9 w-full" />
            </span>
          ))}
        </div>
      </section>
      <section className="grid gap-6 border-t border-line-strong pt-4">
        <SkeletonLine text="text-h2" w="w-56" />
        <Skeleton className="h-48 w-full" />
      </section>
    </PageSkeleton>
  );
}
