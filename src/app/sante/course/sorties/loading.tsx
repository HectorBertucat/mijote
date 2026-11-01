import { PageSkeleton, SkeletonLine, SkeletonRows } from "@/components/ui";

// Les sorties en chargement, calquées sur la vraie page : le retour, le titre et le compte, puis un mois à filet
// et ses lignes (jour, type, chiffres, barre des zones).
export default function Loading() {
  return (
    <PageSkeleton label="les sorties" className="grid grid-cols-[minmax(0,1fr)] gap-12">
      <header className="grid gap-3">
        <SkeletonLine text="text-small" w="w-20" />
        <SkeletonLine text="text-h1" w="w-[7ch]" />
        <SkeletonLine text="text-lead" w="w-48" />
      </header>
      <section className="grid gap-6 border-t border-line-strong pt-4">
        <span className="flex items-baseline justify-between gap-4">
          <SkeletonLine text="text-h3" w="w-40" />
          <SkeletonLine text="text-small" w="w-16" />
        </span>
        <SkeletonRows count={5} title="text-body" trail="h-1.5 w-28 sm:w-40" className="border-t border-line" rowClassName="py-3" />
      </section>
    </PageSkeleton>
  );
}
