// Montants et poids des courses : virgule décimale, espace insécable avant l'unité.
export const eur = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2).replace(".", ",")} €`);
export const grams = (g: number | null | undefined) => (g == null ? null : g >= 1000 ? `${(Math.round(g / 10) / 100).toLocaleString("fr-FR")} kg` : `${Math.round(g)} g`);
