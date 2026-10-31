import { PageSkeleton, SkeletonLine, SkeletonRows } from "@/components/ui";

// Une page de Santé en chargement : l’en-tête et les onglets de Santé restent affichés (layout), seul le contenu
// attend : les chiffres clés entre filets, puis une section à lignes.
export default function Loading() {
  return (
    <PageSkeleton label="la page" className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:gap-18">
      <section className="grid gap-8 lg:grid-cols-12 lg:gap-6">
        <div className="grid content-start gap-2 lg:col-span-5">
          <SkeletonLine text="label" w="w-32" />
          <SkeletonLine text="text-display" w="w-[5ch]" />
          <SkeletonLine text="text-small" w="w-48" />
        </div>
        <div className="grid grid-cols-2 gap-6 border-t border-line pt-6 lg:col-span-7 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          {[0, 1].map((i) => (
            <span key={i} className="grid content-start gap-2">
              <SkeletonLine text="label" w="w-24" />
              <SkeletonLine text="text-h1" w="w-[4ch]" />
              <SkeletonLine text="text-small" w="w-32" />
            </span>
          ))}
        </div>
      </section>
      <section className="grid gap-6">
        <SkeletonLine text="text-h2" w="w-48" />
        <SkeletonRows count={4} title="text-body" className="border-t border-line-strong" />
      </section>
    </PageSkeleton>
  );
}
