// Les textes du plan : un titre court et complet pour chaque étape, le détail à part, et le foyer du
// texte remis d'accord avec celui que le planificateur a choisi. Module pur (tests/session-texte.test.ts).

/** Positions hors parenthèses d'un texte (un titre ne se coupe jamais dans une parenthèse). */
function depthAt(text: string): number[] {
  const out: number[] = [];
  let d = 0;
  for (const ch of text) {
    if (ch === "(") d++;
    out.push(d);
    if (ch === ")") d = Math.max(0, d - 1);
  }
  return out;
}

const TITLE_MAX = 72;

/**
 * Titre et détail d'une étape : la première phrase ; trop longue, elle se coupe aux deux-points, puis
 * à la première virgule, toujours hors parenthèse ; une parenthèse qui reste trop longue passe dans le
 * détail. Rien n'est tronqué au milieu d'un mot ni d'une parenthèse.
 */
export function splitTitle(text: string): { title: string; detail: string } {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return { title: "", detail: "" };
  const depth = depthAt(t);
  // Première phrase : un point (ou ! ?) hors parenthèse suivi d'une majuscule, d'un chiffre ou de la fin.
  let end = -1;
  for (let i = 0; i < t.length; i++) {
    if (depth[i] === 0 && /[.!?]/.test(t[i]) && (i === t.length - 1 || (t[i + 1] === " " && /[A-ZÀ-Ý0-9«(]/u.test(t[i + 2] ?? "")))) {
      // « 1,5 fois », « c. à s. » : un point d'abréviation n'est pas une fin de phrase.
      if (/\b(?:c|s|env|min|cf)\.$/i.test(t.slice(Math.max(0, i - 4), i + 1))) continue;
      end = i;
      break;
    }
  }
  let title = end >= 0 ? t.slice(0, end) : t.replace(/[.!?]$/, "");
  let detail = end >= 0 ? t.slice(end + 1).trim() : "";
  const cutAt = (re: RegExp, min: number) => {
    const d = depthAt(title);
    for (const m of title.matchAll(re)) {
      const i = m.index!;
      if (i >= min && i <= TITLE_MAX && d[i] === 0) return { at: i, len: m[0].length };
    }
    return null;
  };
  if (title.length > TITLE_MAX) {
    const c = cutAt(/ : /g, 8) ?? cutAt(/, /g, 12) ?? cutAt(/ ; /g, 12);
    if (c) {
      const rest = title.slice(c.at + c.len).trim();
      detail = [rest.charAt(0).toUpperCase() + rest.slice(1), detail].filter(Boolean).join(rest.endsWith(".") ? " " : ". ");
      title = title.slice(0, c.at);
    }
  }
  if (title.length > TITLE_MAX) {
    // Les parenthèses partent dans le détail.
    const parens = [...title.matchAll(/\s*\(([^()]*)\)/g)];
    if (parens.length) {
      title = title.replace(/\s*\([^()]*\)/g, "");
      const notes = parens.map((m) => m[1].trim()).filter(Boolean);
      detail = [notes.map((n) => n.charAt(0).toUpperCase() + n.slice(1)).join(". "), detail].filter(Boolean).join(". ");
    }
  }
  title = title.replace(/[\s,;:]+$/, "").trim();
  detail = detail.trim();
  if (detail && !/[.!?…]$/.test(detail)) detail += ".";
  return { title, detail };
}

const HOB_WORDS = /\b(?:le |du |au )?(grand foyer|foyer moyen|petit foyer|foyer \d)\b/gi;

/**
 * Le texte d'une étape dit le foyer choisi par le planificateur : « Cocotte sur le foyer moyen » devient
 * « Cocotte sur le grand foyer » quand la cocotte n'entre que sur le grand. Seulement si le texte ne parle
 * que d'un foyer (sinon, il parle d'autre chose).
 */
export function rewriteHob(text: string, hobName: string | null | undefined): string {
  if (!hobName) return text;
  const found = new Set([...text.matchAll(HOB_WORDS)].map((m) => m[1].toLowerCase()));
  if (found.size !== 1) return text;
  const name = hobName.toLowerCase();
  if (found.has(name)) return text;
  return text.replace(HOB_WORDS, (m, h: string) => {
    const prefix = m.slice(0, m.length - h.length);
    return `${prefix}${h[0] === h[0].toUpperCase() ? hobName : name}`;
  });
}
