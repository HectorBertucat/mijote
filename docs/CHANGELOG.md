# Journal des changements

## 2026-10-30 : douze recettes de batch cooking
- Douze fiches ajoutées à `src/seed/recipes/` (statut « à essayer ») : trois one pot d'orzo au poulet (épinards-parmesan, champignons-citron, épicé au chorizo), cannelloni bolognaise, gratin façon moussaka, poulet crémeux ail-parmesan, couscous poulet-merguez, dahl de pois cassés au poulet, butter chicken express, poulet au paprika fumé et patates douces, poulet basquaise, poulet teriyaki. Des classiques réécrits pour le batch cooking (source citée sur chaque fiche), autour de 145 kcal et 11 à 13 g de protéines par unité : environ 30 % des calories viennent des protéines.
- Table nutritionnelle : 17 aliments de plus (merguez, chorizo, bœuf haché 5 %, pois cassés, semoule, patate douce, épinards, aubergine, brocoli, navet, tomates séchées, citron, parmesan, mozzarella, skyr, lait demi-écrémé, lait de coco), valeurs Ciqual. Le calcul ne change pas (`NUTRITION_VERSION` inchangée).
- Un dessin pour chacun (`src/lib/illus/art.ts`), avec huit jetons de couleur `--i-*` de plus (aubergine, citron, pois cassés, patate douce, coco), admis aussi pour les dessins de l'IA.
- Tests : plafonds de durée mesurés pour les nouvelles paires de recettes (153 paires, toutes planifiées sans erreur) ; le test de la cuisine compte les fiches au lieu d'en attendre six.

## 2026-10-28 : guide visuel du rythme
- En séance guidée, une bille suit la courbe du tempo (comme l'écran d'une machine de sport) : on voit venir chaque phase, au même instant que la figure et les bips (`src/lib/training/rhythm.ts`, `RhythmGuide.tsx`).

## 2026-10-28 : import des recettes
- Les fichiers cachés d'un dossier de recettes (« ._recette.json » créés par les copies depuis macOS) sont ignorés au lieu de faire échouer l'import au démarrage.

## 2.1.0 (2026-10-28) : repère fixe, garde-fou

- **Repère fixe d'un repas** par personne (Santé › Profil, `people.fixed_meal_ref`, migration 0001) : il sert à la part de chaque recette tant que la dépense n'est pas mesurée ; la journée de la Semaine = deux repas + le hors batch.
- **Cuisine réappliquée** : les noms et notes donnés aux récipients restent, l'équipement ajouté à la main n'est pas retiré.
- **Garde-fou** (`.githooks/`, `scripts/check-private.mjs`) : refuse les secrets, les bases, les `.env`, les mentions d'IA en co-auteur et, si l'instance en a, les motifs privés de `perso/denylist.txt`.
- Contexte privé facultatif d'une instance (`perso/`, ignoré par git), chargé par `CLAUDE.md` s'il existe.

## 2.0.1 (2026-10-28) : prêt à publier

- **Courses sans catalogue, de bout en bout** : prix payé saisissable par ligne, « Tout cocher » et validation sans produit du catalogue ; le placard et les coûts suivent.
- **Catalogue d'exemple** (`examples/catalogue-csv`) qui sert un CSV de produits avec l'API attendue, et contrat documenté (`docs/catalogue.md`).
- **Programme de sport par l'IA** en deux appels (le programme, puis les figures) : le schéma complet dépassait la taille de grammaire de l'API ; budget de jetons ramené sous le seuil du streaming. Trouvé par le test réel.
- **Tests** : 227 tests (foyer, cuisine, accès, courses sans et avec catalogue, parcours IA avec faux client), test de fumée de l'appli construite (`pnpm test:smoke`), vérification des fonctions IA en vrai (`pnpm test:ai`), CI avec l'image Docker.

## 2.0.0 (2026-10-27) : Mijote, version open source

Première version publique, tirée d'une appli de batch cooking utilisée chaque semaine depuis septembre 2026.

- **Foyer réglable** : N personnes, créées à la mise en route (`/bienvenue`) et dans Réglages ; plus aucune personne en dur. La part de référence est celle du profil actif.
- **Cuisine réglable** : plaque (type, foyers, niveaux), four, récipients, à deux ou seul (`src/lib/kitchen/`) ; les récipients absents restent connus des recettes (`equipment.owned`).
- **Courses sans catalogue** : quantités par rayon (rayon deviné au nom), lignes cochables en magasin ; le catalogue de drive devient facultatif.
- **Sport** : programmes en base par personne (`training_programs`), modèles génériques, générateur sans IA, programmes sur mesure par l'IA avec exercices inventés et figures animées vérifiées (`motion-check.ts`).
- **Dessins d'aliments par l'IA**, filtrés par une liste blanche stricte (`src/lib/illus/sanitize.ts`).
- **Installation** : Docker et docker compose, mot de passe facultatif (`MIJOTE_PASSWORD`), import Apple Santé limité à la clé de chaque personne.
- Une seule migration initiale ; variables `MIJOTE_*`.
