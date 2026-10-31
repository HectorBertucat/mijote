import { PageSkeleton, Skeleton, SkeletonLine, SkeletonRows } from "@/components/ui";

// Semaine en chargement : la période en grand, ses flèches, puis le choix (chiffres et plats retenus) à gauche
// et la bibliothèque en cartes à droite.
export default function Loading() {
  return (
    <PageSkeleton label="la semaine" className="grid grid-cols-[minmax(0,1fr)]">
      <header className="grid gap-6 lg:grid-cols-12 lg:items-end">
        <div className="min-w-0 lg:col-span-8">
          <span className="grid">
            <SkeletonLine text="text-display" w="w-[7ch]" />
            <SkeletonLine text="text-display" w="w-[9ch]" className="sm:hidden" />
          </span>
          <SkeletonLine text="text-lead" w="w-72" className="mt-4" />
          <SkeletonLine text="text-small" w="w-48" className="mt-2" />
        </div>
        <div className="flex items-center gap-2 lg:col-span-4 lg:justify-end">
          <Skeleton className="size-tap rounded-[8px]" />
          <Skeleton className="h-tap w-40 rounded-[8px]" />
          <Skeleton className="size-tap rounded-[8px]" />
        </div>
      </header>
      <div className="mt-12 grid gap-12 lg:mt-18 lg:grid-cols-12 lg:gap-6">
        <section className="hidden min-w-0 content-start gap-12 lg:col-span-4 lg:grid">
          <div className="grid grid-cols-3 gap-x-4">
            {[0, 1, 2].map((i) => (
              <span key={i} className="grid gap-1 border-t border-line-strong pt-3 pb-1">
                <SkeletonLine text="text-h1 lg:text-num-xl" w="w-[2ch]" />
                <SkeletonLine text="text-small" w="w-16" />
              </span>
            ))}
          </div>
          <div className="grid gap-6">
            <SkeletonLine text="text-h2" w="w-40" />
            <SkeletonRows count={3} title="text-body" className="border-t border-line" />
          </div>
        </section>
        <section className="grid min-w-0 content-start gap-6 lg:col-span-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <SkeletonLine text="text-h2" w="w-48" />
            <SkeletonLine text="text-small" w="w-40" />
          </div>
          <div className="flex gap-2 overflow-hidden">
            {["w-16", "w-24", "w-20", "w-24", "w-16"].map((w, i) => (
              <Skeleton key={i} className={`h-9 shrink-0 rounded-full ${w}`} />
            ))}
          </div>
          <ul aria-hidden className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex items-center gap-4 rounded-[14px] border border-line p-4 sm:flex-col sm:items-stretch sm:gap-0 sm:p-0">
                <Skeleton className="h-24 w-32 shrink-0 rounded-[14px] sm:h-32 sm:w-full sm:rounded-none" />
                <span className="grid min-w-0 flex-1 gap-1 sm:p-4">
                  <SkeletonLine text="text-h3" w="w-40" />
                  <SkeletonLine text="text-small" w="w-28" />
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PageSkeleton>
  );
}
