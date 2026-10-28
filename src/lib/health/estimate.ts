// Estimation d'un repas pris hors de l'appli (resto, apéro) à partir d'une phrase. Haiku, sortie
// structurée ; l'entrée est marquée « estimation » (source = ai) dans le journal.
import { z } from "zod";
import type { Db } from "@/lib/db/open";
import { MODELS, structured } from "@/lib/ai";

export const MealEstimate = z.object({
  label: z.string().describe("Nom court du repas, en français, 2 à 6 mots"),
  kcal: z.number().describe("Calories totales estimées"),
  proteinG: z.number().describe("Protéines en grammes"),
  carbsG: z.number().describe("Glucides en grammes"),
  fatG: z.number().describe("Lipides en grammes"),
  note: z.string().describe("Une phrase : les hypothèses de portion retenues"),
});
export type MealEstimate = z.infer<typeof MealEstimate>;

const SYSTEM = `Tu estimes les apports d'un repas décrit en une phrase par un adulte en France.
Raisonne en portions réalistes de restaurant ou de maison françaises (pas américaines), compte l'huile, le beurre, les sauces et les boissons sucrées ou alcoolisées mentionnées.
Si la quantité n'est pas dite, prends une portion standard et dis-le dans la note. Ne refuse jamais : donne ta meilleure estimation.`;

export async function estimateMeal(db: Db, text: string, personName: string): Promise<MealEstimate> {
  return structured({
    db,
    screen: "sante-estimation",
    model: MODELS.small,
    system: SYSTEM,
    prompt: `Repas de ${personName} : ${text.trim().slice(0, 400)}`,
    schema: MealEstimate,
    maxTokens: 1000,
    devMock: () => ({ label: text.trim().slice(0, 40), kcal: 850, proteinG: 35, carbsG: 80, fatG: 40, note: "Estimation simulée (dev)." }),
  });
}
