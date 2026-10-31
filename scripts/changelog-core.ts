// Journal en fragments : une PR ajoute docs/changelog.d/AAAA-MM-JJ-sujet.md au lieu d'écrire en tête
// de docs/CHANGELOG.md (deux PR parallèles n'entrent plus en conflit). Fonctions pures, testées.

export const FRAGMENTS_DIR = "docs/changelog.d";
export const JOURNAL = "docs/CHANGELOG.md";
const NAME = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

export type Fragment = { name: string; text: string };

/** Les fichiers du dossier qui sont des fragments (le README n'en est pas un). */
export const isFragmentFile = (name: string) => name.endsWith(".md") && name !== "README.md";

/** Ce qui ne va pas dans un fragment (vide si tout va bien). */
export function checkFragment({ name, text }: Fragment): string[] {
  const m = NAME.exec(name);
  if (!m) return [`${name} : nom attendu AAAA-MM-JJ-sujet.md (minuscules, chiffres, tirets)`];
  const date = m[1];
  const errors: string[] = [];
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) errors.push(`${name} : date ${date} invalide`);
  const lines = text.trim().split("\n");
  if (!lines[0].startsWith(`## ${date} : `) || lines[0].length <= `## ${date} : `.length) errors.push(`${name} : la première ligne doit être « ## ${date} : titre »`);
  if (lines.slice(1).some((l) => /^#{1,2} /.test(l))) errors.push(`${name} : un seul titre « ## », en première ligne`);
  if (!lines.some((l) => l.startsWith("- "))) errors.push(`${name} : au moins une ligne « - … »`);
  return errors;
}

/** Plus récent d'abord (par date, puis par nom). */
export const sortFragments = (fs: Fragment[]) => [...fs].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));

/** Le journal avec les fragments versés avant la première entrée (sous le titre et son chapeau). */
export function fold(journal: string, fragments: Fragment[]): string {
  if (!fragments.length) return journal;
  if (!journal.startsWith("# ")) throw new Error(`${JOURNAL} doit commencer par un titre « # »`);
  const at = journal.search(/^## /m);
  const head = (at < 0 ? journal : journal.slice(0, at)).trimEnd();
  const rest = at < 0 ? "" : journal.slice(at);
  return [head, "", ...sortFragments(fragments).map((f) => f.text.trim() + "\n"), rest].join("\n").trimEnd() + "\n";
}
