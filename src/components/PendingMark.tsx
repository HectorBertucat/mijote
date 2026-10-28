"use client";

// À placer dans un <Link> : un petit rond qui tourne pendant que la page suivante se charge.
import { useLinkStatus } from "next/link";

export function PendingMark({ idle }: { idle?: React.ReactNode }) {
  const { pending } = useLinkStatus();
  if (pending) return <span aria-hidden className="inline-block size-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />;
  return <>{idle}</>;
}
