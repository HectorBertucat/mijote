// Dessin du corps pour la carte des muscles : une silhouette de face et une de dos (repère 120 × 256,
// y vers le bas), et chaque muscle en tracé SVG. On ne dessine que la moitié gauche de l'image (x < 60) :
// le rendu la double en miroir autour de x = 60. Données pures (servent à l'interface et à l'API de l'app).
import type { Muscle } from "./muscles";

export const BODY_VIEWBOX = "0 0 120 256";
export const BODY_MIRROR = "translate(120 0) scale(-1 1)";

/** Silhouette : des segments arrondis (épaisseur en unités du repère) et des formes pleines. */
export const BODY_LIMBS: { a: [number, number]; b: [number, number]; w: number }[] = [
  { a: [36, 58], b: [28, 108], w: 15 }, // bras
  { a: [28, 110], b: [22, 158], w: 12 }, // avant-bras
  { a: [22, 160], b: [20, 174], w: 9 }, // main
  { a: [47, 150], b: [45, 204], w: 21 }, // cuisse
  { a: [45, 208], b: [46, 240], w: 14 }, // jambe
  { a: [46, 242], b: [44, 247], w: 10 }, // pied
];
export const BODY_SHAPES: string[] = [
  "M60 6 C51 6 47 13 47 22 C47 31 52 38 60 39 Z", // tête
  "M54 36 L60 36 L60 48 L53 48 Z", // cou
  // Buste : des épaules au bassin.
  "M60 46 L50 47 C40 48 32 51 30 60 C29 72 34 84 37 98 C38 110 37 122 36 136 C36 146 40 152 48 156 L60 158 Z",
];

/** Muscles vus de face. */
export const FRONT: Partial<Record<Muscle, string>> = {
  epaules: "M47 50 C38 50 31 54 30 63 C30 70 32 75 34 78 C36 69 41 62 48 58 Z",
  pectoraux: "M59 56 L48 58 C41 62 36 70 37 80 C44 87 52 87 59 84 Z",
  biceps: "M31 80 C28 90 28 100 30 108 L35 108 C37 100 38 90 36 80 Z",
  avantBras: "M27 113 C23 125 21 138 22 152 L26 152 C29 140 31 126 31 113 Z",
  abdos: "M59 88 L50 89 L49 108 L49 128 L59 134 Z",
  obliques: "M47 90 C41 98 39 112 40 128 L47 132 L47 90 Z",
  quadriceps: "M40 154 C37 170 38 188 42 201 L51 201 C54 188 54 170 52 156 Z",
  adducteurs: "M54 157 C56 168 57 178 57 188 L59 188 L59 158 Z",
  mollets: "M43 211 C41 222 42 233 44 241 L48 241 C49 232 50 222 49 211 Z",
};

/** Muscles vus de dos (même côté de l'image : la gauche, donc le côté gauche du corps). */
export const BACK: Partial<Record<Muscle, string>> = {
  trapezes: "M59 38 L52 44 C45 47 39 49 37 52 L59 74 Z",
  epaules: "M44 50 C37 51 31 55 30 63 C30 70 32 75 34 78 C37 69 41 61 46 56 Z",
  triceps: "M31 80 C28 90 28 100 30 108 L35 108 C37 100 38 90 36 80 Z",
  avantBras: "M27 113 C23 125 21 138 22 152 L26 152 C29 140 31 126 31 113 Z",
  dorsaux: "M58 76 L41 62 C36 72 37 88 40 104 C45 112 52 116 58 114 Z",
  lombaires: "M59 115 L51 117 L50 136 L59 139 Z",
  moyenFessier: "M48 134 C42 135 38 140 38 147 L48 141 Z",
  fessiers: "M59 140 C50 138 41 142 39 150 C38 160 44 166 52 166 C56 166 59 164 59 160 Z",
  ischios: "M41 170 C38 182 39 194 43 202 L52 202 C54 192 55 180 53 170 Z",
  mollets: "M43 210 C39 218 40 230 44 238 L49 238 C52 230 52 218 49 210 Z",
};
