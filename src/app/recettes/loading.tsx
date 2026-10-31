import { PageSkeleton, Skeleton, SkeletonLine } from "@/components/ui";

// Bibliothèque en chargement : le vrai titre, la rangée d’étiquettes à filets, puis les lignes (boîte de 56 px).
export default function Loading() {
  return (
    <PageSkeleton label="la bibliothèque" className="grid gap-12">
      <header className="grid gap-6 lg:grid-cols-12 lg:items-end">
        <div className="grid gap-4 lg:col-span-6">
          <h1 className="text-h1">Recettes</h1>
          <span className="grid max-w-[48ch]">
            <SkeletonLine text="text-lead" w="w-full" />
            <SkeletonLine text="text-lead" w="w-2/3" />
          </span>
        </div>
        <div className="flex items-center gap-2 lg:col-span-6 lg:justify-end">
          <Skeleton className="h-tap min-w-0 flex-1 rounded-[8px] lg:max-w-96" />
          <Skeleton className="h-tap w-tap rounded-[8px] sm:w-32" />
          <Skeleton className="h-tap w-tap rounded-[8px] sm:w-32" />
        </div>
      </header>
      <div className="grid gap-6">
        <div className="-mx-5 flex h-tap items-center gap-x-6 overflow-hidden border-y border-line px-5 sm:mx-0 sm:px-0">
          {["w-14", "w-20", "w-16", "w-24", "w-14", "w-20"].map((w, i) => (
            <SkeletonLine key={i} text="text-small" w={w} className="shrink-0" />
          ))}
        </div>
        <div>
          <div className="hidden border-b border-line-strong pb-3 sm:block">
            <SkeletonLine text="label" w="w-16" />
          </div>
          <ul aria-hidden>
            {["w-48", "w-36", "w-56", "w-40", "w-44", "w-32"].map((w, i) => (
              <li key={i} className="flex items-center gap-4 border-b border-line py-4 sm:gap-6">
                <Skeleton className="size-14 shrink-0 rounded-[8px]" />
                <span className="grid min-w-0 flex-1 gap-2">
                  <SkeletonLine text="text-h3" w={w} />
                  <span className="flex gap-1">
                    {[0, 1, 2].map((j) => (
                      <Skeleton key={j} className="size-7 rounded-full" />
                    ))}
                  </span>
                </span>
                <SkeletonLine text="text-h3" w="w-16" className="max-sm:hidden" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </PageSkeleton>
  );
}
