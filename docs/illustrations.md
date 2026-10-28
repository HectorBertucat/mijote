# Illustrations animées (gestes et aliments)

Des SVG animés partout dans la partie cuisine, et **jamais d'étape ni d'aliment sans dessin**.

## Où
- Dessins : `src/lib/illus/art.ts` (`ACTIONS` pour les gestes, `FOODS` pour les aliments et un générique `_famille` par catégorie). Fragments SVG 64 × 64, trait commun `--i-line`, couleurs en jetons `--i-*` (`src/components/illus/illus.css`), jamais en dur (le test le vérifie).
- Choix du dessin : `src/lib/illus/resolve.ts`, pur et testé (`tests/illus.test.ts`).
  - Aliment : id de la table nutritionnelle (`food`), sinon le nom (`NAME_RULES`), sinon la famille devinée au nom (`CATEGORY_RULES` → `_viande`, `_legume`…), sinon `_ingredient`.
  - Geste : premier verbe de la première phrase (`ACTION_RULES`), sinon le type d'étape. `boil`, `bake`, `rest`, `cool` gardent leur geste sauf exceptions (`KIND_LOCK`).
- Composants : `FoodIllu` et `StepIllu` (`src/components/illus/Illu.tsx`, serveur ou client). `live` anime ; sinon le dessin bouge au survol. `prefers-reduced-motion` coupe tout.
- Planche vivante : `/kit/dessins`.

## Où ils apparaissent
Session : étape en cours (grand, sur pastille de la couleur de la recette, animé quand l'étape est lancée), sous-étape en cours, étape suivante, bols à prendre, étapes en fond, gestes et bols de la prep, vue téléphone. Fiche : chaque ingrédient, chaque étape. Liste des recettes : les 5 ingrédients principaux.

## Ajouter un dessin (à chaque nouvelle recette)
1. `pnpm illus:coverage` : liste, recette par recette, le dessin choisi pour chaque ingrédient et chaque étape ; les lignes `?` tombent sur un générique.
2. Ajouter l'entrée dans `FOODS` (id = id de la table nutritionnelle quand il existe, catégorie, libellé, SVG) ou une règle dans `NAME_RULES` / `ACTION_RULES`.
3. `pnpm illus:coverage --html /tmp/planche.html` pour voir la planche, `pnpm test`.

Classes d'animation disponibles (illus.css) : a-steam, a-glow, a-shimmer, a-bead, a-pop, a-flip, a-stir, a-pour, a-lid, a-bubble, a-chop, a-fall, a-whisk, a-swirl, a-shake, a-tick, a-spin-slow, a-sink, a-fill, a-drop, a-bob, a-wobble, a-sway, a-shine, a-puff, a-squeeze, a-drip, a-twist, a-wave, a-swim. Le dessin au repos (sans animation) doit se suffire.

## Dessins de l'IA
Sur une fiche recette, les aliments qui tombent sur un dessin générique sont listés, avec un bouton « Dessiner avec l'IA » (`src/lib/illus/ai.ts`). Le dessin proposé passe une liste blanche stricte (`src/lib/illus/sanitize.ts`, testé) : balises de formes seulement, couleurs limitées aux jetons `--i-*`, classes limitées aux animations a-*, `style` limité à `transform-origin` et `--d`, rien d'autre. Refusé, il repart une fois à l'IA avec ses erreurs ; sinon le générique reste. Les dessins gardés sont dans la table `food_art` et s'affichent partout (`CustomArtProvider` dans le layout).
