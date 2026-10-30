// Banque d'illustrations animées (gestes de cuisine et aliments), en SVG 64 × 64.
// Chaque dessin est un fragment SVG : <Illu> (src/components/illus/Illu.tsx) l'enveloppe dans
// <svg viewBox="0 0 64 64">, avec le trait commun (couleur --i-line). Les couleurs viennent des
// jetons --i-* de src/app/cuisine-tokens.css, jamais de valeurs en dur. Les classes a-* animent
// (src/components/illus/illus.css), seulement quand l'illustration est « vivante » : le dessin
// au repos doit donc se suffire à lui-même.
//
// Ajouter un dessin : une entrée dans ACTIONS ou FOODS (id en snake_case, catégorie, libellé), puis
// pnpm illus:coverage pour vérifier ce qui tombe encore sur un dessin générique. Voir docs/illustrations.md.

export const FOOD_CATEGORIES = [
  "viande",
  "volaille",
  "poisson",
  "oeuf",
  "feculent",
  "legume",
  "fruit",
  "aromate",
  "herbe",
  "laitier",
  "gras",
  "epice",
  "condiment",
  "sucre",
  "liquide",
  "conserve",
  "ingredient",
] as const;
export type FoodCategory = (typeof FOOD_CATEGORIES)[number];

export interface Art {
  label: string;
  svg: string;
}
export interface FoodArt extends Art {
  category: FoodCategory;
}

const v = (name: string) => `var(--i-${name})`;
const N = 'stroke="none"';

// ─── Pièces communes ───

/** Poêle 28 cm vue de trois quarts, sur la plaque à induction. `inside` se dessine dans la poêle. */
const pan = (inside = "", ring = true) => `
  ${ring ? `<path d="M6 57 H58" fill="none" stroke-width="2"/><ellipse class="a-glow" cx="28" cy="57" rx="17" ry="2" fill="none" stroke="${v("flame")}" stroke-width="2.4"/>` : ""}
  <path d="M49 38.5 L61 34.5 Q63.6 33.8 63.8 35.6 Q64 37.2 62 37.9 L50.5 42 Z" fill="${v("steel")}"/>
  <path d="M5 38 L9.4 48.6 Q10.8 52 14.6 52 H41.4 Q45.2 52 46.6 48.6 L51 38 Z" fill="${v("steel")}"/>
  <path d="M10 46.5 Q28 50 46 46.5" fill="none" stroke="${v("steel-2")}" stroke-width="1.6"/>
  <ellipse cx="28" cy="38" rx="23" ry="7" fill="${v("steel-2")}"/>
  ${inside}`;

/** Cocotte en fonte avec son couvercle (animé à part). */
const cocotte = (lidClass = "a-lid") => `
  <path d="M4 57 H60" fill="none" stroke-width="2"/><ellipse class="a-glow" cx="32" cy="57" rx="20" ry="2" fill="none" stroke="${v("flame")}" stroke-width="2.4"/>
  <rect x="3" y="33" width="8" height="5" rx="2.5" fill="${v("iron")}"/>
  <rect x="53" y="33" width="8" height="5" rx="2.5" fill="${v("iron")}"/>
  <path d="M8 30 H56 V45 Q56 53 48 53 H16 Q8 53 8 45 Z" fill="${v("iron")}"/>
  <path d="M12 40 Q32 44 52 40" fill="none" stroke="${v("iron-2")}" stroke-width="1.6"/>
  <g class="${lidClass}" style="transform-origin:50% 100%">
    <path d="M6 30 Q32 14 58 30 Z" fill="${v("iron-2")}"/>
    <rect x="28" y="17" width="8" height="5" rx="2" fill="${v("iron")}"/>
  </g>`;

/** Faitout en inox ; `water` dessine la surface de l'eau. */
const pot = (inside = "") => `
  <path d="M4 57 H60" fill="none" stroke-width="2"/><ellipse class="a-glow" cx="32" cy="57" rx="19" ry="2" fill="none" stroke="${v("flame")}" stroke-width="2.4"/>
  <path d="M8 29 H4 M56 29 H60" fill="none" stroke-width="3.2"/>
  <path d="M10 25 H54 V46 Q54 53 47 53 H17 Q10 53 10 46 Z" fill="${v("steel")}"/>
  <ellipse cx="32" cy="25" rx="22" ry="5" fill="${v("water")}"/>
  ${inside}`;

const steam = (xs: number[], y = 22, h = 12) =>
  xs
    .map(
      (x, i) =>
        `<path class="a-steam" style="--d:${(i * 0.55).toFixed(2)}s" d="M${x} ${y} q-3 -${h / 4} 0 -${h / 2} t0 -${h / 2}" fill="none" stroke="${v("steam")}" stroke-width="2.6"/>`,
    )
    .join("");

const bowl = (inside = "", color = "plate") => `
  ${inside}
  <path d="M7 34 H57 Q55 54 32 54 Q9 54 7 34 Z" fill="${v(color)}"/>
  <path d="M24 54 H40" fill="none" stroke-width="2.6"/>`;

const board = (inside = "") => `
  <rect x="3" y="44" width="52" height="10" rx="3" fill="${v("wood")}"/>
  <path d="M55 47 H61" fill="none" stroke-width="3"/>
  <path d="M8 49 H34" fill="none" stroke="${v("wood-2")}" stroke-width="1.4"/>
  ${inside}`;

/** Flacon (sauce, huile, vin) : couleur du liquide, bouchon, étiquette. */
const bottle = (liquid: string, cap: string, tall = false, label = "label") => {
  const top = tall ? 6 : 14;
  return `
  <rect x="27" y="${top}" width="10" height="${tall ? 8 : 6}" rx="1.5" fill="${v(cap)}"/>
  <path d="M28.5 ${top + (tall ? 8 : 6)} V${tall ? 22 : 24} Q20 ${tall ? 26 : 28} 20 ${tall ? 33 : 35} V53 Q20 57 24 57 H40 Q44 57 44 53 V${tall ? 33 : 35} Q44 ${tall ? 26 : 28} 35.5 ${tall ? 22 : 24} V${top + (tall ? 8 : 6)} Z" fill="${v(liquid)}"/>
  <rect x="20" y="38" width="24" height="11" fill="${v(label)}"/>
  <path class="a-shine" d="M24 ${tall ? 31 : 33} V36" fill="none" stroke="${v("shine")}" stroke-width="2.4"/>`;
};

/** Pot ou bocal à couvercle (moutarde, épices, miel, ricotta). */
const jar = (fill: string, lid: string, wide = false, label = "label") => {
  const x = wide ? 12 : 18;
  const w = wide ? 40 : 28;
  return `
  <rect x="${x - 1}" y="16" width="${w + 2}" height="8" rx="2.5" fill="${v(lid)}"/>
  <path d="M${x} 24 H${x + w} V52 Q${x + w} 57 ${x + w - 5} 57 H${x + 5} Q${x} 57 ${x} 52 Z" fill="${v(fill)}"/>
  <rect x="${x}" y="33" width="${w}" height="13" fill="${v(label)}"/>
  <path class="a-shine" d="M${x + 4} 27 V30" fill="none" stroke="${v("shine")}" stroke-width="2.4"/>`;
};

const can = (fill: string, label: string) => `
  <ellipse cx="32" cy="16" rx="15" ry="4" fill="${v("steel")}"/>
  <path d="M17 16 V50 Q17 55 32 55 Q47 55 47 50 V16 Q47 20 32 20 Q17 20 17 16 Z" fill="${v("steel")}"/>
  <path d="M17 24 Q32 28 47 24 V44 Q32 48 17 44 Z" fill="${v(label)}"/>
  ${fill}`;

/** Brin d'herbe : tige + feuilles qui se balancent. */
const sprig = (leaf: string, leaves: [number, number, number][]) => `
  <g class="a-sway" style="transform-origin:50% 100%">
    <path d="M32 58 Q30 36 34 10" fill="none" stroke="${v("leaf-2")}" stroke-width="2.4"/>
    ${leaves.map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="5.5" ry="3" transform="rotate(${r} ${x} ${y})" fill="${v(leaf)}"/>`).join("")}
  </g>`;

// ─── Gestes (étapes et sous-étapes) ───

export const ACTIONS = {
  preheat: {
    label: "Préchauffer la poêle",
    svg: pan(`
      <circle class="a-bead" cx="22" cy="38" r="2.6" fill="${v("water")}"/>
      <circle class="a-bead" style="--d:.35s" cx="33" cy="39" r="1.8" fill="${v("water")}"/>
      ${[16, 28, 40].map((x, i) => `<path class="a-shimmer" style="--d:${i * 0.4}s" d="M${x} 28 q3 -4 0 -8 t0 -8 t0 -8" fill="none" stroke="${v("flame")}" stroke-width="2.2"/>`).join("")}`),
  },
  sear: {
    label: "Saisir",
    svg: pan(`
      <path class="a-flip" d="M12 39 Q12 33 17 33 H24 Q28 33 28 37 V40 Q20 42 12 39 Z" fill="${v("seared")}"/>
      <path d="M29 38 Q29 32 34 32 H40 Q44 32 44 36 V39 Q36 41.5 29 38 Z" fill="${v("seared")}"/>
      <path d="M15 36 H23 M32 35 H40" fill="none" stroke="${v("crust")}" stroke-width="1.8"/>
      ${[
        [14, 27, 0],
        [26, 24, 0.3],
        [38, 26, 0.6],
        [46, 29, 0.15],
      ]
        .map(([x, y, d]) => `<circle class="a-pop" style="--d:${d}s" cx="${x}" cy="${y}" r="1.6" fill="${v("oil")}" ${N}/>`)
        .join("")}
      ${steam([20, 34], 22, 12)}`),
  },
  stir: {
    label: "Faire revenir",
    svg: pan(`
      ${[
        [14, 37],
        [19, 40],
        [25, 36],
        [31, 40],
        [37, 37],
        [42, 39],
      ]
        .map(([x, y], i) => `<rect x="${x}" y="${y}" width="4" height="3" rx="1" fill="${v(i % 2 ? "onion" : "onion-2")}" stroke-width="1.4"/>`)
        .join("")}
      <g class="a-stir" style="transform-origin:100% 0%">
        <path d="M44 6 L32 30" fill="none" stroke="${v("wood-2")}" stroke-width="3.4"/>
        <path d="M29 28 L37 32 L33 40 L25 36 Z" fill="${v("wood")}"/>
      </g>`),
  },
  deglaze: {
    label: "Déglacer",
    svg: pan(`
      <path d="M14 38 Q28 42 42 38" fill="none" stroke="${v("crust")}" stroke-width="2"/>
      <path class="a-pour" style="transform-origin:50% 0%" d="M40 15 Q36 24 34 36" fill="none" stroke="${v("water")}" stroke-width="3"/>
      <g transform="rotate(-35 46 12)"><path d="M38 4 H54 L52 20 H40 Z" fill="${v("glass")}"/><path d="M39 10 H53 L52 20 H40 Z" fill="${v("water")}"/></g>
      ${steam([16, 24], 30, 14)}`),
  },
  simmer: {
    label: "Mijoter",
    svg: `${cocotte()}${steam([14, 50], 24, 12)}`,
  },
  braise_oven: {
    label: "Braiser au four",
    svg: `
      <rect x="6" y="6" width="52" height="52" rx="6" fill="${v("steel")}"/>
      <rect x="11" y="18" width="42" height="34" rx="3" fill="${v("glass-dark")}"/>
      <rect class="a-glow" x="11" y="18" width="42" height="34" rx="3" fill="${v("flame")}" opacity=".18" ${N}/>
      <path d="M17 22 l3 2 l3 -2 l3 2 l3 -2 l3 2 l3 -2 l3 2 l3 -2 l3 2 l3 -2" fill="none" stroke="${v("flame")}" stroke-width="1.8" class="a-glow"/>
      <path d="M18 34 H46 V44 Q46 48 42 48 H22 Q18 48 18 44 Z" fill="${v("iron")}" stroke="${v("shine")}" stroke-width="1.4"/>
      <path d="M17 34 Q32 26 47 34 Z" fill="${v("iron-2")}" stroke="${v("shine")}" stroke-width="1.4"/>
      <circle cx="16" cy="12" r="2.4" fill="${v("iron")}"/><circle cx="24" cy="12" r="2.4" fill="${v("iron")}"/>`,
  },
  boil: {
    label: "Cuire à l'eau",
    svg: `${pot(`
      ${[
        [22, 0],
        [32, 0.5],
        [42, 0.25],
        [27, 0.9],
        [38, 1.2],
      ]
        .map(([x, d]) => `<circle class="a-bubble" style="--d:${d}s" cx="${x}" cy="26" r="2" fill="${v("water-2")}" stroke-width="1.4"/>`)
        .join("")}`)}${steam([20, 32, 44], 18, 12)}`,
  },
  bake: {
    label: "Au four",
    svg: `
      <rect x="6" y="6" width="52" height="52" rx="6" fill="${v("steel")}"/>
      <rect x="11" y="18" width="42" height="34" rx="3" fill="${v("glass-dark")}"/>
      <rect class="a-glow" x="11" y="18" width="42" height="34" rx="3" fill="${v("flame")}" opacity=".18" ${N}/>
      <path class="a-glow" d="M17 22 l3 2 l3 -2 l3 2 l3 -2 l3 2 l3 -2 l3 2 l3 -2 l3 2 l3 -2" fill="none" stroke="${v("flame")}" stroke-width="1.8"/>
      <rect x="17" y="35" width="30" height="12" rx="2" fill="${v("glass")}" stroke="${v("shine")}" stroke-width="1.4"/>
      <path d="M18 36 Q22 32 26 35 Q30 31 34 35 Q38 32 42 35 Q45 33 46 36 V40 H18 Z" fill="${v("cheese")}" stroke="${v("crust")}" stroke-width="1.4"/>
      ${[24, 33, 41].map((x, i) => `<circle class="a-pop" style="--d:${i * 0.5}s" cx="${x}" cy="31" r="1.3" fill="${v("cheese")}" ${N}/>`).join("")}
      <circle cx="16" cy="12" r="2.4" fill="${v("iron")}"/><circle cx="24" cy="12" r="2.4" fill="${v("iron")}"/>
      <rect x="36" y="10" width="16" height="4" rx="2" fill="${v("glass-dark")}"/>`,
  },
  chop: {
    label: "Couper",
    svg: board(`
      ${[8, 15, 22].map((x) => `<ellipse cx="${x + 3}" cy="42" rx="3.4" ry="2.4" fill="${v("carrot")}"/>`).join("")}
      <path d="M30 44 V36 Q30 32 35 32 H50 Q54 32 54 36 V44 Z" fill="${v("carrot")}"/>
      <g class="a-chop" style="transform-origin:100% 50%">
        <path d="M27 40 L29 18 Q29 14 33 14 H40 L40 40 Z" fill="${v("blade")}"/>
        <rect x="38" y="13" width="22" height="6" rx="3" fill="${v("iron")}" transform="rotate(-6 38 16)"/>
      </g>`),
  },
  grate: {
    label: "Râper",
    svg: `
      <path d="M4 58 H60" fill="none" stroke-width="2"/>
      <path d="M20 10 H36 L42 54 H14 Z" fill="${v("steel")}"/>
      <path d="M24 10 Q28 2 32 10" fill="none" stroke-width="2.6"/>
      ${[
        [22, 20],
        [28, 20],
        [34, 20],
        [21, 30],
        [28, 30],
        [35, 30],
        [20, 40],
        [28, 40],
        [36, 40],
      ]
        .map(([x, y]) => `<path d="M${x - 2} ${y} q2 -2 4 0" fill="none" stroke-width="1.6"/>`)
        .join("")}
      ${[
        [47, 22, 0],
        [52, 30, 0.4],
        [48, 38, 0.8],
        [54, 44, 1.2],
      ]
        .map(([x, y, d]) => `<path class="a-fall" style="--d:${d}s" d="M${x} ${y} q2 2 1 5" fill="none" stroke="${v("cheese")}" stroke-width="2.6"/>`)
        .join("")}
      <path d="M44 55 Q50 49 58 55 Z" fill="${v("cheese")}"/>`,
  },
  mix: {
    label: "Mélanger",
    svg: bowl(
      `<ellipse cx="32" cy="34" rx="23" ry="4" fill="${v("cream")}"/>
       <g class="a-whisk" style="transform-origin:50% 100%">
         <path d="M36 4 L33 30" fill="none" stroke="${v("wood-2")}" stroke-width="3.2"/>
         <path d="M33 22 Q24 30 31 36 Q38 30 33 22 Z M33 22 Q28 32 33 36 Q37 30 33 22" fill="none" stroke-width="1.8"/>
       </g>
       <path class="a-swirl" style="transform-origin:50% 50%" d="M20 34 Q32 30 44 34" fill="none" stroke="${v("cream-2")}" stroke-width="2"/>`,
      "accent-illu",
    ),
  },
  marinate: {
    label: "Mariner",
    svg: bowl(
      `<ellipse cx="32" cy="34" rx="23" ry="4" fill="${v("soy")}"/>
       <path d="M16 34 Q16 28 22 28 H29 Q32 28 32 32 V34 Z" fill="${v("meat")}"/>
       <path d="M32 34 Q32 27 38 27 H45 Q48 27 48 31 V34 Z" fill="${v("meat")}"/>
       ${[24, 40].map((x, i) => `<path class="a-fall" style="--d:${i * 0.6}s" d="M${x} 10 q-3 5 0 7 q3 -2 0 -7 Z" fill="${v("soy")}" stroke-width="1.6"/>`).join("")}`,
      "accent-illu",
    ),
  },
  drain: {
    label: "Égoutter",
    svg: `
      <path d="M8 22 H56 Q54 44 32 44 Q10 44 8 22 Z" fill="${v("steel")}"/>
      <path d="M4 22 H10 M54 22 H60" fill="none" stroke-width="3.2"/>
      ${[
        [20, 30],
        [28, 32],
        [36, 32],
        [44, 30],
        [24, 37],
        [32, 39],
        [40, 37],
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="${v("line")}" ${N}/>`)
        .join("")}
      <path d="M14 22 Q20 14 26 20 Q32 12 38 19 Q44 13 50 22 Z" fill="${v("pasta")}"/>
      ${[
        [22, 0],
        [32, 0.35],
        [42, 0.7],
        [27, 1.05],
        [37, 1.4],
      ]
        .map(([x, d]) => `<path class="a-fall" style="--d:${d}s" d="M${x} 47 q-2 3 0 5 q2 -2 0 -5 Z" fill="${v("water")}" stroke-width="1.4"/>`)
        .join("")}
      <path d="M8 60 H56" fill="none" stroke-width="2"/>`,
  },
  season: {
    label: "Assaisonner",
    svg: `
      <g class="a-shake" style="transform-origin:50% 100%">
        <g transform="rotate(-28 30 26)">
          <path d="M22 12 Q22 8 30 8 Q38 8 38 12 V16 H22 Z" fill="${v("steel")}"/>
          <rect x="21" y="16" width="18" height="24" rx="3" fill="${v("plate")}"/>
          <circle cx="27" cy="12" r=".9" fill="${v("line")}" ${N}/><circle cx="31" cy="11" r=".9" fill="${v("line")}" ${N}/><circle cx="34" cy="13" r=".9" fill="${v("line")}" ${N}/>
        </g>
      </g>
      ${[
        [16, 0],
        [20, 0.3],
        [13, 0.6],
        [18, 0.9],
        [22, 1.2],
      ]
        .map(([x, d]) => `<circle class="a-fall" style="--d:${d}s" cx="${x}" cy="30" r="1.2" fill="${v("line")}" ${N}/>`)
        .join("")}
      <path d="M4 50 Q4 58 12 58 H40 Q48 58 48 50 Z" fill="${v("accent-illu")}"/>
      <path d="M8 50 Q26 46 44 50" fill="none" stroke="${v("tomato")}" stroke-width="3"/>`,
  },
  rest: {
    label: "Laisser reposer",
    svg: `
      <ellipse cx="28" cy="50" rx="25" ry="7" fill="${v("plate")}"/>
      <path d="M8 49 L18 30 L28 26 L38 30 L48 49 Q28 54 8 49 Z" fill="${v("foil")}"/>
      <path d="M18 30 L22 46 M28 26 L28 50 M38 30 L34 46" fill="none" stroke="${v("shine")}" stroke-width="1.4"/>
      <circle cx="50" cy="16" r="10" fill="${v("plate")}"/>
      <path d="M50 10 V16" fill="none" stroke-width="2"/>
      <path class="a-tick" style="transform-origin:0% 0%" d="M50 16 L55 19" fill="none" stroke="${v("tomato")}" stroke-width="2.2"/>
      <path d="M47 4 H53" fill="none" stroke-width="2.4"/>`,
  },
  cool: {
    label: "Refroidir",
    svg: `
      <rect x="4" y="38" width="50" height="16" rx="3" fill="${v("glass")}"/>
      <path d="M6 41 Q29 36 52 41 V44 H6 Z" fill="${v("sauce")}" stroke-width="1.6"/>
      <g class="a-spin-slow" style="transform-origin:50% 50%">
        <path d="M46 4 V28 M35.6 10 L56.4 22 M35.6 22 L56.4 10" fill="none" stroke="${v("water-2")}" stroke-width="2.6"/>
        <path d="M43 6 L46 9 L49 6 M43 26 L46 23 L49 26" fill="none" stroke="${v("water-2")}" stroke-width="1.8"/>
      </g>
      ${[14, 24, 34].map((x, i) => `<path class="a-sink" style="--d:${i * 0.5}s" d="M${x} 20 q-2 4 0 8 t0 6" fill="none" stroke="${v("water")}" stroke-width="2"/>`).join("")}`,
  },
  assemble: {
    label: "Monter le plat",
    svg: `
      <path d="M2 36 H8 M56 36 H62" fill="none" stroke-width="3.2"/>
      <path d="M6 30 H58 L55 52 Q54 56 50 56 H14 Q10 56 9 52 Z" fill="${v("glass")}"/>
      <path d="M9 50 H55 L54.5 53 Q54 55 50 55 H14 Q10 55 9.5 53 Z" fill="${v("pasta")}" stroke-width="1.4"/>
      <path class="a-drop" style="--d:0s" d="M9 44 H55 V50 H9 Z" fill="${v("sauce")}" stroke-width="1.4"/>
      <path class="a-drop" style="--d:.5s" d="M8 38 H56 V44 H8 Z" fill="${v("rice")}" stroke-width="1.4"/>
      <path class="a-drop" style="--d:1s" d="M7.5 33 Q16 29 24 33 Q32 29 40 33 Q48 29 56.5 33 V38 H7.5 Z" fill="${v("cheese")}" stroke-width="1.4"/>
      <path class="a-shine" d="M14 34 V40" fill="none" stroke="${v("shine")}" stroke-width="2.4"/>`,
  },
  portion: {
    label: "Portionner",
    svg: [10, 32, 54]
      .map(
        (x, i) => `
      <rect x="${x - 9}" y="30" width="18" height="22" rx="3" fill="${v("glass")}"/>
      <rect class="a-fill" style="--d:${i * 0.6}s;transform-origin:50% 100%" x="${x - 7}" y="38" width="14" height="12" rx="2" fill="${v(i === 1 ? "rice" : "sauce")}" stroke-width="1.4"/>
      <rect x="${x - 10}" y="25" width="20" height="5" rx="2" fill="${v(["tomato", "accent-illu", "leaf"][i])}"/>`,
      )
      .join(""),
  },
  wait: {
    label: "Attendre",
    svg: `
      <circle cx="32" cy="34" r="22" fill="${v("plate")}"/>
      <path d="M26 6 H38 M32 6 V12" fill="none" stroke-width="2.8"/>
      <path d="M32 34 V18" fill="none" stroke-width="2.4"/>
      <path class="a-tick" style="transform-origin:0% 0%" d="M32 34 L44 40" fill="none" stroke="${v("tomato")}" stroke-width="2.6"/>
      <circle cx="32" cy="34" r="2.4" fill="${v("line")}"/>`,
  },
} satisfies Record<string, Art>;

export type ActionId = keyof typeof ACTIONS;

// ─── Aliments ───

const meatCut = (fill: string, fat = true) => `
  <g class="a-bob">
    <path d="M10 30 Q8 16 24 14 Q40 10 50 20 Q58 30 50 42 Q42 52 26 50 Q12 48 10 30 Z" fill="${v(fill)}"/>
    ${fat ? `<path d="M14 26 Q24 20 34 24 Q42 27 48 24" fill="none" stroke="${v("fat")}" stroke-width="3.4"/><path d="M18 38 Q28 34 40 40" fill="none" stroke="${v("fat")}" stroke-width="2.4"/>` : ""}
  </g>`;

const cubes = (fill: string) => `
  <g class="a-bob">
    ${[
      [8, 30],
      [26, 26],
      [44, 32],
      [17, 42],
      [35, 44],
    ]
      .map(
        ([x, y]) =>
          `<path d="M${x} ${y} l7 -5 l9 3 v10 l-7 5 l-9 -3 Z" fill="${v(fill)}"/><path d="M${x} ${y} l9 3 l7 -5 M${x + 9} ${y + 3} v10" fill="none" stroke-width="1.4"/>`,
      )
      .join("")}
  </g>`;

const drumstick = `
  <g class="a-wobble" style="transform-origin:50% 60%">
    <path d="M38 34 L50 50" fill="none" stroke="${v("bone")}" stroke-width="6"/>
    <path d="M38 34 L50 50" fill="none" stroke="${v("line")}" stroke-width="1" opacity="0"/>
    <circle cx="51" cy="54" r="3.4" fill="${v("bone")}"/><circle cx="55" cy="50" r="3.4" fill="${v("bone")}"/>
    <path d="M14 14 Q34 6 42 26 Q46 38 34 40 Q16 44 10 30 Q8 20 14 14 Z" fill="${v("chicken")}"/>
    <path d="M18 20 Q22 16 28 17" fill="none" stroke="${v("shine")}" stroke-width="2"/>
  </g>`;

const greenLeaf = (cx: number, cy: number, r: number, fill = "leaf") =>
  `<path d="M${cx} ${cy} q${r} -${r * 1.4} 0 -${r * 2.6} q-${r} ${r * 1.2} 0 ${r * 2.6} Z" fill="${v(fill)}"/>`;

export const FOODS = {
  // Viandes
  porc: { category: "viande", label: "Porc", svg: meatCut("meat") },
  echine_porc: { category: "viande", label: "Échine de porc", svg: meatCut("meat") },
  saute_porc: { category: "viande", label: "Sauté de porc", svg: cubes("meat") },
  filet_mignon_porc: {
    category: "viande",
    label: "Filet mignon",
    svg: `<g class="a-bob">${[
      [18, 40],
      [36, 32],
      [48, 46],
    ]
      .map(
        ([x, y]) =>
          `<path d="M${x - 11} ${y} V${y + 5} Q${x} ${y + 11} ${x + 11} ${y + 5} V${y} Z" fill="${v("meat-2")}"/><ellipse cx="${x}" cy="${y}" rx="11" ry="6" fill="${v("meat")}"/>`,
      )
      .join("")}</g>`,
  },
  poitrine_porc: {
    category: "viande",
    label: "Poitrine de porc",
    svg: `<g class="a-bob"><rect x="8" y="18" width="48" height="30" rx="5" fill="${v("meat")}"/>
      <path d="M8 26 H56 M8 34 H56 M8 41 H56" fill="none" stroke="${v("fat")}" stroke-width="3.4"/></g>`,
  },
  saucisse_toulouse: {
    category: "viande",
    label: "Saucisse",
    svg: `<g class="a-wobble" style="transform-origin:50% 50%"><path d="M8 40 Q6 22 24 22 H40 Q58 22 56 40 Q54 48 44 46 Q32 40 20 46 Q10 50 8 40 Z" fill="${v("sausage")}"/>
      <path d="M16 30 Q30 26 46 30" fill="none" stroke="${v("shine")}" stroke-width="2"/><path d="M6 31 L2 28 M58 31 L62 28" fill="none" stroke-width="2.4"/></g>`,
  },
  // Volailles
  filet_poulet: {
    category: "volaille",
    label: "Filet de poulet",
    svg: `<g class="a-bob"><path d="M8 34 Q10 14 30 14 Q52 14 56 30 Q58 44 44 48 Q24 54 12 46 Q6 42 8 34 Z" fill="${v("chicken")}"/>
      <path d="M18 24 Q30 18 44 24" fill="none" stroke="${v("shine")}" stroke-width="2"/><path d="M22 40 Q34 36 46 40" fill="none" stroke="${v("chicken-2")}" stroke-width="2"/></g>`,
  },
  cuisse_poulet: { category: "volaille", label: "Cuisse de poulet", svg: drumstick },
  haut_cuisse_poulet: { category: "volaille", label: "Haut de cuisse", svg: drumstick },
  poulet_entier: {
    category: "volaille",
    label: "Poulet entier",
    svg: `<g class="a-bob"><path d="M8 38 Q6 18 30 16 Q56 16 56 38 Q54 52 32 52 Q10 52 8 38 Z" fill="${v("chicken-roast")}"/>
      <path d="M50 22 L58 14" fill="none" stroke="${v("bone")}" stroke-width="5"/><circle cx="59" cy="13" r="3" fill="${v("bone")}"/>
      <path d="M14 30 Q26 22 40 26" fill="none" stroke="${v("shine")}" stroke-width="2"/></g>`,
  },
  cuisse_dinde: { category: "volaille", label: "Cuisse de dinde", svg: drumstick },
  oeuf: {
    category: "oeuf",
    label: "Œuf",
    svg: `<g class="a-wobble" style="transform-origin:50% 90%"><path d="M32 6 Q50 8 52 34 Q54 56 32 56 Q10 56 12 34 Q14 8 32 6 Z" fill="${v("egg")}"/>
      <path class="a-shine" d="M22 22 Q24 16 28 14" fill="none" stroke="${v("shine")}" stroke-width="2.6"/></g>`,
  },
  // Féculents
  riz_basmati: {
    category: "feculent",
    label: "Riz",
    svg: bowl(
      `<path d="M10 34 Q12 18 32 18 Q52 18 54 34 Z" fill="${v("rice")}"/>
       ${[
         [20, 28, 20],
         [28, 23, -20],
         [36, 26, 30],
         [44, 30, -10],
         [30, 31, 70],
       ]
         .map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="2.6" ry="1.1" transform="rotate(${r} ${x} ${y})" fill="${v("grain")}" stroke-width="1.2"/>`)
         .join("")}
       ${steam([26, 38], 16, 10)}`,
      "accent-illu",
    ),
  },
  pates: {
    category: "feculent",
    label: "Pâtes",
    svg: `<g class="a-bob">${[
      [10, 30, -25],
      [26, 18, 15],
      [32, 38, -10],
      [44, 24, 30],
    ]
      .map(
        ([x, y, r]) =>
          `<g transform="rotate(${r} ${x + 9} ${y + 6})"><rect x="${x}" y="${y}" width="18" height="12" rx="2" fill="${v("pasta")}"/><path d="M${x + 4} ${y} V${y + 12} M${x + 9} ${y} V${y + 12} M${x + 14} ${y} V${y + 12}" fill="none" stroke="${v("pasta-2")}" stroke-width="1.4"/><ellipse cx="${x}" cy="${y + 6}" rx="2" ry="6" fill="${v("pasta-2")}"/></g>`,
      )
      .join("")}</g>`,
  },
  pomme_de_terre: {
    category: "feculent",
    label: "Pomme de terre",
    svg: `<g class="a-bob"><path d="M10 34 Q8 16 28 14 Q50 12 54 28 Q58 46 38 50 Q14 54 10 34 Z" fill="${v("potato")}"/>
      ${[
        [22, 24],
        [40, 22],
        [30, 38],
        [46, 38],
      ]
        .map(([x, y]) => `<path d="M${x} ${y} q2 -1 3 1" fill="none" stroke="${v("potato-2")}" stroke-width="1.8"/>`)
        .join("")}</g>`,
  },
  pois_chiches: {
    category: "feculent",
    label: "Pois chiches",
    svg: `<g class="a-bob">${[
      [20, 24],
      [36, 20],
      [48, 32],
      [14, 40],
      [30, 38],
      [42, 48],
      [24, 52],
    ]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="${v("grain")}"/><path d="M${x - 1} ${y - 6} q-2 3 1 5" fill="none" stroke-width="1.4"/>`)
      .join("")}</g>`,
  },
  farine: {
    category: "feculent",
    label: "Farine",
    svg: `<path d="M14 18 L18 10 Q20 6 24 8 L32 12 L40 8 Q44 6 46 10 L50 18 Z" fill="${v("paper")}"/>
      <path d="M14 18 H50 L54 52 Q54 56 50 56 H14 Q10 56 10 52 Z" fill="${v("paper")}"/>
      <rect x="18" y="30" width="28" height="14" rx="2" fill="${v("accent-illu")}"/>
      <path d="M26 37 q6 -6 12 0" fill="none" stroke="${v("grain")}" stroke-width="2.4"/>
      <circle class="a-puff" cx="52" cy="10" r="3" fill="${v("paper")}" stroke-width="1.4"/><circle class="a-puff" style="--d:.5s" cx="58" cy="16" r="2" fill="${v("paper")}" stroke-width="1.4"/>`,
  },
  maizena: {
    category: "feculent",
    label: "Fécule",
    svg: `<path d="M16 14 H48 V54 H16 Z" fill="${v("yolk")}"/><path d="M16 14 L20 8 H44 L48 14" fill="${v("yolk")}"/>
      <rect x="20" y="26" width="24" height="14" rx="2" fill="${v("paper")}"/><path d="M26 33 h12" fill="none" stroke="${v("tomato")}" stroke-width="2.6"/>`,
  },
  // Légumes
  oignon: {
    category: "legume",
    label: "Oignon",
    svg: `<g class="a-wobble" style="transform-origin:50% 90%"><path d="M32 8 Q30 16 26 18 Q8 24 10 40 Q12 56 32 56 Q52 56 54 40 Q56 24 38 18 Q34 16 32 8 Z" fill="${v("onion")}"/>
      <path d="M32 20 Q22 32 26 54 M32 20 Q42 32 38 54 M32 20 V55" fill="none" stroke="${v("onion-2")}" stroke-width="1.6"/>
      <path d="M28 58 L30 55 M36 58 L34 55" fill="none" stroke-width="1.6"/></g>`,
  },
  echalote: {
    category: "legume",
    label: "Échalote",
    svg: `<g class="a-wobble" style="transform-origin:50% 90%"><path d="M30 6 Q30 14 24 18 Q12 28 14 42 Q16 56 30 56 Q44 56 46 42 Q48 28 36 18 Q30 14 30 6 Z" fill="${v("shallot")}"/>
      <path d="M30 20 Q24 34 28 54 M30 20 Q38 34 34 54" fill="none" stroke="${v("shallot-2")}" stroke-width="1.6"/></g>`,
  },
  ail: {
    category: "aromate",
    label: "Ail",
    svg: `<g class="a-wobble" style="transform-origin:50% 90%"><path d="M32 8 Q28 18 22 22 Q8 30 12 44 Q16 56 32 56 Q48 56 52 44 Q56 30 42 22 Q36 18 32 8 Z" fill="${v("garlic")}"/>
      <path d="M32 22 Q22 34 26 55 M32 22 Q42 34 38 55" fill="none" stroke="${v("garlic-2")}" stroke-width="1.8"/>
      <path d="M26 58 L28 55 M32 59 V56 M38 58 L36 55" fill="none" stroke-width="1.6"/></g>`,
  },
  gingembre: {
    category: "aromate",
    label: "Gingembre",
    svg: `<g class="a-bob"><path d="M8 40 Q6 30 16 30 Q18 20 26 22 Q30 12 38 16 Q44 20 40 28 Q50 26 54 32 Q58 40 50 44 Q40 48 30 46 Q14 50 8 40 Z" fill="${v("ginger")}"/>
      <path d="M16 38 q4 -2 8 0 M34 34 q4 -2 8 0" fill="none" stroke="${v("ginger-2")}" stroke-width="1.6"/></g>`,
  },
  champignon: {
    category: "legume",
    label: "Champignon",
    svg: `<g class="a-wobble" style="transform-origin:50% 95%"><path d="M24 34 H40 L42 54 Q42 57 38 57 H26 Q22 57 22 54 Z" fill="${v("mush-2")}"/>
      <path d="M6 34 Q6 10 32 10 Q58 10 58 34 Q46 38 32 38 Q18 38 6 34 Z" fill="${v("mush")}"/>
      <path class="a-shine" d="M16 22 Q20 16 28 15" fill="none" stroke="${v("shine")}" stroke-width="2.4"/></g>`,
  },
  courgette: {
    category: "legume",
    label: "Courgette",
    svg: `<g class="a-bob"><path d="M8 48 Q4 42 12 36 L44 14 Q52 8 56 14 Q60 20 52 26 L20 50 Q12 56 8 48 Z" fill="${v("leaf-2")}"/>
      <path d="M14 42 L48 18" fill="none" stroke="${v("leaf")}" stroke-width="2.4"/><path d="M54 12 L60 6" fill="none" stroke="${v("leaf-2")}" stroke-width="4"/></g>`,
  },
  poivron: {
    category: "legume",
    label: "Poivron",
    svg: `<g class="a-wobble" style="transform-origin:50% 90%"><path d="M32 18 Q20 12 14 20 Q6 32 12 46 Q16 56 26 54 Q32 58 38 54 Q48 56 52 46 Q58 32 50 20 Q44 12 32 18 Z" fill="${v("tomato")}"/>
      <path d="M32 18 V30" fill="none" stroke="${v("tomato-2")}" stroke-width="1.8"/><path d="M32 18 Q32 10 38 6" fill="none" stroke="${v("leaf-2")}" stroke-width="3.6"/>
      <path class="a-shine" d="M18 28 Q20 24 24 23" fill="none" stroke="${v("shine")}" stroke-width="2.4"/></g>`,
  },
  carotte: {
    category: "legume",
    label: "Carotte",
    svg: `<g class="a-sway" style="transform-origin:80% 20%"><path d="M8 56 Q6 54 10 48 L40 16 Q48 12 52 18 Q54 24 46 30 Z" fill="${v("carrot")}"/>
      <path d="M22 40 l5 3 M30 31 l5 3 M16 48 l4 3" fill="none" stroke="${v("carrot-2")}" stroke-width="1.6"/>
      ${greenLeaf(52, 14, 4, "leaf")}<path d="M50 16 Q54 6 60 4 M50 16 Q60 12 62 14" fill="none" stroke="${v("leaf-2")}" stroke-width="3"/></g>`,
  },
  haricots_verts: {
    category: "legume",
    label: "Haricots verts",
    svg: `<g class="a-sway" style="transform-origin:50% 100%">${[
      [14, 0],
      [26, 8],
      [38, -6],
      [50, 4],
    ]
      .map(([x, r]) => `<path d="M${x} 56 Q${x - 6} 34 ${x + 2} 8" fill="none" stroke="${v("line")}" stroke-width="7.4" transform="rotate(${r} ${x} 56)"/><path d="M${x} 56 Q${x - 6} 34 ${x + 2} 8" fill="none" stroke="${v("leaf")}" stroke-width="4.4" stroke-linecap="round" transform="rotate(${r} ${x} 56)"/>`)
      .join("")}</g>`,
  },
  pulpe_tomate: { category: "conserve", label: "Pulpe de tomate", svg: can(`<circle cx="32" cy="34" r="6" fill="${v("tomato")}"/><path d="M29 28 l3 2 l3 -2" fill="none" stroke="${v("leaf-2")}" stroke-width="2"/>`, "paper") },
  concentre_tomate: {
    category: "conserve",
    label: "Concentré de tomate",
    svg: `<g class="a-squeeze" style="transform-origin:0% 50%"><path d="M10 22 H44 L54 30 V34 L44 42 H10 Q6 42 6 38 V26 Q6 22 10 22 Z" fill="${v("tomato")}"/>
      <rect x="54" y="28" width="6" height="8" rx="1.5" fill="${v("paper")}"/><path d="M12 22 V42" fill="none" stroke-width="1.6"/>
      <rect x="18" y="27" width="18" height="10" rx="2" fill="${v("paper")}"/></g>
      <path class="a-pop" d="M60 44 q3 4 0 8" fill="none" stroke="${v("tomato")}" stroke-width="3"/>`,
  },
  tomate: {
    category: "legume",
    label: "Tomate",
    svg: `<g class="a-wobble" style="transform-origin:50% 90%"><circle cx="32" cy="36" r="22" fill="${v("tomato")}"/>
      <path d="M22 16 L32 20 L42 16 L38 22 L44 26 L32 24 L20 26 L26 22 Z" fill="${v("leaf-2")}"/>
      <path class="a-shine" d="M18 32 Q20 26 26 24" fill="none" stroke="${v("shine")}" stroke-width="2.6"/></g>`,
  },
  persil: {
    category: "herbe",
    label: "Persil",
    svg: sprig("leaf", [
      [26, 20, -30],
      [40, 16, 30],
      [24, 32, -20],
      [40, 30, 25],
      [30, 12, -60],
    ]),
  },
  citron_vert: {
    category: "fruit",
    label: "Citron vert",
    svg: `<g class="a-bob"><ellipse cx="26" cy="34" rx="18" ry="15" fill="${v("lime")}"/><path d="M8 34 L4 33 M44 34 L48 33" fill="none" stroke-width="2.4"/>
      <circle cx="44" cy="44" r="13" fill="${v("lime-2")}"/><circle cx="44" cy="44" r="9.5" fill="${v("lime-pulp")}" stroke-width="1.6"/>
      <path d="M44 34.5 V53.5 M34.5 44 H53.5 M37.3 37.3 L50.7 50.7 M50.7 37.3 L37.3 50.7" fill="none" stroke="${v("lime-2")}" stroke-width="1.4"/></g>`,
  },
  // Laitiers et matières grasses
  ricotta: { category: "laitier", label: "Ricotta", svg: jar("paper", "accent-illu", true, "cream") },
  emmental_rape: {
    category: "laitier",
    label: "Râpé",
    svg: `<path d="M8 22 H56 L52 56 H12 Z" fill="${v("paper")}"/><rect x="8" y="16" width="48" height="8" rx="2" fill="${v("accent-illu")}"/>
      ${[
        [18, 30, 20],
        [30, 34, -30],
        [42, 30, 40],
        [22, 44, -10],
        [38, 46, 30],
      ]
        .map(([x, y, r]) => `<path d="M${x - 5} ${y} q5 -3 10 0" transform="rotate(${r} ${x} ${y})" fill="none" stroke="${v("cheese")}" stroke-width="3"/>`)
        .join("")}`,
  },
  creme_legere: {
    category: "laitier",
    label: "Crème",
    svg: `<path d="M16 22 H48 L44 56 H20 Z" fill="${v("paper")}"/><rect x="14" y="16" width="36" height="7" rx="2" fill="${v("water-2")}"/>
      <path d="M18 34 H46" fill="none" stroke="${v("water-2")}" stroke-width="3"/>
      <path class="a-bob" d="M24 12 Q32 2 40 12 Q36 10 32 13 Q28 10 24 12 Z" fill="${v("cream")}"/>`,
  },
  beurre: {
    category: "gras",
    label: "Beurre",
    svg: `<g class="a-bob"><path d="M6 36 L20 24 H58 L44 36 Z" fill="${v("butter")}"/><path d="M6 36 H44 V50 H6 Z" fill="${v("butter")}"/><path d="M44 36 L58 24 V38 L44 50 Z" fill="${v("butter-2")}"/>
      <path d="M8 36 H40" fill="none" stroke="${v("paper")}" stroke-width="4"/></g>`,
  },
  huile: { category: "gras", label: "Huile", svg: bottle("oil", "leaf-2", true) },
  // Épicerie
  sucre: {
    category: "sucre",
    label: "Sucre",
    svg: `<g class="a-bob">${[
      [12, 32],
      [32, 32],
      [22, 16],
    ]
      .map(
        ([x, y]) =>
          `<path d="M${x} ${y} l9 -5 l11 4 v13 l-9 5 l-11 -4 Z" fill="${v("paper")}"/><path d="M${x} ${y} l11 4 l9 -5 M${x + 11} ${y + 4} v13" fill="none" stroke-width="1.4"/>`,
      )
      .join("")}</g>`,
  },
  miel: {
    category: "sucre",
    label: "Miel",
    svg: `${jar("honey", "wood", true, "paper")}
      <g class="a-sway" style="transform-origin:50% 100%"><path d="M44 2 L36 22" fill="none" stroke="${v("wood-2")}" stroke-width="3"/><ellipse cx="35" cy="24" rx="4" ry="5" fill="${v("wood")}"/></g>
      <path class="a-drip" d="M35 29 V34" fill="none" stroke="${v("honey")}" stroke-width="3"/>`,
  },
  nuoc_mam: { category: "condiment", label: "Nuoc-mâm", svg: bottle("fish-sauce", "tomato") },
  sauce_soja: { category: "condiment", label: "Sauce soja", svg: bottle("soy", "tomato") },
  moutarde: { category: "condiment", label: "Moutarde", svg: jar("mustard", "steel", false, "paper") },
  colombo: { category: "epice", label: "Colombo", svg: jar("curry", "tomato", false, "paper") },
  bouillon_cube: {
    category: "condiment",
    label: "Bouillon",
    svg: `<g class="a-bob"><path d="M12 26 L28 16 L52 22 V42 L36 52 L12 46 Z" fill="${v("butter")}"/><path d="M12 26 L36 32 L52 22 M36 32 V52" fill="none" stroke-width="1.8"/>
      <path d="M12 26 L36 32 V52 L12 46 Z" fill="${v("tomato")}"/><path d="M18 36 h12" fill="none" stroke="${v("paper")}" stroke-width="3"/></g>`,
  },
  vin_blanc_cuit: {
    category: "liquide",
    label: "Vin blanc",
    svg: `<path d="M26 4 H34 V18 Q42 24 42 32 V56 H18 V32 Q18 24 26 18 Z" fill="${v("bottle")}"/>
      <rect x="26" y="4" width="8" height="5" fill="${v("tomato")}"/><rect x="18" y="36" width="24" height="12" fill="${v("paper")}"/>
      <path d="M46 30 H60 Q60 42 53 42 Q46 42 46 30 Z" fill="${v("wine")}"/><path d="M53 42 V56 M48 56 H58" fill="none" stroke-width="2.2"/>
      <path class="a-shine" d="M22 30 V34" fill="none" stroke="${v("shine")}" stroke-width="2.4"/>`,
  },
  // Assaisonnements (aliment « zero » : reconnus au nom)
  sel: {
    category: "epice",
    label: "Sel",
    svg: `<g class="a-shake" style="transform-origin:50% 100%"><path d="M20 18 Q20 10 32 10 Q44 10 44 18 V22 H20 Z" fill="${v("steel")}"/>
      <rect x="18" y="22" width="28" height="34" rx="5" fill="${v("paper")}"/>
      <circle cx="28" cy="15" r="1.2" fill="${v("line")}" ${N}/><circle cx="32" cy="13" r="1.2" fill="${v("line")}" ${N}/><circle cx="36" cy="15" r="1.2" fill="${v("line")}" ${N}/>
      <path d="M26 36 q6 -4 12 0 M26 44 q6 -4 12 0" fill="none" stroke="${v("water")}" stroke-width="2"/></g>`,
  },
  poivre: {
    category: "epice",
    label: "Poivre",
    svg: `<g class="a-twist" style="transform-origin:50% 100%"><circle cx="32" cy="10" r="4" fill="${v("wood-2")}"/>
      <path d="M22 16 Q22 12 32 12 Q42 12 42 16 V22 Q36 26 36 32 V50 Q36 56 44 56 H20 Q28 56 28 50 V32 Q28 26 22 22 Z" fill="${v("wood")}"/></g>
      ${[16, 22].map((x, i) => `<circle class="a-fall" style="--d:${i * 0.5}s" cx="${x}" cy="40" r="1.3" fill="${v("line")}" ${N}/>`).join("")}`,
  },
  thym: {
    category: "herbe",
    label: "Thym",
    svg: sprig("herb", [
      [28, 18, -40],
      [37, 22, 40],
      [27, 28, -40],
      [36, 32, 40],
      [28, 38, -40],
      [36, 42, 40],
      [33, 12, 0],
    ]),
  },
  laurier: {
    category: "herbe",
    label: "Laurier",
    svg: `<g class="a-sway" style="transform-origin:20% 90%"><path d="M10 54 Q14 28 40 10 Q56 4 54 18 Q48 42 10 54 Z" fill="${v("bay")}"/>
      <path d="M10 54 Q30 34 50 12" fill="none" stroke="${v("leaf-2")}" stroke-width="1.8"/></g>`,
  },
  origan: {
    category: "herbe",
    label: "Origan",
    svg: sprig("herb", [
      [27, 22, -20],
      [38, 20, 20],
      [26, 36, -20],
      [38, 34, 20],
    ]),
  },
  paprika: { category: "epice", label: "Paprika", svg: jar("tomato-2", "steel", false, "paper") },
  piment: {
    category: "epice",
    label: "Piment",
    svg: `<g class="a-wobble" style="transform-origin:80% 20%"><path d="M48 14 Q44 40 14 54 Q8 56 10 50 Q30 38 40 14 Z" fill="${v("tomato")}"/>
      <path d="M40 14 Q44 6 52 8 L48 14 Z" fill="${v("leaf-2")}"/></g>`,
  },
  eau: {
    category: "liquide",
    label: "Eau",
    svg: `<path d="M14 10 H50 L46 56 H18 Z" fill="${v("glass")}"/><path d="M16 26 H48 L46 56 H18 Z" fill="${v("water")}"/>
      <path class="a-wave" d="M16 26 q4 -3 8 0 t8 0 t8 0 t8 0" fill="none" stroke="${v("water-2")}" stroke-width="2"/>`,
  },
  fenouil: {
    category: "epice",
    label: "Graines de fenouil",
    svg: `<g class="a-bob">${[
      [20, 24, 30],
      [34, 20, -20],
      [44, 34, 50],
      [24, 40, -40],
      [36, 46, 10],
    ]
      .map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="7" ry="3" transform="rotate(${r} ${x} ${y})" fill="${v("bay")}"/>`)
      .join("")}</g>`,
  },
  // Génériques par catégorie (jamais d'aliment sans dessin)
  _viande: { category: "viande", label: "Viande", svg: meatCut("meat") },
  _volaille: { category: "volaille", label: "Volaille", svg: drumstick },
  _poisson: {
    category: "poisson",
    label: "Poisson",
    svg: `<g class="a-swim" style="transform-origin:50% 50%"><path d="M6 32 Q22 14 42 24 L56 14 Q54 32 56 50 L42 40 Q22 50 6 32 Z" fill="${v("fish")}"/>
      <circle cx="16" cy="29" r="2" fill="${v("line")}"/><path d="M26 24 Q30 32 26 40" fill="none" stroke-width="1.6"/></g>`,
  },
  _oeuf: { category: "oeuf", label: "Œuf", svg: "" },
  _feculent: { category: "feculent", label: "Féculent", svg: "" },
  _legume: {
    category: "legume",
    label: "Légume",
    svg: `<g class="a-wobble" style="transform-origin:50% 95%"><path d="M28 36 H36 L38 58 H26 Z" fill="${v("leaf-2")}"/>
      ${[
        [20, 26, 12],
        [44, 26, 12],
        [32, 18, 14],
        [32, 32, 11],
      ]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${v("leaf")}"/>`)
        .join("")}</g>`,
  },
  _fruit: {
    category: "fruit",
    label: "Fruit",
    svg: `<g class="a-wobble" style="transform-origin:50% 90%"><path d="M32 18 Q20 10 12 22 Q6 36 16 50 Q24 60 32 54 Q40 60 48 50 Q58 36 52 22 Q44 10 32 18 Z" fill="${v("tomato")}"/>
      <path d="M32 18 Q32 10 36 6" fill="none" stroke="${v("wood-2")}" stroke-width="2.6"/>${greenLeaf(40, 14, 4)}</g>`,
  },
  _aromate: { category: "aromate", label: "Aromate", svg: "" },
  _herbe: { category: "herbe", label: "Herbes", svg: "" },
  _laitier: {
    category: "laitier",
    label: "Produit laitier",
    svg: `<g class="a-bob"><path d="M6 44 L44 18 L58 40 Z" fill="${v("cheese")}"/><path d="M6 44 H58 V52 H6 Z" fill="${v("cheese-2")}"/><path d="M58 40 V52" fill="none"/>
      <circle cx="34" cy="34" r="3" fill="${v("cheese-2")}" stroke-width="1.4"/><circle cx="46" cy="38" r="2" fill="${v("cheese-2")}" stroke-width="1.4"/></g>`,
  },
  _gras: { category: "gras", label: "Matière grasse", svg: "" },
  _epice: { category: "epice", label: "Épice", svg: "" },
  _condiment: { category: "condiment", label: "Condiment", svg: "" },
  _sucre: { category: "sucre", label: "Sucré", svg: "" },
  _liquide: { category: "liquide", label: "Liquide", svg: "" },
  _conserve: { category: "conserve", label: "Conserve", svg: can("", "paper") },
  _ingredient: {
    category: "ingredient",
    label: "Ingrédient",
    svg: bowl(
      `<circle cx="22" cy="31" r="6" fill="${v("tomato")}"/><circle cx="34" cy="29" r="7" fill="${v("leaf")}"/><circle cx="44" cy="32" r="5" fill="${v("yolk")}"/>`,
      "accent-illu",
    ),
  },
  // Ajouts du 30/10/2026 (recettes one pot, mijotés et plats au four)
  merguez: {
    category: "viande",
    label: "Merguez",
    svg: `<g class="a-wobble" style="transform-origin:50% 50%">${[20, 34, 48]
      .map((y, i) => `<path d="M8 ${y} Q32 ${y - 8 + i * 2} 56 ${y}" fill="none" stroke="${v("line")}" stroke-width="9" stroke-linecap="round"/><path d="M8 ${y} Q32 ${y - 8 + i * 2} 56 ${y}" fill="none" stroke="${v("sausage")}" stroke-width="6.4" stroke-linecap="round"/><path d="M16 ${y - 2} Q32 ${y - 7 + i * 2} 46 ${y - 3}" fill="none" stroke="${v("shine")}" stroke-width="1.4"/>`)
      .join("")}</g>`,
  },
  chorizo: {
    category: "viande",
    label: "Chorizo",
    svg: `<g class="a-bob"><path d="M4 30 Q4 18 16 18 H36 L36 46 H16 Q4 46 4 34 Z" fill="${v("tomato-2")}"/>
      <path d="M2 32 L-2 30" fill="none" stroke-width="2.4"/>
      <ellipse cx="36" cy="32" rx="6" ry="14" fill="${v("sauce")}"/>
      <circle cx="50" cy="40" r="11" fill="${v("sauce")}"/>
      ${[
        [46, 36],
        [53, 38],
        [49, 45],
        [35, 27],
        [37, 37],
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="${v("fat")}" stroke="none"/>`)
        .join("")}</g>`,
  },
  boeuf_hache_5: {
    category: "viande",
    label: "Bœuf haché",
    svg: `<path d="M6 44 H58 L54 54 H10 Z" fill="${v("paper")}"/>
      <g class="a-bob"><path d="M10 44 Q8 26 22 24 Q28 14 38 20 Q52 18 54 32 Q58 40 54 44 Z" fill="${v("meat")}"/>
      ${[
        [18, 34],
        [26, 28],
        [34, 36],
        [42, 28],
        [48, 37],
        [30, 41],
      ]
        .map(([x, y]) => `<path d="M${x} ${y} q2 -3 4 0 q2 3 4 0" fill="none" stroke="${v("meat-2")}" stroke-width="1.6"/>`)
        .join("")}</g>`,
  },
  pois_casses: {
    category: "feculent",
    label: "Pois cassés",
    svg: `<g class="a-bob">${[
      [18, 20],
      [36, 16],
      [50, 30],
      [12, 38],
      [30, 34],
      [46, 48],
      [22, 52],
    ]
      .map(([x, y], i) => `<path d="M${x - 8} ${y} A8 8 0 0 1 ${x + 8} ${y} Z" transform="rotate(${i * 47} ${x} ${y})" fill="${v("split-pea")}"/>`)
      .join("")}</g>`,
  },
  semoule: {
    category: "feculent",
    label: "Semoule",
    svg: bowl(
      `<path d="M10 34 Q12 20 32 18 Q52 20 54 34 Z" fill="${v("grain")}"/>
       ${[
         [18, 30],
         [24, 25],
         [31, 29],
         [38, 23],
         [44, 29],
         [28, 33],
         [36, 32],
         [48, 32],
       ]
         .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1" fill="${v("pasta-2")}" stroke="none"/>`)
         .join("")}
       ${steam([26, 38], 16, 10)}`,
      "accent-illu",
    ),
  },
  patate_douce: {
    category: "feculent",
    label: "Patate douce",
    svg: `<g class="a-bob"><path d="M6 40 Q4 30 16 24 Q34 14 50 20 Q60 24 58 32 Q56 40 44 44 Q26 52 14 50 Q6 48 6 40 Z" fill="${v("sweet-potato")}"/>
      <path d="M58 30 L63 28 M6 42 L2 45" fill="none" stroke-width="2"/>
      <ellipse cx="44" cy="44" rx="11" ry="8" fill="${v("carrot")}"/>
      <path class="a-shine" d="M18 28 Q26 22 34 21" fill="none" stroke="${v("shine")}" stroke-width="2"/></g>`,
  },
  epinards: {
    category: "legume",
    label: "Épinards",
    svg: `<g class="a-sway" style="transform-origin:50% 100%">${[
      [20, -24],
      [32, 0],
      [44, 24],
    ]
      .map(
        ([x, r]) =>
          `<g transform="rotate(${r} 32 58)"><path d="M32 58 V40" fill="none" stroke="${v("leaf-2")}" stroke-width="2.4"/><path d="M32 42 Q${x - 14} 30 ${x - 2} 10 Q${x + 12} 22 32 42 Z" fill="${v("leaf-2")}"/><path d="M32 40 Q${x - 2} 26 ${x - 2} 14" fill="none" stroke="${v("leaf")}" stroke-width="1.6"/></g>`,
      )
      .join("")}</g>`,
  },
  aubergine: {
    category: "legume",
    label: "Aubergine",
    svg: `<g class="a-bob"><path d="M14 54 Q4 50 8 38 Q12 28 24 22 L38 12 Q46 8 50 14 Q54 20 48 28 L40 42 Q32 58 14 54 Z" fill="${v("aubergine")}"/>
      <path d="M40 12 Q46 4 54 8 Q50 12 52 18 Q46 16 40 12 Z" fill="${v("leaf-2")}"/><path d="M52 8 L58 2" fill="none" stroke="${v("leaf-2")}" stroke-width="3.4"/>
      <path class="a-shine" d="M16 42 Q20 34 28 30" fill="none" stroke="${v("shine")}" stroke-width="2.4"/>
      <path d="M22 48 Q32 44 40 34" fill="none" stroke="${v("aubergine-2")}" stroke-width="1.6"/></g>`,
  },
  brocoli: {
    category: "legume",
    label: "Brocoli",
    svg: `<g class="a-wobble" style="transform-origin:50% 95%"><path d="M26 36 H38 L40 56 Q40 58 36 58 H28 Q24 58 24 56 Z" fill="${v("lime")}"/>
      ${[
        [20, 30, 10],
        [32, 22, 12],
        [44, 30, 10],
        [26, 38, 8],
        [38, 38, 8],
      ]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${v("leaf-2")}"/>`)
        .join("")}
      <path d="M26 20 q2 -2 4 0 M38 28 q2 -2 4 0 M16 28 q2 -2 4 0" fill="none" stroke="${v("leaf")}" stroke-width="1.6"/></g>`,
  },
  navet: {
    category: "legume",
    label: "Navet",
    svg: `<g class="a-wobble" style="transform-origin:50% 90%"><path d="M32 22 Q12 22 12 40 Q12 54 32 58 Q52 54 52 40 Q52 22 32 22 Z" fill="${v("paper")}"/>
      <path d="M12 36 Q14 22 32 22 Q50 22 52 36 Q42 32 32 32 Q22 32 12 36 Z" fill="${v("shallot")}"/>
      <path d="M32 58 V62" fill="none" stroke-width="1.8"/>
      ${greenLeaf(28, 22, 5, "leaf")}${greenLeaf(36, 22, 5, "leaf-2")}</g>`,
  },
  tomates_sechees: { category: "conserve", label: "Tomates séchées", svg: jar("oil", "leaf-2", true, "tomato-2") },
  citron: {
    category: "fruit",
    label: "Citron",
    svg: `<g class="a-bob"><ellipse cx="26" cy="34" rx="19" ry="15" fill="${v("lemon")}"/><path d="M7 34 L3 33 M45 34 L49 33" fill="none" stroke-width="2.4"/>
      <circle cx="44" cy="44" r="13" fill="${v("lemon-2")}"/><circle cx="44" cy="44" r="9.5" fill="${v("lemon-pulp")}" stroke-width="1.6"/>
      <path d="M44 34.5 V53.5 M34.5 44 H53.5 M37.3 37.3 L50.7 50.7 M50.7 37.3 L37.3 50.7" fill="none" stroke="${v("lemon-2")}" stroke-width="1.4"/></g>`,
  },
  parmesan: {
    category: "laitier",
    label: "Parmesan",
    svg: `<g class="a-bob"><path d="M6 44 L44 16 L58 30 V48 Q58 52 54 52 H10 Q6 52 6 48 Z" fill="${v("cheese")}"/>
      <path d="M6 44 L44 16 L58 30 L20 44 Z" fill="${v("butter")}"/><path d="M44 16 L58 30" fill="none" stroke="${v("cheese-2")}" stroke-width="4"/>
      ${[
        [24, 47],
        [38, 46],
        [48, 42],
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="${v("cheese-2")}" stroke="none"/>`)
        .join("")}</g>`,
  },
  mozzarella: {
    category: "laitier",
    label: "Mozzarella",
    svg: `${bowl(`<path d="M10 34 Q12 24 32 24 Q52 24 54 34 Z" fill="${v("water")}"/>`, "plate")}
      <g class="a-bob"><circle cx="32" cy="24" r="14" fill="${v("paper")}"/><path class="a-shine" d="M24 18 Q27 14 31 13" fill="none" stroke="${v("water")}" stroke-width="2.2"/></g>`,
  },
  skyr: { category: "laitier", label: "Skyr", svg: jar("paper", "water-2", true, "water") },
  lait_demi: { category: "liquide", label: "Lait", svg: bottle("paper", "water-2", true, "water") },
  // Petit-déjeuner, en-cas (habitudes hors batch)
  banane: {
    category: "fruit",
    label: "Banane",
    svg: `<g class="a-wobble" style="transform-origin:50% 90%"><path d="M10 22 Q12 50 36 54 Q52 56 58 44 Q44 48 32 42 Q18 34 16 18 Z" fill="${v("lemon")}"/>
      <path d="M16 30 Q22 44 40 49" fill="none" stroke="${v("lemon-2")}" stroke-width="1.6"/>
      <path d="M10 22 L9 14 L16 16 L16 18" fill="${v("wood-2")}"/><path d="M58 44 L61 45" fill="none" stroke="${v("wood-2")}" stroke-width="3"/></g>`,
  },
  pomme: {
    category: "fruit",
    label: "Pomme",
    svg: `<g class="a-bob"><path d="M32 20 Q22 12 14 20 Q6 30 12 44 Q18 58 28 56 Q32 54 36 56 Q46 58 52 44 Q58 30 50 20 Q42 12 32 20 Z" fill="${v("lime")}"/>
      <path class="a-shine" d="M18 28 Q20 23 25 21" fill="none" stroke="${v("shine")}" stroke-width="2.4"/>
      <path d="M32 20 Q31 12 34 6" fill="none" stroke="${v("wood-2")}" stroke-width="2.6"/>${greenLeaf(40, 10, 4, "leaf-2")}</g>`,
  },
  yaourt: {
    category: "laitier",
    label: "Yaourt",
    svg: `<path d="M16 22 H48 L44 54 Q44 56 42 56 H22 Q20 56 20 54 Z" fill="${v("paper")}"/><rect x="14" y="16" width="36" height="7" rx="2" fill="${v("accent-illu")}"/>
      <path d="M18 34 H46" fill="none" stroke="${v("accent-illu")}" stroke-width="3"/>
      <g class="a-bob"><path d="M22 10 Q32 4 42 10 L40 14 H24 Z" fill="${v("cream")}"/></g>`,
  },
  pain: {
    category: "feculent",
    label: "Pain",
    svg: `<g class="a-bob"><path d="M6 46 Q2 40 10 34 L44 14 Q54 8 58 16 Q62 22 54 28 L20 48 Q12 52 6 46 Z" fill="${v("crust")}"/>
      ${[18, 30, 42].map((x, i) => `<path d="M${x} ${38 - i * 7} q4 -6 9 -5" fill="none" stroke="${v("grain")}" stroke-width="2.6"/>`).join("")}</g>`,
  },
  pain_complet: {
    category: "feculent",
    label: "Pain complet",
    svg: `<g class="a-bob"><path d="M8 52 V30 Q8 16 32 16 Q56 16 56 30 V52 Q56 56 52 56 H12 Q8 56 8 52 Z" fill="${v("crust")}"/>
      <path d="M14 52 V32 Q14 22 32 22 Q50 22 50 32 V52 Z" fill="${v("grain")}"/>
      ${[
        [22, 32],
        [34, 30],
        [42, 38],
        [26, 44],
        [38, 48],
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="${v("wood-2")}" stroke="none"/>`)
        .join("")}</g>`,
  },
  flocons_avoine: {
    category: "feculent",
    label: "Flocons d'avoine",
    svg: bowl(
      `<g class="a-bob">${[
        [16, 32],
        [24, 28],
        [32, 30],
        [40, 27],
        [48, 32],
        [28, 34],
        [40, 34],
      ]
        .map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="4.5" ry="3" fill="${v("grain")}"/>`)
        .join("")}</g>`,
      "wood",
    ),
  },
  whey: {
    category: "ingredient",
    label: "Protéine en poudre",
    svg: `${jar("steel-2", "iron", true, "paper")}<path d="M22 40 H42" fill="none" stroke="${v("tomato")}" stroke-width="3"/>
      <g class="a-bob"><path d="M44 10 L58 4 L60 8 L48 14 Z" fill="${v("steel")}"/><ellipse cx="44" cy="12" rx="5" ry="3" fill="${v("paper")}"/></g>`,
  },
  proteine_vegetale: {
    category: "ingredient",
    label: "Protéine végétale",
    svg: `${jar("leaf-2", "wood", true, "paper")}${greenLeaf(32, 40, 5, "leaf")}
      <g class="a-bob"><path d="M44 10 L58 4 L60 8 L48 14 Z" fill="${v("steel")}"/><ellipse cx="44" cy="12" rx="5" ry="3" fill="${v("paper")}"/></g>`,
  },
  confiture: { category: "sucre", label: "Confiture", svg: jar("tomato", "paper", true, "paper") },
  amandes: {
    category: "ingredient",
    label: "Amandes",
    svg: `<g class="a-bob">${[
      [20, 28, -20],
      [40, 24, 25],
      [30, 44, 10],
      [48, 42, -30],
    ]
      .map(([x, y, r]) => `<path d="M${x} ${y - 10} Q${x + 8} ${y} ${x} ${y + 10} Q${x - 8} ${y} ${x} ${y - 10} Z" transform="rotate(${r} ${x} ${y})" fill="${v("wood")}"/>`)
      .join("")}</g>`,
  },
  lait_coco: {
    category: "conserve",
    label: "Lait de coco",
    svg: can(`<circle cx="32" cy="34" r="7" fill="${v("coconut")}"/><circle cx="32" cy="34" r="4" fill="${v("paper")}" stroke="none"/>`, "leaf-2"),
  },
} satisfies Record<string, FoodArt>;

// Les génériques qui reprennent un dessin d'aliment.
const SAME: Partial<Record<keyof typeof FOODS, keyof typeof FOODS>> = {
  _oeuf: "oeuf",
  _feculent: "riz_basmati",
  _aromate: "ail",
  _herbe: "persil",
  _gras: "huile",
  _epice: "colombo",
  _condiment: "sauce_soja",
  _sucre: "sucre",
  _liquide: "eau",
};
for (const [k, from] of Object.entries(SAME)) FOODS[k as keyof typeof FOODS].svg = FOODS[from].svg;

export type FoodArtId = keyof typeof FOODS;
