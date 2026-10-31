// Squelettes des pages en chargement (loading.tsx de chaque rubrique) : la mise en page réelle (mêmes filets,
// mêmes hauteurs de ligne) avec des aplats à la place du texte, pour que rien ne saute quand le contenu arrive.
// Les hauteurs viennent des classes de texte (`text-h1`, `text-lead`…) : un aplat posé dans une ligne de texte
// prend exactement la hauteur de cette ligne. Pulsation lente d’opacité, coupée en mouvement réduit (globals.css).
import { ViewTransition, type ReactNode } from "react";

/** Un aplat. `className` donne la taille (`h-4 w-24`, `size-14`…). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`skeleton block ${className}`} />;
}

/**
 * Une ligne de texte à venir : la hauteur de ligne de `text` (`text-h1`, `text-lead`, `text-small`, `label`…),
 * un aplat de la hauteur des lettres et de largeur `w` (`w-40`, `w-[12ch]`…).
 */
export function SkeletonLine({ text = "text-body", w = "w-40", className = "" }: { text?: string; w?: string; className?: string }) {
  return (
    <span aria-hidden className={`block min-w-0 overflow-hidden ${text} ${className}`}>
      <span className={`skeleton inline-block h-[0.72em] max-w-full align-middle ${w}`} />
      {"\u200b" /* espace sans largeur : la ligne garde sa hauteur */}
    </span>
  );
}

/**
 * Lignes d’une liste à filets (comme la bibliothèque, le frigo, les courses) : `lead` à gauche (taille de la vignette,
 * `size-14` pour une boîte, `size-7` pour une tuile, rien sinon), deux lignes de texte, `trail` à droite.
 */
export function SkeletonRows({ count = 5, lead, title = "text-h3", sub = true, trail, className = "", rowClassName = "py-4" }: { count?: number; lead?: string; title?: string; sub?: boolean; trail?: string; className?: string; rowClassName?: string }) {
  const widths = ["w-48", "w-36", "w-56", "w-40", "w-44", "w-32", "w-52", "w-40"];
  return (
    <ul aria-hidden className={className}>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={`flex items-center gap-4 border-b border-line ${rowClassName}`}>
          {lead && <Skeleton className={`shrink-0 ${lead}`} />}
          <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1">
            <SkeletonLine text={title} w={widths[i % widths.length]} />
            {sub && <SkeletonLine text="text-small" w="w-28" />}
          </span>
          {trail && <Skeleton className={`shrink-0 ${trail}`} />}
        </li>
      ))}
    </ul>
  );
}

/**
 * Enveloppe d’une page en chargement : annoncée aux lecteurs d’écran (« Chargement de … »), marquée `aria-busy`,
 * et qui s’efface en fondu quand le contenu prend sa place (transition de vue « skeleton-out », globals.css).
 */
export function PageSkeleton({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <ViewTransition exit="skeleton-out" default="none">
      <div role="status" aria-busy="true" aria-live="polite" className={className}>
        <span className="sr-only">Chargement de {label}…</span>
        {children}
      </div>
    </ViewTransition>
  );
}
