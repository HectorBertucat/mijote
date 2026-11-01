// Nom d'un article tel qu'on le cherche en rayon. Pur (importé côté client par la liste).

/**
 * La ligne de recette sans sa préparation : « Oignons, émincés » → « Oignons », « Œufs, battus dans la ricotta
 * (ça lie…) » → « Œufs ». Les parenthèses utiles à l'achat restent (« Merguez (6) », « (sans os ni peau) ») ;
 * une virgule entre parenthèses ne coupe pas.
 */
export function buyName(item: string): string {
  let depth = 0;
  for (let i = 0; i < item.length; i++) {
    const c = item[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0 && i > 0) return item.slice(0, i).trim();
  }
  return item.trim();
}
