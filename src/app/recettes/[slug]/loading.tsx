import Link from "next/link";
import { Icon, PageSkeleton, Skeleton, SkeletonLine, SkeletonRows } from "@/components/ui";

// Fiche en chargement : le retour (déjà utilisable), la nappe du plat à sa taille, le titre, les trois chiffres de
// tête entre filets, puis ingrédients et étapes.
export default function Loading() {
  return (
    <PageSkeleton label="la recette" className="grid grid-cols-1">
      <header className="grid gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/recettes" className="label -ml-2 inline-flex min-h-tap items-center gap-1 rounded-[8px] px-2 text-ink-2 hover:bg-surface-2 hover:text-ink">
            <Icon name="chev" size="s" className="rotate-180" />
            Recettes
          </Link>
          <div className="hidden shrink-0 gap-2 sm:flex">
            <Skeleton className="h-tap w-32 rounded-[8px]" />
            <Skeleton className="h-tap w-36 rounded-[8px]" />
          </div>
        </div>
        <Skeleton className="-mx-5 h-48 !rounded-none sm:hidden" />
        <Skeleton className="h-[clamp(200px,34vw,360px)] w-full !rounded-none max-sm:hidden" />
        <div className="grid gap-4">
          <span className="grid max-w-[20ch]">
            <SkeletonLine text="text-h1" w="w-full" />
            <SkeletonLine text="text-h1" w="w-1/2" />
          </span>
          <span className="grid max-w-[60ch]">
            <SkeletonLine text="text-lead" w="w-full" />
            <SkeletonLine text="text-lead" w="w-3/4" />
          </span>
        </div>
        <div className="grid gap-4">
          <div className="grid grid-cols-3 border-y border-line">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`grid content-start gap-2 py-4 sm:py-6 ${i > 0 ? "border-l border-line pl-3 sm:pl-6" : "pr-3 sm:pr-6"}`}>
                <SkeletonLine text="text-h1 sm:text-num-xl" w="w-[2.5ch]" />
                <SkeletonLine text="label" w="w-16" />
              </div>
            ))}
          </div>
          <SkeletonLine text="text-small" w="w-64" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:hidden">
          <Skeleton className="h-tap rounded-[8px]" />
          <Skeleton className="h-tap rounded-[8px]" />
        </div>
      </header>
      <div className="mt-12 grid items-start gap-x-6 gap-y-12 lg:mt-18 lg:grid-cols-12">
        <section className="grid gap-4 lg:col-span-5">
          <SkeletonLine text="text-h2" w="w-40" />
          <SkeletonRows count={7} title="text-body" sub={false} trail="h-4 w-14" rowClassName="py-3" className="border-t border-line-strong" />
        </section>
        <section className="grid gap-4 max-lg:hidden lg:col-span-7">
          <SkeletonLine text="text-h2" w="w-32" />
          <SkeletonRows count={4} lead="size-16 rounded-[8px]" title="text-body" className="border-t border-line-strong" rowClassName="items-start py-6" />
        </section>
      </div>
    </PageSkeleton>
  );
}
