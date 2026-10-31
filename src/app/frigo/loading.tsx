import { PageSkeleton, SkeletonLine, SkeletonRows } from "@/components/ui";

// Frigo en chargement : le vrai titre, la phrase, puis frigo et congélo côte à côte (boîtes de 56 px).
export default function Loading() {
  return (
    <PageSkeleton label="le frigo" className="grid grid-cols-[minmax(0,1fr)] gap-12 md:gap-18">
      <header className="grid gap-4">
        <h1 className="text-h1">Frigo</h1>
        <SkeletonLine text="text-lead" w="w-80" />
      </header>
      <div className="grid items-start gap-12 lg:grid-cols-12 lg:gap-6">
        {[4, 2].map((n, i) => (
          <section key={i} className={`grid gap-6 ${i === 0 ? "lg:col-span-7" : "lg:col-span-5"}`}>
            <SkeletonLine text="text-h2" w="w-32" />
            <SkeletonRows count={n} lead="size-14 rounded-[8px]" title="text-body" trail="h-4 w-16" className="border-t border-line" />
          </section>
        ))}
      </div>
    </PageSkeleton>
  );
}
