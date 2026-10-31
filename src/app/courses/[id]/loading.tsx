import { BackLink, PageHead } from "@/components/cart/Carnet";
import { PageSkeleton, SkeletonLine, SkeletonRows } from "@/components/ui";

// Une liste en chargement : retour vers les listes (déjà utilisable), titre, chiffres, puis les rayons.
export default function Loading() {
  return (
    <PageSkeleton label="la liste" className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:gap-18">
      <PageHead
        back={<BackLink href="/courses">Listes</BackLink>}
        kicker={<SkeletonLine text="label" w="w-28" />}
        title={<SkeletonLine text="text-display" w="w-[9ch]" />}
        aside={
          <span className="grid">
            <SkeletonLine text="text-num-xl" w="w-32" />
            <SkeletonLine text="text-small" w="w-24" className="mt-2" />
          </span>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-12 lg:gap-x-6">
        <div className="grid min-w-0 content-start gap-10 lg:col-span-8">
          {[5, 4].map((n, i) => (
            <section key={i} className="grid gap-1">
              <div className="flex min-h-tap items-end border-b border-line-strong pb-3">
                <SkeletonLine text="label" w="w-24" />
              </div>
              <SkeletonRows count={n} lead="size-6 rounded-[6px]" title="text-body" sub={i === 0} trail="h-4 w-12" rowClassName="py-3" />
            </section>
          ))}
        </div>
      </div>
    </PageSkeleton>
  );
}
