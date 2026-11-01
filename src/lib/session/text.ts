// Les textes d'une étape. Côté planificateur : un titre court et complet pour chaque étape, le détail à
// part, et le foyer du texte remis d'accord avec celui choisi (tests/session-texte.test.ts). Côté écran :
// la consigne en tête et le reste, un titre qui ne coupe jamais une phrase au milieu d'une parenthèse, et
// les bols cités (« bol G ») repérés pour en faire des pastilles (tests/session-guide.test.ts). Pur.
import { typo } from "@/lib/typo";
import type { PlanStep } from "./planner";

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
    // « Pendant que la sauce mijote : poêle vide… » : le moment seul ne dit pas quoi faire, on garde le geste.
    const ctx = /^(?:pendant|dès|quand|une fois|à \d|après|avant)\b/i.test(title) ? cutAt(/ : /g, 8) : null;
    const after = ctx ? cutAt(/, /g, ctx.at + 3) : null;
    const c = after ?? cutAt(/ : /g, 8) ?? cutAt(/, /g, 12) ?? cutAt(/ ; /g, 12);
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


/** Profondeur des parenthèses à chaque position : un découpage ne tombe jamais dedans. */
function outside(text: string, at: number): boolean {
  let depth = 0;
  for (let i = 0; i < at; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth = Math.max(0, depth - 1);
  }
  return depth === 0;
}

const cap = (s: string) => s.charAt(0).toLocaleUpperCase("fr") + s.slice(1);

/**
 * Les fiches ont des étapes longues (jusqu'à 370 signes) : la première phrase se lit en très
 * grand, le reste en dessous. Une première phrase trop longue se coupe aux deux-points (hors
 * parenthèses) ; une parenthèse finale trop longue passe dans le reste.
 */
export function splitStep(text: string): { head: string; rest: string } {
  const t = text.trim();
  const m = t.match(/^(.{12,}?[.!?])\s+(?=[A-ZÀ-Ý0-9«(])/u);
  let head = m && outside(t, m[1].length) ? m[1] : t;
  let rest = head === t ? "" : t.slice(m![0].length);
  head = head.replace(/\.$/, "");
  if (head.length > 90) {
    const p = head.match(/^(.{15,}?)\s*\(([^()]{8,})\)$/u);
    if (p) {
      rest = `${cap(p[2].trim())}.${rest ? ` ${rest}` : ""}`;
      head = p[1];
    }
  }
  if (head.length > 120) {
    let c = head.indexOf(" : ");
    while (c >= 0 && !outside(head, c)) c = head.indexOf(" : ", c + 1);
    if (c > 15 && c < 100) {
      rest = `${cap(head.slice(c + 3))}. ${rest}`.trim();
      head = head.slice(0, c);
    }
  }
  // Affichage : micro-typographie (apostrophe courbe, espaces insécables) appliquée après le découpage.
  return { head: typo(head), rest: typo(rest) };
}

/**
 * Raccourcit un texte pour un titre ou un bouton : d'abord sans ses parenthèses, puis à la dernière
 * articulation (virgule, deux-points, point-virgule), sinon au dernier mot avec « … ». Jamais au milieu
 * d'une parenthèse.
 */
export function clip(text: string, max = 64): string {
  let t = text.trim().replace(/\.$/, "");
  if (t.length <= max) return t;
  t = t.replace(/\s*\([^()]*\)/g, "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max + 1);
  const cuts = [...head.matchAll(/\s*[,:;–]\s/g)].map((x) => x.index!).filter((i) => i >= max * 0.4 && outside(t, i));
  if (cuts.length) return t.slice(0, cuts[cuts.length - 1]).trim();
  let w = head.lastIndexOf(" ", max - 1);
  if (w < max * 0.4) w = max - 1;
  let out = t.slice(0, w).trim();
  const open = out.lastIndexOf("(");
  if (open > 0 && !outside(out, out.length)) out = out.slice(0, open).trim();
  return `${out.replace(/[,:;–]$/, "").trim()}…`;
}

/** Titre court d'une étape (le fil, « ensuite », les boutons) : la consigne de tête, raccourcie proprement. */
export function stepTitleOf(step: Pick<PlanStep, "text" | "kind">, max = 64): string {
  if (step.kind === "preheat") {
    const temp = step.text.match(/(\d+)\s*°C/)?.[1];
    if (temp) return typo(`Préchauffe le four à ${temp} °C`);
  }
  return clip(splitStep(step.text).head, max);
}

export type TextPart = { t: "text"; v: string } | { t: "bowl"; v: string };

/**
 * Les bols cités dans une consigne (« bol G », « (bol A) », « bols K et L ») : la lettre devient une
 * pastille, le reste reste du texte. Seules les lettres des bols du plan comptent.
 */
export function bowlParts(text: string, letters: Iterable<string>): TextPart[] {
  const known = new Set(letters);
  const out: TextPart[] = [];
  const push = (v: string) => {
    if (!v) return;
    const last = out[out.length - 1];
    if (last?.t === "text") last.v += v;
    else out.push({ t: "text", v });
  };
  const re = /\b([Bb]ols?)(\s+)([A-Z](?:\s*(?:,|et|\+)\s*[A-Z])*)(?![\p{L}\d])/gu;
  let at = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index!;
    push(text.slice(at, i));
    push(m[1] + m[2]);
    for (const piece of m[3].split(/(\s*(?:,|et|\+)\s*)/)) {
      if (/^[A-Z]$/.test(piece) && known.has(piece)) out.push({ t: "bowl", v: piece });
      else push(piece);
    }
    at = i + m[0].length;
  }
  push(text.slice(at));
  return out;
}
