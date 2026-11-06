import { CreateApp } from "@/components/atelier/CreateApp";
import { DemoNotice } from "@/components/demo/DemoNotice";
import { EmptyState } from "@/components/ui";
import { aiEnabled, monthlyCapUsd, spentThisMonth } from "@/lib/ai";
import { estimateComposeUsd, estimateCreationUsd, estimateRefineUsd, kitchenOf, latestCreation, LIMITS } from "@/lib/creation";
import { db } from "@/lib/db/client";
import { demoEnabled } from "@/lib/demo/core";

export const dynamic = "force-dynamic";

export default async function Creer({ searchParams }: { searchParams: Promise<{ envie?: string }> }) {
  const { envie } = await searchParams;
  if (demoEnabled())
    return (
      <DemoNotice title="Créer une recette a besoin de l’IA">
        Chez toi, décris une envie : l’assistant cherche de vraies recettes publiées, cite ses sources et en tire deux ou trois recettes pour ton foyer, ta cuisine et vos objectifs. Le code recalcule chaque chiffre et vérifie tout avant que la recette entre dans ta bibliothèque. Pas d’IA dans la démo.
      </DemoNotice>
    );
  if (!aiEnabled())
    return (
      <EmptyState scene="pot" title="Créer une recette a besoin de l’IA">
        Ajoute une clé ANTHROPIC_API_KEY pour chercher des recettes publiées et en composer pour ton foyer. Le reste de l’Atelier et de l’appli marche sans.
      </EmptyState>
    );
  return (
    <CreateApp
      initial={latestCreation(db)}
      initialEnvie={envie?.slice(0, 400) ?? ""}
      kitchenReady={kitchenOf(db).some((e) => e.kind === "pan" || e.kind === "pot" || e.kind === "dish")}
      budget={{ spentUsd: spentThisMonth(db), capUsd: monthlyCapUsd() }}
      estimates={{ creation: estimateCreationUsd(), cached: estimateCreationUsd(true), more: estimateComposeUsd(1), refine: estimateRefineUsd() }}
      limits={{ searches: LIMITS.searches, fetches: LIMITS.fetches, first: LIMITS.first, max: LIMITS.max }}
    />
  );
}
