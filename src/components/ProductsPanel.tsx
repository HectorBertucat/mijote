// Section « Produits du drive » d'une fiche (serveur) : les /resolve des ingrédients (en cache 15 min) tournent
// pendant que le reste de la fiche s'affiche (Suspense), puis le tableau client prend le relais.
import { Suspense } from "react";
import { BlockTitle } from "@/components/fiche/Block";
import { ProductsBoard } from "@/components/ProductsBoard";
import { db } from "@/lib/db/client";
import { recipeProducts } from "@/lib/products/fiche";

async function Board({ recipeId, slug }: { recipeId: string; slug: string }) {
  try {
    const items = await recipeProducts(db, recipeId);
    return <ProductsBoard slug={slug} initial={items} />;
  } catch (e) {
    console.error("[produits] fiche :", e);
    return (
      <section aria-label="Produits du drive">
        <BlockTitle>Produits du drive</BlockTitle>
        <p className="text-body text-warn-ink">Le catalogue ne répond pas, les produits ne sont pas chargés. Réessaie dans un instant.</p>
      </section>
    );
  }
}

function Loading() {
  return (
    <section aria-label="Produits du drive" aria-busy>
      <BlockTitle aside="Recherche au catalogue…">Produits du drive</BlockTitle>
      <div className="grid gap-6 lg:grid-cols-2">
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="h-28 animate-pulse rounded-[8px] bg-surface-2" />
        ))}
      </div>
    </section>
  );
}

export function ProductsPanel({ recipeId, slug }: { recipeId: string; slug: string }) {
  return (
    <Suspense fallback={<Loading />}>
      <Board recipeId={recipeId} slug={slug} />
    </Suspense>
  );
}
