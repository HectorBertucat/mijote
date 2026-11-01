// Options du panneau « Ajuster », calculées en code depuis la nutrition de la recette
// et le repère de la personne de référence (la première du foyer). Chaque option porte une
// consigne chiffrée pour l'IA.
import { SAMPLE_HOUSEHOLD, type Member } from "@/lib/eaters/core";
import { proteinShare, type Macros } from "@/lib/nutrition/compute";
import type { RecipeInput } from "@/lib/recipes/format";
import { norm, portions } from "./verify";
import { ofName } from "@/lib/session/people";

export interface AdjustOption {
  id: string;
  label: string;
  hint: string;
  instruction: string;
  recommended?: boolean;
}

const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
const round10 = (n: number) => Math.max(10, Math.round(n / 10) * 10);

/** Mots d'une préférence « n'aime pas » cherchés dans les ingrédients (« Brocoli » → brocoli). */
export function dislikeHits(text: string, dislikes: string[]): string[] {
  const hay = norm(text);
  return dislikes.filter((d) => {
    const key = norm(d.split(/[(:,]/)[0]).trim();
    return key.length >= 3 && hay.includes(key);
  });
}

export function adjustOptions(r: RecipeInput, household: Member[] = SAMPLE_HOUSEHOLD): AdjustOption[] {
  const list = household.length ? household : SAMPLE_HOUSEHOLD;
  const lead = list[0];
  const p = portions(r, list);
  const h: Macros = p.lead;
  const t = lead.ref;
  const who = `la part ${ofName(lead.name)} (${lead.units} unités)`;
  const now = `Aujourd'hui, ${who} fait ${h.kcal} kcal et ${Math.round(h.protein)} g de protéines (calcul en code).`;
  const out: AdjustOption[] = [];

  const over = !!t && h.kcal > t.kcalMax;
  const minus = over ? round10(h.kcal - (t!.kcalMin + t!.kcalMax) / 2) : 150;
  out.push({
    id: "moins-kcal",
    label: `−${minus} kcal`,
    hint: over ? `ta part est à ${h.kcal} kcal, la cible ${t!.kcalMin}-${t!.kcalMax}` : "plus léger, même goût",
    instruction: `${now} Baisse ${who} d'environ ${minus} kcal (vise ${h.kcal - minus} kcal) sans baisser les protéines. Retire d'abord le gras caché (huile, crème, fromage, viande grasse) et garde ce qui fait le goût : saisie, sucs, aromates, sauce.`,
    recommended: over,
  });

  const under = !!t && h.protein < t.proteinMin;
  const plus = under ? round5((t!.proteinMin + t!.proteinMax) / 2 - h.protein) : 15;
  out.push({
    id: "plus-proteines",
    label: `+${plus} g de protéines`,
    hint: under ? `ta part : ${Math.round(h.protein)} g, la cible ${t!.proteinMin}-${t!.proteinMax} g` : "plus rassasiant",
    instruction: `${now} Ajoute environ ${plus} g de protéines à ${who} (vise ${Math.round(h.protein + plus)} g) en gardant les kcal à peu près stables : plus de viande maigre, de légumineuses ou de produits laitiers riches en protéines, moins de féculents s'il le faut.`,
    recommended: under,
  });

  out.push({
    id: "prise-de-masse",
    label: "Prise de masse",
    hint: "+250 kcal, +20 g de protéines",
    instruction: `${now} Version prise de masse : environ +250 kcal et +20 g de protéines pour ${who}, avec plus de féculents et de protéines, toujours gourmand.`,
  });

  const share = proteinShare(h);
  const fatShare = h.kcal > 0 ? (h.fat * 9) / h.kcal : 0;
  const issues = [
    share < 0.25 && `protéines à ${Math.round(share * 100)} % des kcal`,
    fatShare > 0.4 && `lipides à ${Math.round(fatShare * 100)} % des kcal`,
    h.fiber < 8 && `${Math.round(h.fiber)} g de fibres`,
  ].filter(Boolean) as string[];
  if (issues.length)
    out.push({
      id: "equilibre",
      label: "Plus équilibré",
      hint: issues.join(", "),
      instruction: `${now} Rends la recette plus équilibrée (${issues.join(", ")}) : vise 30 % des kcal en protéines, moins de 35 % en lipides, au moins 10 g de fibres pour ${who}${t ? `, kcal dans ${t.kcalMin}-${t.kcalMax}` : ""}.`,
    });

  if (h.fiber < 12)
    out.push({
      id: "legumes",
      label: "Plus de légumes",
      hint: `${Math.round(h.fiber)} g de fibres par part`,
      instruction: `${now} Ajoute des légumes (au moins 150 g crus pour ${who}) qui vont avec le plat et se réchauffent bien, cuits pour avoir du goût (saisis, rôtis ou fondus), pas bouillis.`,
    });

  // Une version sans ce qu'une personne du foyer n'aime pas, si la recette en contient.
  const text = r.ingredients.map((i) => i.item).join(" ");
  for (const m of list) {
    const hits = dislikeHits(text, m.dislikes ?? []);
    if (!hits.length) continue;
    out.push({
      id: `sans-${m.id}`,
      label: `Sans ${hits.map((d) => d.toLowerCase()).join(", ")}`,
      hint: `pour ${m.name}`,
      instruction: `${now} ${m.name} n'aime pas : ${hits.join(", ")}. Remplace-les par quelque chose qui garde l'esprit du plat.`,
    });
  }

  return out;
}
