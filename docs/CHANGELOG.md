# Journal des changements

## 2026-10-30 : session, téléphone d'abord
- La session s'ouvre sur une vue simple, pensée pour le téléphone (`src/components/session/Simple.tsx`, `SimpleDuo.tsx`) : trois temps plein écran, Prépare (tous les bols sur le plan de travail, aliments dessinés), Cuisine (une consigne à la fois, sous-étape en très grand, minuteur en pastille, « Suivant », « Ça sonne bientôt ») et Range (boîtes et frigo), une barre de progression en trois segments, un écran de transition entre les temps et une confirmation de fin. Une attente qui sonne ramène son étape au premier plan, dans l'écran lui-même.
- Le planificateur ne change pas. Le parcours vient d'un module pur (`src/lib/session/flow.ts` : temps en cours, avancement, ce qui sonne bientôt, une boîte par repas) ; la mise en boîtes est une note du journal (`boxed`, état `boxed` dans `state.ts`), partagée par tous les écrans.
- À deux : le fil de chacun sur son téléphone (`?personne=A`), les deux côte à côte sur grand écran (touches A et B).
- Grand écran : la vue simple par défaut, l'ancienne vue en option (`?vue=detail`, lien « Vue détaillée » du menu, « Vue simple » pour revenir). `?vue=telephone` garde la vue simple en plein écran. L'ancienne vue téléphone (`PhoneView.tsx`) est retirée.
- Clavier : espace = le bouton principal de l'écran (sauf sur un bouton qui a le focus), flèche gauche = retour.

## 2026-10-30 : habitudes hors batch
- Ce qu'une personne mange hors des repas du batch devient une seule source : ses **habitudes** (shaker, petit-déjeuner, en-cas), composées d'aliments de la table nutritionnelle, avec leurs jours. Les macros sont calculées en code (`src/lib/eaters/habits.ts`, testé dans `tests/habitudes.test.ts`). Ce sont les modèles du journal (`food_templates`, colonne `items`, migration `0002_habitudes`) : proposées d'office dans Santé › Aujourd'hui les jours prévus.
- Hors batch d'un jour = la somme des habitudes prises ce jour-là. Le repère d'un repas du batch prend la moyenne de la semaine (les parts sont cuites d'avance, identiques chaque jour) ; le bilan de la Semaine compte jour par jour (le shaker de semaine ne compte plus le dimanche). Sans habitude, le chiffre libre (`people.outside_kcal`) sert de repli, puis la valeur par défaut (20 % de la journée).
- Nouvelle page Santé › Hors batch (`/sante/habitudes`) : modèles « Shaker protéiné », « Petit-déjeuner classique », « Rien hors batch », éditeur d'aliments et de jours, hors batch jour par jour.
- Conseil déterministe (sans IA), sur cette page et dans la mise en route : avec la cible du jour, les repas du batch (ceux de la Semaine, sinon la part des recettes de la bibliothèque) et les habitudes, il dit ce qui manque (≥ 15 g de protéines ou ≥ 250 kcal par jour) et de quoi le couvrir (« il manque ~40 g de protéines par jour : un shaker le matin les couvre »), sinon qu'aucun complément n'est utile (`adviceOf`).
- Un hors batch non dit n'est plus un manque : plus d'alerte « part à affiner » pour lui, ni dans la mise en route ni dans la Semaine.
- Table nutritionnelle : banane, pomme, yaourt nature, pain, pain complet, flocons d'avoine, protéine en poudre (whey et végétale, étiquette moyenne), confiture, amandes, chacun avec son dessin. Le calcul ne change pas (`NUTRITION_VERSION` inchangée).

## 2026-10-30 : importer une recette depuis un texte collé
- Recettes › Importer (`/atelier/importer`) : on colle la légende d'un post ou la page d'un blog, avec son lien facultatif. Rien n'est téléchargé ni lu sur le réseau social : le texte collé suffit, le lien devient la source de la fiche (sans paramètres de suivi).
- Garde-fous en code, sans appel ni coût : texte vide, trop court ou sans quantités repérables refusé ; hashtags retirés ; texte tronqué au-delà de 6 000 caractères ; limite d'imports par jour (`AI_IMPORTS_PER_DAY`, 10 par défaut), coût estimé affiché.
- Un appel Haiku met la recette au format standard, avec le prompt système et le schéma de l'Atelier, pour un batch de 5 repas du foyer. Vérification de l'Atelier (catalogue, nutrition, sous-étapes) plus les quantités (`quantityIssues` : sans quantité, grammes et kcal par unité, taille du batch, aliments hors table) : une recette douteuse est enregistrée « à essayer » et « à relire » (`src/lib/atelier/import.ts`, `tests/importer.test.ts`).

## 2026-10-30 : Semaine, on choisit ses recettes et c'est tout
- La page Semaine se résume à choisir ses recettes dans la bibliothèque (filtres one pot, rapide, four, congèle, aimées, à essayer). Les quantités à cuire se calent toutes seules sur les repas (`autoSize` dans `src/lib/week/propose.ts`, jusqu'à `AUTO_MAX_FACTOR` = 2) et les repas se répartissent sans rien régler. « Compléter pour moi » garde les recettes choisies et ajoute le reste.
- Résumé simple (repas couverts, temps en cuisine) ; avertissements seulement s'il y a lieu (repas non couverts, part trop légère en protéines ou mal calée, récipient partagé). Absences, menu, unités et nutrition sont repliés.
- Présence par défaut : tout le monde mange à tous les repas, week-end compris (`defaultPlace`). Les semaines déjà créées gardent leur grille.
- « Part à affiner » n'apparaît plus quand seul le hors batch manque (une valeur par défaut sert).

## 2026-10-30 : panier du drive, ruptures complétées
- Après l'envoi au panier, ce que le drive n'a pas pu prendre (rupture, stock limité) est comparé au besoin de la liste et complété une fois par un autre produit du même type en stock, au moindre coût pour les grammes manquants (`shortfalls`, `pickSubstitute`, `completeShortfalls` dans `src/lib/shopping/drive.ts`). Une ligne « complément » s'ajoute à la liste, le panier est renvoyé puis relu ; ce qui manque encore est signalé (« manque au panier »).

## 2026-10-30 : recettes de base et dossier de l'instance
- Au démarrage, le dossier de recettes de l'instance (`MIJOTE_RECIPES_DIR`) s'ajoute à la bibliothèque de base (`src/seed/recipes`) au lieu de la remplacer : une instance qui a ses propres fiches reçoit aussi les nouvelles recettes de l'appli. Sur un même slug, la fiche de l'instance gagne (`recipesDirs()` dans `src/seed/bootstrap.ts`).

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
