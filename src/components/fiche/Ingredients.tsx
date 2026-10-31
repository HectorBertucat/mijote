// Colonne d'ingrédients d'une fiche, comme dans un livre de cuisine : regroupés par bol (lettre en étiquette à la
// couleur du plat), quantité alignée à droite en chiffres serrés, dessin de l'aliment, nom, filet fin. Le placard
// est replié en bas. Sans état.
import { FoodIllu } from "@/components/illus/Illu";
import { Icon, Tape } from "@/components/ui";
import type { RecipeInput } from "@/lib/recipes/format";

type Ing = RecipeInput["ingredients"][number];
const NB = " ";

/** Quantité principale (« 1,5 kg », « 4 ») et son équivalent en grammes pour les pièces (« ≈ 120 g »). */
export function qtyParts(grams: number | null | undefined, units: number | null | undefined): { main: string; approx: string | null } {
  if (units != null && (grams == null || units < 10)) return { main: units.toLocaleString("fr-FR"), approx: grams != null ? `≈${NB}${Math.round(grams)}${NB}g` : null };
  if (grams != null) return { main: grams >= 1000 ? `${(grams / 1000).toLocaleString("fr-FR")}${NB}kg` : `${Math.round(grams)}${NB}g`, approx: null };
  return { main: "", approx: null };
}

/** « Champignons de Paris, en quartiers » → le produit, puis le geste en gris. */
function splitName(item: string): [string, string | null] {
  const m = item.match(/^(.+?)(\s*[,(].*)$/);
  return m ? [m[1], m[2].replace(/^\s*,\s*/, ", ").replace(/^\s*\(/, " (")] : [item, null];
}

function Row({ ing }: { ing: Ing }) {
  const q = qtyParts(ing.grams, ing.units);
  const [name, rest] = splitName(ing.item);
  return (
    <li className="grid grid-cols-[4.5rem_28px_minmax(0,1fr)] items-center gap-x-3 border-b border-line py-3">
      <span className="num-tight text-right text-body leading-tight">{q.main || "—"}</span>
      <FoodIllu food={ing.food} item={ing.item} size="s" />
      <span className="min-w-0 text-body leading-snug">
        {name}
        {rest && <span className="text-ink-2">{rest}</span>}
        {q.approx && <span className="num whitespace-nowrap text-small text-faint"> {q.approx}</span>}
        {ing.optional && <span className="label ml-2 whitespace-nowrap align-[1px] text-faint">facultatif</span>}
      </span>
    </li>
  );
}

export function IngredientTable({ ingredients, color }: { ingredients: Ing[]; color: string }) {
  const main = ingredients.filter((i) => !i.pantry);
  const pantry = ingredients.filter((i) => i.pantry);
  const groups = new Map<string | null, Ing[]>();
  for (const i of main) groups.set(i.group ?? null, [...(groups.get(i.group ?? null) ?? []), i]);
  const ordered = [...groups.entries()].sort(([a], [b]) => (a == null ? -1 : b == null ? 1 : a.localeCompare(b)));
  return (
    <div className="grid gap-6">
      {ordered.map(([letter, items]) => (
        <section key={letter ?? "—"} aria-label={letter ? `Bol ${letter}` : "Sans bol"}>
          <div className="mb-1 flex items-center gap-3">
            {letter ? (
              <Tape tint={color} seed={`bol-${letter}`}>
                Bol {letter}
              </Tape>
            ) : (
              <span className="label text-faint">Sans bol</span>
            )}
          </div>
          <ul className="border-t border-line-strong">
            {items.map((i, k) => (
              <Row key={`${k}-${i.item}`} ing={i} />
            ))}
          </ul>
        </section>
      ))}
      {pantry.length > 0 && (
        <details className="group">
          <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 border-y border-line text-body font-semibold text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
            <Icon name="chev" size="s" className="text-ink-2 transition-transform duration-[var(--dur-2)] ease-[var(--ease-out)] group-open:rotate-90" />
            Au placard, à vérifier chez toi
            <span className="num ml-auto text-ink-2">{pantry.length}</span>
          </summary>
          <ul>
            {pantry.map((i, k) => (
              <Row key={`${k}-${i.item}`} ing={i} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
