// Goûts respectés par la proposition : ce que chacun n'aime pas (table preferences), et les
// recettes de la bibliothèque qui en contiennent (jamais servies à cette personne).
import type { DislikeRule } from "@/lib/week/tastes";
import { joinFr } from "@/lib/week/tastes";
import { Icon } from "@/components/ui";

export function TastesNote({
  rules,
  dislikes,
  names,
  recipeNames,
  selected,
}: {
  rules: DislikeRule[];
  dislikes: Map<string, Map<string, string[]>>;
  names: Record<string, string>;
  recipeNames: Record<string, string>;
  selected: string[];
}) {
  const people = [...new Set(rules.map((r) => r.personId))].sort((a, b) => (names[a] ?? a).localeCompare(names[b] ?? b, "fr"));
  if (!people.length) return null;
  const hits = [...dislikes].flatMap(([slug, m]) => [...m].map(([who, what]) => ({ slug, who, what })));
  return (
    <div className="flex items-start gap-2.5 rounded-[12px] bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-2">
      <Icon name="check" size="s" className="mt-0.5 text-ok" />
      <div className="grid min-w-0 gap-0.5">
      <p>
        <b className="text-ink">Goûts respectés :</b>{" "}
        {people
          .map((p) => `sans ${joinFr(rules.filter((r) => r.personId === p).map((r) => r.label))} pour ${names[p] ?? p}`)
          .join(" ; ")}
        .
      </p>
      {hits.length === 0 ? (
        <p>Aucune recette de la bibliothèque n&apos;en contient.</p>
      ) : (
        <ul className="grid gap-0.5">
          {hits.map((h) => (
            <li key={`${h.slug}:${h.who}`}>
              {recipeNames[h.slug] ?? h.slug} ({joinFr(h.what)}) : {selected.includes(h.slug) ? `jamais servi à ${names[h.who] ?? h.who}` : `écarté des repas de ${names[h.who] ?? h.who}`}.
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  );
}
