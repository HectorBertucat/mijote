// Onglet « Produits du drive » (serveur) : les /resolve des ingrédients (en cache 15 min) tournent
// pendant que le reste de la fiche s'affiche (Suspense), puis le tableau client prend le relais.
import { Suspense } from "react";
import { Alert, Card } from "@/components/ui";
import { CardTitle } from "@/components/RecipeParts";
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
      <Card as="section" pad="md" className="grid gap-3">
        <CardTitle>Produits du drive</CardTitle>
        <Alert tone="warn">Le catalogue ne répond pas : les produits ne sont pas chargés. Réessaie dans un instant.</Alert>
      </Card>
    );
  }
}

function Loading() {
  return (
    <Card as="section" pad="md" className="grid gap-3" aria-busy>
      <CardTitle>Produits du drive</CardTitle>
      <p className="text-[14px] text-ink-2">Recherche des produits au catalogue…</p>
      <div className="grid gap-3 lg:grid-cols-2">
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="h-[120px] animate-pulse rounded-[12px] bg-surface-2" />
        ))}
      </div>
    </Card>
  );
}

export function ProductsPanel({ recipeId, slug }: { recipeId: string; slug: string }) {
  return (
    <Suspense fallback={<Loading />}>
      <Board recipeId={recipeId} slug={slug} />
    </Suspense>
  );
}
