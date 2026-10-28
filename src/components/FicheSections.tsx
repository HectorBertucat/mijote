"use client";

// Sections d'une fiche : sur téléphone et iPad, des onglets (Bols, Étapes, Nutrition, Notes) et une seule section
// visible ; sur ordinateur (lg), tout est affiché dans la grille. L'onglet suit l'ancre de l'URL (#etapes…),
// ce qui permet au panneau « Ajuster » d'ouvrir les bols quand la variante arrive.
import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Tabs } from "@/components/ui";

type Section = { id: string; label: string; count?: number };
const Ctx = createContext<string | null>(null);
const CountCtx = createContext<Dispatch<SetStateAction<Record<string, number | undefined>>> | null>(null);

/** Le compteur d'un onglet calculé côté client (ex. « Produits » : ingrédients encore à associer ; 0 l'efface). */
export function useSectionCount(id: string, n: number | undefined) {
  const set = useContext(CountCtx);
  useEffect(() => {
    set?.((c) => (c[id] === n ? c : { ...c, [id]: n }));
  }, [set, id, n]);
}

export function FicheSections({ sections, children }: { sections: Section[]; children: ReactNode }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const [counts, setCounts] = useState<Record<string, number | undefined>>({});
  useEffect(() => {
    const sync = () => {
      const h = location.hash.slice(1);
      if (sections.some((s) => s.id === h)) setActive(h);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [sections]);
  return (
    <CountCtx.Provider value={setCounts}>
    <Ctx.Provider value={active}>
      <div className="sticky top-[calc(49px+env(safe-area-inset-top))] z-10 -mx-4 bg-[color-mix(in_srgb,var(--c-bg)_94%,transparent)] px-4 backdrop-blur-md lg:hidden">
        <Tabs
          label="Sections de la fiche"
          value={active}
          onChange={(v) => {
            setActive(v);
            history.replaceState(null, "", `#${v}`);
          }}
          items={sections.map((s) => ({ value: s.id, label: s.label, count: (s.id in counts ? counts[s.id] || undefined : s.count) }))}
        />
      </div>
      {children}
    </Ctx.Provider>
    </CountCtx.Provider>
  );
}

/** Une section : toujours visible sur ordinateur, seulement quand son onglet est actif ailleurs. */
export function FicheSection({ id, className = "", children }: { id: string; className?: string; children: ReactNode }) {
  const active = useContext(Ctx);
  return (
    <div id={id} className={`min-w-0 scroll-mt-32 ${active === id ? "" : "max-lg:hidden"} ${className}`}>
      {children}
    </div>
  );
}
