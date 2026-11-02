import { PageSkeleton, SkeletonLine, SkeletonRows } from "@/components/ui";

// Le bilan du batch en chargement : le titre, la phrase, une ligne par plat.
export default function Loading() {
  return (
    <PageSkeleton label="le bilan du batch" className="grid grid-cols-[minmax(0,1fr)] gap-12 md:gap-18">
      <header className="grid gap-6">
        <SkeletonLine text="text-h1" w="w-80" />
        <SkeletonLine text="text-lead" w="w-96" />
      </header>
      <SkeletonRows count={3} lead="size-14 rounded-[8px]" title="text-body" trail="h-10 w-10" className="border-t border-line lg:max-w-[66%]" />
    </PageSkeleton>
  );
}
