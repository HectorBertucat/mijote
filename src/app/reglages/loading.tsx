import { PageSkeleton, SkeletonLine, SkeletonRows } from "@/components/ui";

// Réglages en chargement : le vrai titre, la phrase, puis les sections à filet fort.
export default function Loading() {
  return (
    <PageSkeleton label="les réglages" className="grid gap-12 sm:gap-18">
      <header className="grid gap-4 lg:grid-cols-12 lg:gap-x-6">
        <h1 className="text-display lg:col-span-12">Réglages</h1>
        <span className="grid max-w-[48ch] lg:col-span-7">
          <SkeletonLine text="text-lead" w="w-full" />
          <SkeletonLine text="text-lead" w="w-1/2" />
        </span>
      </header>
      {[3, 4].map((n, i) => (
        <section key={i} className="grid gap-6">
          <SkeletonLine text="text-h2" w="w-44" />
          <SkeletonRows count={n} title="text-body" className="border-t border-line-strong" />
        </section>
      ))}
    </PageSkeleton>
  );
}
