import { PageSkeleton, Skeleton, SkeletonLine } from "@/components/ui";

// Session en chargement : la colonne de la vue simple (titre, étape en grand, gros bouton au pouce).
export default function Loading() {
  return (
    <PageSkeleton label="la session" className="mx-auto grid w-full max-w-[640px] gap-8 md:-mt-4">
      <div className="grid gap-1 py-3">
        <SkeletonLine text="text-body" w="w-48" />
        <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
      </div>
      <div className="grid gap-4">
        <SkeletonLine text="label" w="w-24" />
        <span className="grid">
          <SkeletonLine text="text-step" w="w-full" />
          <SkeletonLine text="text-step" w="w-2/3" />
        </span>
        <SkeletonLine text="text-lead" w="w-64" />
      </div>
      <Skeleton className="h-[72px] w-full rounded-[8px]" />
    </PageSkeleton>
  );
}
