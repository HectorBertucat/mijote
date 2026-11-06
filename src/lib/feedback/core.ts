// Retours de goût (pur, testé : tests/gouts.test.ts) : ce que chacun a pensé d'un plat après l'avoir mangé,
// une note (j'adore, ok, bof) et des étiquettes rapides (sec, trop dense…). Le plus récent de chacun compte.
//
// Règles :
// - une recette notée « bof » par quelqu'un est « à ajuster » tant qu'aucune variante de sa famille n'est
//   née après ce retour ; la Semaine la pousse en fin de liste et ne la propose plus d'office (`tastePenalty`) ;
// - une variante née après le retour est l'ajustement : la pastille la nomme ;
// - « j'adore » et « je referais » la font remonter un peu ;
// - les étiquettes négatives des retours en cours (pas « j'adore ») sont ce qu'il faut corriger (adjust.ts).

export const RATINGS = ["love", "ok", "meh"] as const;
export type Rating = (typeof RATINGS)[number];
export const RATING_LABEL: Record<Rating, string> = { love: "j’adore", ok: "ok", meh: "bof" };

export const TASTE_TAGS = ["sec", "dense", "fade", "epice", "gras", "portion", "referais"] as const;
export type TasteTag = (typeof TASTE_TAGS)[number];
export const TAG_LABEL: Record<TasteTag, string> = {
  sec: "sec",
  dense: "trop dense",
  fade: "fade",
  epice: "trop épicé",
  gras: "trop gras",
  portion: "portion trop grosse",
  referais: "je referais",
};
/** Les étiquettes qui demandent un ajustement (« je referais » n'en demande pas). */
export const ISSUE_TAGS: readonly TasteTag[] = ["sec", "dense", "fade", "epice", "gras", "portion"];

export const isTag = (x: string): x is TasteTag => (TASTE_TAGS as readonly string[]).includes(x);
export const NOTE_MAX = 500;

export interface Feedback {
  id: string;
  recipeId: string;
  personId: string;
  name: string;
  rating: Rating;
  tags: TasteTag[];
  note: string | null;
  /** Instant ISO. */
  at: string;
}

/** Le retour le plus récent de chaque personne, dans l'ordre des personnes vues d'abord (le plus récent en tête). */
export function latestByPerson<T extends Pick<Feedback, "personId" | "at">>(list: T[]): T[] {
  const out = new Map<string, T>();
  for (const f of [...list].sort((a, b) => b.at.localeCompare(a.at))) if (!out.has(f.personId)) out.set(f.personId, f);
  return [...out.values()];
}

/** « Sam : bof · sec, trop dense » ; `withNote` ajoute le mot libre entre guillemets. */
export function feedbackLine(f: Pick<Feedback, "name" | "rating" | "tags" | "note">, withNote = false): string {
  const tags = f.tags.map((t) => TAG_LABEL[t]).join(", ");
  const note = withNote && f.note ? ` « ${f.note} »` : "";
  return `${f.name} : ${RATING_LABEL[f.rating]}${tags ? ` · ${tags}` : ""}${note}`;
}

/** Les étiquettes à corriger, d'après les retours en cours (sans « j'adore »), les plus citées d'abord. */
export function issuesOf(latest: Pick<Feedback, "rating" | "tags">[]): TasteTag[] {
  const n = new Map<TasteTag, number>();
  for (const f of latest) if (f.rating !== "love") for (const t of f.tags) if (ISSUE_TAGS.includes(t)) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || ISSUE_TAGS.indexOf(a[0]) - ISSUE_TAGS.indexOf(b[0])).map(([t]) => t);
}

export interface FamilyRecipe {
  id: string;
  slug: string;
  name: string;
  /** La racine (null : c'est une racine). */
  parentId: string | null;
  createdAt: string;
  status?: string;
}

/** Ce que la Semaine montre d'une recette : qui l'adore, qui la trouve bof, et si elle a été ajustée depuis. */
export interface TasteMark {
  slug: string;
  love: string[];
  meh: string[];
  /** Étiquettes négatives des retours en cours. */
  issues: TasteTag[];
  /** Une variante de la famille née après le dernier « bof » : l'ajustement. */
  adjusted: { slug: string; name: string } | null;
  /** Quelqu'un « referait ». */
  again: boolean;
}

/** Les marques de goût par slug, d'après tous les retours (une recette sans retour n'en a pas). */
export function tasteMarks(recipes: FamilyRecipe[], feedback: Feedback[]): Map<string, TasteMark> {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const rootOf = (r: FamilyRecipe) => r.parentId ?? r.id;
  const out = new Map<string, TasteMark>();
  const byRecipe = new Map<string, Feedback[]>();
  for (const f of feedback) byRecipe.set(f.recipeId, [...(byRecipe.get(f.recipeId) ?? []), f]);
  for (const [id, list] of byRecipe) {
    const r = byId.get(id);
    if (!r) continue;
    const latest = latestByPerson(list);
    const meh = latest.filter((f) => f.rating === "meh");
    const lastMeh = meh.map((f) => f.at).sort().pop() ?? null;
    const adjusted = lastMeh
      ? (recipes
          .filter((x) => x.id !== r.id && rootOf(x) === rootOf(r) && x.status !== "archived" && x.createdAt > lastMeh)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null)
      : null;
    out.set(r.slug, {
      slug: r.slug,
      love: latest.filter((f) => f.rating === "love").map((f) => f.name),
      meh: meh.map((f) => f.name),
      issues: issuesOf(latest),
      adjusted: adjusted ? { slug: adjusted.slug, name: adjusted.name } : null,
      again: latest.some((f) => f.tags.includes("referais")),
    });
  }
  return out;
}

/** Points ajoutés au score de la Semaine (plus = moins proposé) : un « bof » pèse plus qu'une recette à essayer. */
export const MEH_PENALTY = 8;
export const LOVE_BONUS = 1.5;
export function tastePenalty(m: TasteMark | undefined): number {
  if (!m) return 0;
  return m.meh.length * MEH_PENALTY - m.love.length * LOVE_BONUS - (m.again ? 0.5 : 0);
}

/** Rang de tri dans la bibliothèque de la Semaine : adorée d'abord, « bof » pas ajustée en dernier. */
export function tasteRank(m: TasteMark | undefined): number {
  if (!m) return 0;
  if (m.meh.length) return 2;
  return m.love.length || m.again ? -1 : 0;
}

/** La pastille de la Semaine : « Sam : bof (sec) », « ajustée », « Alex adore ». */
export function tasteBadge(m: TasteMark | undefined): { tone: "ok" | "warn" | "info"; text: string } | null {
  if (!m) return null;
  if (m.meh.length) {
    const why = m.issues.length ? ` (${m.issues.slice(0, 2).map((t) => TAG_LABEL[t]).join(", ")})` : "";
    const who = m.meh.join(" et ");
    return m.adjusted ? { tone: "info", text: `${who} : bof${why}, variante ajustée` } : { tone: "warn", text: `${who} : bof${why}` };
  }
  if (m.love.length) return { tone: "ok", text: `${m.love.join(" et ")} ${m.love.length > 1 ? "adorent" : "adore"}` };
  return null;
}

/** Une ligne compacte pour l'assistant et l'atelier : « Sam bof (sec, trop dense) ; Alex j'adore ». */
export function compactLine(latest: Pick<Feedback, "name" | "rating" | "tags" | "note">[]): string {
  return latest
    .map((f) => {
      const tags = f.tags.map((t) => TAG_LABEL[t]);
      const note = f.note ? `« ${f.note.slice(0, 80)} »` : null;
      const extra = [...tags, ...(note ? [note] : [])].join(", ");
      return `${f.name} ${RATING_LABEL[f.rating]}${extra ? ` (${extra})` : ""}`;
    })
    .join(" ; ");
}
