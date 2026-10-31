"use client";

// Changement de page en fondu (transitions de vue de React, que Next déclenche à chaque navigation) : l’ancienne
// page s’efface, la nouvelle arrive (globals.css, .page-out et .page-in). Seulement quand le chemin change :
// une revalidation, un filtre (?tag=) ou une action ne font rien bouger. Sans prise en charge du navigateur,
// la page change simplement, comme avant.
// Pose aussi html[data-settled] une fois la page arrivée : les entrées de liste (.reveal) ne rejouent plus ensuite.
import { usePathname } from "next/navigation";
import { useLayoutEffect, ViewTransition } from "react";

const SETTLE_MS = 700; // plus long que la plus longue entrée (.reveal : 210 ms de décalage + 280 ms)
// Rubriques qui ont leur propre mise en page (en-tête, onglets) : elle reste en place entre ses sous-pages, qui
// changent en fondu dans une PageTransition `nested` (sinon l’en-tête, identique, clignoterait dans le fondu).
const OWN_LAYOUT = ["/sante"];

export function PageTransition({ children, nested = false }: { children: React.ReactNode; nested?: boolean }) {
  const path = usePathname();
  const key = nested ? path : (OWN_LAYOUT.find((s) => path === s || path.startsWith(`${s}/`)) ?? path);
  useLayoutEffect(() => {
    if (nested) return;
    const root = document.documentElement;
    root.removeAttribute("data-settled");
    const id = window.setTimeout(() => root.setAttribute("data-settled", ""), SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [path, nested]);
  return (
    <ViewTransition key={key} enter="page-in" exit="page-out" default="none">
      {children}
    </ViewTransition>
  );
}
