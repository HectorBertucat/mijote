import { PageSkeleton, SkeletonLine, SkeletonRows } from "@/components/ui";

// Nos plats en chargement : le vrai titre, la phrase, puis une ligne par plat (boîte de 56 px, chiffre à droite).
export default function Loading() {
  return (
    <PageSkeleton label="nos plats" className="grid grid-cols-[minmax(0,1fr)] gap-12 md:gap-18">
      <header className="grid gap-6">
        <h1 className="text-h1">Nos plats</h1>
        <SkeletonLine text="text-lead" w="w-80" />
      </header>
      <SkeletonRows count={4} lead="size-14 rounded-[8px]" title="text-body" trail="h-10 w-10" className="border-t border-line lg:max-w-[66%]" />
    </PageSkeleton>
  );
}
