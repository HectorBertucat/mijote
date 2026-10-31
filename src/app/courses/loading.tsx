import { PageHead } from "@/components/cart/Carnet";
import { PageSkeleton, Skeleton, SkeletonLine, SkeletonRows } from "@/components/ui";

// Listes de courses en chargement : le vrai titre, les deux chiffres sous filet fort, puis les listes.
export default function Loading() {
  return (
    <PageSkeleton label="tes listes" className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:gap-18">
      <PageHead title="Courses" lead={<SkeletonLine text="text-lead" w="w-64" />} aside={<Skeleton className="h-tap w-44 rounded-[8px]" />}>
        <div className="rule-strong-top mt-6 grid grid-cols-2 gap-y-6 pt-6 sm:flex sm:gap-x-12">
          {[0, 1].map((i) => (
            <span key={i} className={`grid ${i ? "sm:border-l sm:border-line sm:pl-6" : ""}`}>
              <SkeletonLine text="text-h1" w="w-24" />
              <SkeletonLine text="text-small" w="w-32" className="mt-2" />
            </span>
          ))}
        </div>
      </PageHead>
      <SkeletonRows count={4} title="text-body" className="border-t border-line-strong" />
    </PageSkeleton>
  );
}
