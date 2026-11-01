// Micro-typographie française pour l'affichage (docs/design/systeme.md § Ton) : apostrophe courbe, espaces
// insécables avant « ; : ? ! » et dans les guillemets, nombre collé à son unité. Pur et testé (tests/typo.test.ts).
// Pour l'affichage seulement : les textes en base (fiches, consignes) gardent leur forme, que d'autres modules lisent.

const NBSP = " "; // espace insécable (avant « : », dans « 8 min »)
const NNBSP = " "; // espace fine insécable (avant « ; ? ! », dans les guillemets)
const UNITS = "(?:kg|g|mg|cl|ml|dl|L|l|min|s|h|kcal|°C|°|€|%|cm|mm)";

export function typo(text: string): string;
export function typo(text: string | null | undefined): string | null | undefined;
export function typo(text: string | null | undefined) {
  if (!text) return text;
  return (
    text
      // l'eau, jusqu'à, d'Alex : apostrophe courbe entre deux lettres
      .replace(/(\p{L})'(?=\p{L})/gu, "$1’")
      // guillemets droits encadrant un mot : « … »
      .replace(/"([^"\n]+)"/g, `«${NNBSP}$1${NNBSP}»`)
      // espaces dans les guillemets français
      .replace(/«\s*/g, `«${NNBSP}`)
      .replace(/\s*»/g, `${NNBSP}»`)
      // ponctuation haute : fine insécable avant ; ? ! et insécable avant :
      .replace(/[   ]+([;?!])/g, `${NNBSP}$1`)
      .replace(/[   ]+:(?!\/)/g, `${NBSP}:`)
      // 8 min, 1,5 kg, 200 °C, 4,01 € : le nombre ne quitte pas son unité
      .replace(new RegExp(`(\\d) (?=${UNITS}(?![\\p{L}]))`, "gu"), `$1${NBSP}`)
  );
}

/**
 * « 1 novembre » → « 1er novembre » dans une date déjà formatée par `toLocaleDateString` (qui ne le fait pas) :
 * « dim. 1er nov. », « du 1er au 15 novembre ». Seul le chiffre 1 isolé change (pas 11, 21, 31).
 */
export function firstOfMonth(date: string): string {
  return date.replace(/(^|\s)1(?=\s|$)/g, "$11er");
}
