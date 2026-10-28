// Petits formats d'affichage des écrans Semaine et Composer.
export const fmtG = (g: number) => (g >= 1000 ? `${(Math.round(g / 100) / 10).toLocaleString("fr-FR")} kg` : `${Math.round(g)} g`);
export const fmtMin = (m: number) => {
  const r = Math.round(m / 5) * 5;
  return r >= 60 ? `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, "0")}` : `${r} min`;
};
/** « de jambonneau », « d'emmental » */
export const deFood = (label: string) => (/^[aeiouyhâéèêîôœ]/i.test(label) ? `d’${label}` : `de ${label}`);
