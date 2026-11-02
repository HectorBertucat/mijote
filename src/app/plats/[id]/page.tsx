// La fiche d’une portion (src/components/plats/PortionSheet.tsx) : pour la personne affichée (le profil de
// l’appareil, ou `?pour=`), les grammes de chaque groupe à se servir, la part de l’autre d’un geste.
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PortionSheet } from "@/components/plats/PortionSheet";
import { DishBox } from "@/components/ui/dish";
import { db } from "@/lib/db/client";
import { activeProfileId } from "@/lib/health/active";
import { listPeople, todayParis } from "@/lib/health/store";
import { listDishRecipes } from "@/lib/recipes/queries";
import { listDishes } from "@/lib/reserve/store";

export const dynamic = "force-dynamic";

export default async function Plat({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ pour?: string }> }) {
  const { id } = await params;
  const { pour } = await searchParams;
  const me = await activeProfileId();
  const people = listPeople(db);
  const who = people.find((p) => p.id === pour) ?? people.find((p) => p.id === me) ?? people[0];
  const now = new Date();
  const dish = who ? listDishes(db, who.id, now).find((d) => d.id === id && d.status === "cooked") : undefined;
  if (!dish || !who) notFound();
  const recipe = dish.recipeId ? listDishRecipes(db).get(dish.recipeId) : undefined;
  return (
    <>
      <AutoRefresh />
      <PortionSheet key={`${dish.id}:${who.id}`} dish={dish} who={who.id} me={me} today={todayParis(now)} art={recipe ? <DishBox recipe={recipe} size="sm" /> : undefined} />
    </>
  );
}
