// Inclinaison fixe d'un cachet ou d'un ruban, tirée d'une graine (pur, utilisable côté serveur).

/** Angle entre −9° et 9° (jamais presque droit), stable pour une même graine. */
export function stampAngle(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const u = ((h >>> 0) % 1000) / 1000; // 0..1
  const a = 3 + u * 6; // 3..9
  return (h & 1 ? 1 : -1) * Math.round(a * 10) / 10;
}
