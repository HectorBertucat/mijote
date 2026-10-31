// À deux : le plan ne connaît que « A » et « B ». L'écran les montre sous le prénom des deux premiers
// membres du foyer, avec leur initiale dans la pastille ; sans prénom, la lettre reste.
import type { Handoff, Person } from "./planner";

export interface DuoPerson {
  /** Prénom, ou la lettre du plan. */
  name: string;
  /** Ce qu'on écrit dans la pastille : l'initiale, ou la lettre si les deux initiales se confondent. */
  mono: string;
}
export type DuoNames = Record<Person, DuoPerson>;

export const LETTERS: DuoNames = { A: { name: "A", mono: "A" }, B: { name: "B", mono: "B" } };

const initial = (name: string) => [...name][0]?.toLocaleUpperCase("fr") ?? "";

/** A = le premier prénom, B = le second (ordre du foyer) ; un prénom manquant ou en double garde la lettre. */
export function duoNames(names: (string | null | undefined)[]): DuoNames {
  const [a, b] = names.map((n) => n?.trim() || null);
  if (!a && !b) return LETTERS;
  const nameA = a ?? "A";
  const nameB = b && b.toLocaleLowerCase("fr") !== a?.toLocaleLowerCase("fr") ? b : "B";
  const [ia, ib] = [initial(nameA), initial(nameB)];
  const same = ia === ib;
  return { A: { name: nameA, mono: same ? "A" : ia }, B: { name: nameB, mono: same ? "B" : ib } };
}

/** « de Sam », « d’Alex » ; la lettre seule : « de A ». */
export const ofName = (name: string) => (name.length > 1 && /^[aeiouyhàâéèêîôû]/i.test(name) ? `d’${name}` : `de ${name}`);

/** Le relais (« A libère le faitout pour B ») avec les prénoms : le texte du plan est réécrit. */
export function handoffLine(h: Pick<Handoff, "from" | "to" | "text">, names: DuoNames): string {
  const head = `${h.from} libère `;
  const tail = ` pour ${h.to}`;
  if (!h.text.startsWith(head) || !h.text.endsWith(tail)) return h.text;
  return `${names[h.from].name} libère ${h.text.slice(head.length, -tail.length)} pour ${names[h.to].name}`;
}
