// Filtre d'un dessin d'aliment proposé par l'IA, avant de le garder et de l'afficher (il est injecté
// tel quel dans un <svg>) : liste blanche stricte, tout le reste est refusé, pas « nettoyé ».
// - balises : g, path, circle, ellipse, rect, line, polyline, polygon ;
// - attributs de géométrie et de trait, `class` limité aux animations a-*, `transform` simple ;
// - couleurs : seulement les jetons du thème var(--i-…) (ILLU_TOKENS), « none » ou currentColor ;
// - pas de texte, de script, de lien, d'url(), d'entité ; `style` limité à transform-origin et --d ; 6 Ko au plus.
// Module pur (tests/illus.test.ts).

export const ILLU_TOKENS = [
  "accent-illu", "bay", "blade", "bone", "bottle", "butter", "butter-2", "carrot", "carrot-2", "cheese", "cheese-2", "chicken", "chicken-2", "chicken-roast",
  "cream", "cream-2", "crust", "curry", "egg", "fat", "fish", "fish-sauce", "flame", "foil", "garlic", "garlic-2", "ginger", "ginger-2", "glass", "glass-dark",
  "grain", "herb", "honey", "iron", "iron-2", "label", "leaf", "leaf-2", "lime", "lime-2", "lime-pulp", "line", "meat", "meat-2", "mush", "mush-2", "mustard",
  "oil", "onion", "onion-2", "paper", "pasta", "pasta-2", "plate", "potato", "potato-2", "rice", "sauce", "sausage", "seared", "shallot", "shallot-2", "shine",
  "soy", "steam", "steel", "steel-2", "tomato", "tomato-2", "water", "water-2", "wine", "wood", "wood-2", "yolk",
  "sweet-potato", "aubergine", "aubergine-2", "lemon", "lemon-2", "lemon-pulp", "split-pea", "coconut",
] as const;

export const ILLU_ANIMATIONS = ["a-bead", "a-bob", "a-bubble", "a-chop", "a-drip", "a-drop", "a-fall", "a-fill", "a-flip", "a-glow", "a-lid", "a-pop", "a-pour", "a-puff", "a-shake", "a-shimmer", "a-shine", "a-sink", "a-spin-slow", "a-squeeze", "a-steam", "a-stir", "a-sway", "a-swim", "a-swirl", "a-tick", "a-twist", "a-wave", "a-whisk", "a-wobble"] as const;

const TAGS = new Set(["g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon"]);
const NUM_ATTRS = new Set(["cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "stroke-width", "opacity", "fill-opacity", "stroke-opacity"]);
const COLOR_ATTRS = new Set(["fill", "stroke"]);
const OTHER_ATTRS = new Set(["d", "points", "class", "transform", "style", "stroke-linecap", "stroke-linejoin", "stroke-dasharray"]);
const TOKENS = new Set<string>(ILLU_TOKENS);
const ANIMS = new Set<string>(ILLU_ANIMATIONS);
export const MAX_SVG_BYTES = 6000;

const isColor = (v: string) => v === "none" || v === "currentColor" || (/^var\(--i-([a-z0-9-]+)\)$/.test(v) && TOKENS.has(v.slice(8, -1)));

function checkAttr(tag: string, name: string, value: string): string | null {
  if (NUM_ATTRS.has(name)) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < -20 || n > 90) return `${tag} ${name}="${value}" : nombre hors du cadre`;
    return null;
  }
  if (COLOR_ATTRS.has(name)) return isColor(value) ? null : `${tag} ${name}="${value}" : couleur hors des jetons var(--i-…)`;
  if (!OTHER_ATTRS.has(name)) return `attribut interdit : ${name}`;
  if (name === "d") return /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/.test(value) && value.length <= 2000 ? null : "chemin d invalide";
  if (name === "points") return /^[0-9.,\s-]+$/.test(value) ? null : "points invalides";
  if (name === "class") return value.split(/\s+/).every((c) => ANIMS.has(c)) ? null : `classe interdite : ${value}`;
  if (name === "transform") return /^((translate|rotate|scale)\([0-9.,\s-]+\)\s*)+$/.test(value) ? null : `transform invalide : ${value}`;
  if (name === "stroke-linecap" || name === "stroke-linejoin") return /^(round|butt|square|miter|bevel)$/.test(value) ? null : `${name} invalide`;
  // Seulement l'origine d'une animation (« transform-origin: 50% 90% ») et son décalage (« --d: .5s »).
  if (name === "style") return value.split(";").every((d) => !d.trim() || /^\s*(transform-origin:\s*\d{1,3}%\s+\d{1,3}%|--d:\s*\d*\.?\d+s)\s*$/.test(d)) ? null : "style : seulement transform-origin en % et --d";
  if (name === "stroke-dasharray") return /^[0-9.,\s]+$/.test(value) ? null : "pointillés invalides";
  return null;
}

/** Vérifie un fragment SVG ; rend le fragment normalisé, ou les erreurs. */
export function sanitizeIllu(raw: string): { svg: string; errors: [] } | { svg: null; errors: string[] } {
  const errors: string[] = [];
  const src = raw.trim().replace(/^<svg[^>]*>|<\/svg>$/g, "").trim();
  if (!src) return { svg: null, errors: ["dessin vide"] };
  if (new TextEncoder().encode(src).length > MAX_SVG_BYTES) return { svg: null, errors: [`dessin trop lourd (${MAX_SVG_BYTES} octets au plus)`] };
  const out: string[] = [];
  const stack: string[] = [];
  let shapes = 0;
  const re = /<\s*(\/?)\s*([a-zA-Z][\w:-]*)((?:\s+[a-zA-Z_:][\w:.-]*\s*=\s*"[^"<>]*")*)\s*(\/?)\s*>|([^<]+)|(<)/g;
  for (let m: RegExpExecArray | null; (m = re.exec(src)); ) {
    const [, close, tagRaw, attrs, selfClose, text, stray] = m;
    if (stray) {
      errors.push("balise mal formée");
      break;
    }
    if (text != null) {
      if (text.trim()) errors.push("texte interdit dans le dessin");
      continue;
    }
    const tag = tagRaw.toLowerCase();
    if (!TAGS.has(tag)) {
      errors.push(`balise interdite : <${tag}>`);
      continue;
    }
    if (close) {
      if (stack.pop() !== tag) errors.push(`fermeture inattendue : </${tag}>`);
      out.push(`</${tag}>`);
      continue;
    }
    const kept: string[] = [];
    for (const a of attrs.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"<>]*)"/g)) {
      const name = a[1].toLowerCase();
      const value = a[2].trim();
      if (/[&;]|url\s*\(|javascript:/i.test(value) && name !== "d" && name !== "style") {
        errors.push(`valeur interdite : ${name}`);
        continue;
      }
      const e = checkAttr(tag, name, value);
      if (e) errors.push(e);
      else kept.push(`${name}="${value}"`);
    }
    if (tag !== "g") shapes++;
    out.push(`<${tag}${kept.length ? ` ${kept.join(" ")}` : ""}${selfClose ? "/" : ""}>`);
    if (!selfClose) stack.push(tag);
  }
  if (stack.length) errors.push(`balise non fermée : <${stack.at(-1)}>`);
  if (shapes < 2) errors.push("il faut au moins deux formes");
  if (shapes > 40) errors.push("trop de formes (40 au plus)");
  return errors.length ? { svg: null, errors: [...new Set(errors)] } : { svg: out.join(""), errors: [] };
}

/** Clé d'un aliment dessiné : le nom de l'ingrédient sans quantité ni précision (« Poireaux, émincés » → « poireaux »). */
export function artKey(item: string): string {
  return item
    .split(/[,(]/)[0]
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 40);
}
