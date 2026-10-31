# Journal des changements

## 2026-10-31 : pause des minuteurs, prénoms à deux, polices et base au démarrage
- Session : chaque minuteur se met en pause et repart (bouton « Pause » sur le cadran de la vue simple, dans « Ça sonne bientôt » et dans la liste de la vue détaillée), et « Tout mettre en pause » / « Tout reprendre » quand on doit s’absenter. Deux événements au journal, `timer_pause` et `timer_resume` (rejoués par chaque écran, synchronisés par le flux SSE) ; la reprise repousse la fin prévue du temps passé en pause, « ↺ » en tient compte, un minuteur en pause ne sonne pas et son étape reste « en fond ». Logique pure dans `src/lib/session/state.ts` (`timerEnd`, `liveTimer`, `storedEnd`, `originalEnd`), testée (`tests/session-pause.test.ts`). Pas de migration : la colonne `kind` est un texte.
- Session à deux : A et B prennent le prénom des deux premiers membres du foyer (fils, pastilles avec l’initiale, relais, durées du jour J, avis des autres écrans) ; sans prénom, en double ou avec la même initiale, les lettres restent (`src/lib/session/people.ts`, testé).
- Polices servies par l’appli (`next/font/local`, `src/app/fonts/`) : Archivo (wght 100–900, wdth 62–125) et Atkinson Hyperlegible Next (wght 200–800), sous-ensemble latin, avec leur licence OFL. Le build ne dépend plus de Google Fonts.
- Base : `PRAGMA journal_mode = WAL` peut répondre « database is locked » sans attendre quand plusieurs processus ouvrent une base neuve (workers de `next build`) ; il est maintenant réessayé (`setWal`, `src/lib/db/open.ts`). Reproduit avec 20 processus sur une base neuve : 2 échecs sur 2 000 ouvertures avant, aucun après.

## 2026-10-31 : écran de lancement, visite guidée et premiers pas
- Écran de lancement (`src/components/tour/LaunchSplash.tsx`) : le mot-symbole au centre du papier, la vapeur monte de la cocotte, puis fondu vers l'appli en 660 ms. Une fois par lancement pour l'appli installée, une seule fois par appareil dans un navigateur, jamais avec `prefers-reduced-motion` ; il ne bloque jamais le toucher et reste caché sans script.
- Images de démarrage iOS : `/lancement?w=…&h=…&theme=clair|sombre` (la cocotte seule sur le papier ou l'encre), une par écran d'iPhone et d'iPad connu (`src/lib/launch.ts`), déclarées dans `appleWebApp.startupImage` ; route ouverte sans connexion. Manifeste aux couleurs du papier (`#f3f1ec`).
- Visite guidée de l'accueil (`src/components/tour/Tour.tsx`, étapes dans `src/lib/tour/core.ts`) : le cycle de A à Z (choisir, acheter, cuisiner, ranger, Santé, recherche ⌘K au bureau, profil à partir de deux personnes, premiers pas). Chaque bulle se pose à côté du vrai élément (`data-tour` sur les onglets, la recherche, le profil), le reste voilé ; les étapes sans élément s'ouvrent au centre avec leurs dessins (`DishBox`, `FoodIllu`, `StepIllu`). « Passer », Échap, flèches, focus gardé dans la bulle. Proposée une fois après la mise en route (pas à une instance qui a déjà cuisiné), relancée par Réglages › La prise en main ou `/?visite=1`.
- Premiers pas sur l'accueil (`src/components/accueil/FirstSteps.tsx`) : régler sa part, choisir les plats, faire la liste, lancer une session, ranger les boîtes ; cochés d'après ce que l'instance a vraiment fait (`src/lib/tour/store.ts`), la liste disparaît quand tout est fait ou se masque (Réglages la remet).
- État par instance dans `app_settings` (`tour.seen`, `tour.firststeps.hidden`), sans migration. Tests : `tests/visite.test.ts` ; le test de fumée vérifie l'accueil, `/?visite=1`, Réglages et les images de démarrage.

## 2026-10-31 : refonte « Carnet de marché », finitions de direction artistique
- Le petit visuel d'un plat (`RecipeTile`) n'est plus un monogramme : c'est sa boîte de verre sur un carré de nappe vichy, partout où il restait (accueil, semaine, recherche, coûts, journal…).
- Micro-typographie : `typo()` (`src/lib/typo.ts`, testé) pose l'apostrophe courbe, les espaces insécables avant « : ; ? ! », dans les guillemets et entre un nombre et son unité, à l'affichage des fiches (nom, description, ingrédients, étapes, repères) et des consignes de session ; les textes de l'interface passent à l'apostrophe courbe.
- Fiche : plus de mot « unité » à l'écran (on parle en repas).
- Liste de courses : le titre est le jour (« Courses du 30 octobre »), les plats passent dessous.
- Frigo vide : une phrase et l'action, alignées comme le reste, au lieu de l'état vide centré.

## 2026-10-31 : courses, placard et coûts au « Carnet de marché »
- Liste de courses refaite comme une vraie liste à cocher : par rayon (étiquette et compteur « 2 sur 6 »), une ligne = case de 28 px dans une cible de 48, dessin de l'aliment, quantité en chiffres serrés, nom, prix aligné à droite. Cocher répond tout de suite, sans coche animée ni barré qui se trace.
- Un seul signal par ligne, et seulement quand il faut agir (`signalOf` dans `CartList.tsx`) : introuvable, rupture, à vérifier (un vrai doute), souci du panier drive, vérification en cours. Plus de « en stock », « vérifié il y a 8 h » ni « au panier » en pastilles. Marque, besoin, paquets et choix d'un autre produit passent dans le détail de la ligne (feuille).
- En-tête de liste : titre démesuré, total en `num-xl`, avancement en filet cocotte ; « Avant de valider » ne garde que les lignes à traiter (lien vers la ligne), la boucherie en une phrase. Vérification en direct et panier drive en sections sobres (étiquette à filet, chiffres, la couleur seulement pour ce qui manque). Ticket de caisse gardé après validation, en Archivo serrée et sans ombre.
- Index des listes, placard et coûts au même langage : en-têtes `display`, rangées de chiffres séparés par des filets, tableaux à filets aux chiffres tabulaires, boîte du plat (`DishBox`) à gauche des coûts (plus de monogramme), explication des coûts derrière « Comment c'est calculé ». Montants et poids avec espace insécable (`cart/format.ts`). Pièces de mise en page dans `src/components/cart/Carnet.tsx`.
## 2026-10-31 : session et frigo au système « Carnet de marché »
- Session, vue simple : la consigne en Atkinson très grand (`.sx-consigne`), les cadrans lus à un mètre en Archivo serrée géante (`.sx-giant` : minuteur, niveau du foyer avec ses neuf crans, four), l'étiquette du plat et l'étape en cours en cocotte ; « Ça sonne bientôt » en lignes à filets (et au-dessus de la consigne sur téléphone quand ça sonne dans moins de 2 min), « Ensuite » sur une ligne. Grille de 12 sur grand écran (consigne 7, à côté 5 ; prep et rangement en 4/8).
- Transitions des trois temps et confirmation de fin : un aplat d'encre plein écran, le numéro du temps en chiffre géant et le titre en `display`. Un minuteur qui sonne : aplat tomate (la seule urgence), la consigne qui suit et le temps écoulé en géant ; même aplat pour l'alarme de la vue détaillée.
- Fin de session : le frigo dessiné et le cachet « Fait maison », « Le frigo est plein. » en très grand, la durée réelle, les étiquettes des plats ; puis « Peser, puis ranger » en filets (grammes par boîte en chiffres serrés, bouton de cuisine).
- La boîte du plat (`DishBox`, rendue par les pages serveur) remplace le monogramme au rangement, à la pesée et au frigo ; en petit (vue détaillée, repli), une boîte simple aux couleurs du plat (`src/components/boxes/BoxGlyph.tsx`).
- Frigo : frigo et congélo en 7/5, la plus pressée d'abord et en une phrase en tête, date limite en grand à droite (« demain », « jusqu'au 29 janv. »), boîtes pareilles regroupées (« ×3 »), « Je la mange » plein d'encre seulement sur la plus pressée, plus de pastilles.
- Vue détaillée allégée : étiquettes `.label`, espacements et rayons à l'échelle, sous-étape en cours en cocotte (plus en tomate), consigne en Atkinson ; plus de verre dépoli sur la barre du bas.
- Mouvement (`src/components/session/session.css`, chargé par la page) : la consigne suivante glisse de 8 px (200 ms), ce qui sonne remonte en 280 ms, rien au clavier, fondus seuls avec `prefers-reduced-motion`.

## 2026-10-31 : « Carnet de marché » pour les réglages, la mise en route, la connexion, l'atelier et le kit
- Mise en route (`/bienvenue`, `src/app/bienvenue/Onboarding.tsx`) : une question par écran (qui mange, la cuisine en sept questions et un résumé, où se font les courses), la question en titre démesuré, l'aide concrète en marge sur bureau et repliée sur téléphone, trois temps en filets pour la progression. Le dernier écran enregistre les courses et ouvre l'appli (Santé › Mise en route).
- Réglages : un document à sections à filets (titre à gauche, contenu à droite), le foyer en lignes (prénom corrigé sur place), la cuisine en résumé dont chaque ligne ouvre sa question. Plus de marque dans les exemples de champ.
- Connexion au mot-symbole, en grand ; sélecteur de profil de l'en-tête réduit aux initiales, au langage des rubriques.
- Atelier et import : zone de collage (bouton « Coller » si le navigateur le permet), « ce qui se passe » en trois temps, aperçu au langage de la fiche (étiquette du plat, ingrédients par bol, étapes), avertissements et vérifications en lignes nettes au lieu de bandeaux et de pastilles.
- `/kit` : vitrine du système v3 (couleurs, typographie, espacements, rayons et ombre, mouvement, ton) avant les composants, posés sur des filets.

## 2026-10-31 : Santé en carnet
- Santé passe au système « Carnet de marché » : plus de cartes blanches en grille, des sections à filet (`Section`), de l’air et des mises en page asymétriques (5/7, 8/4, 7/5). Petits composants de zone dans `src/components/sante/carnet.tsx` : chiffre clé (`KeyFigure`), verdict en mot (`Verdict`), note à filet (`Note`), ligne de définition (`Row`), explication repliée (`HowCalc`), élision (`de`).
- Vue d’ensemble : la tendance du poids, la cible du jour et les protéines en très grand (Archivo serrée) ; courbe du poids en un trait d’encre, pesées en points discrets, sans aplat, dessinée à la largeur réelle (axes lisibles sur téléphone), un repère par mois ; barres d’activité d’encre. Les explications de calcul passent derrière « Comment c’est calculé ».
- Onglets de Santé soulignés d’encre comme les Tabs du kit ; en-tête « Santé · objectif » et le prénom en `h1`.
- Coach : fil sobre (« Toi », « Coach »), proposition sous un filet d’encre avec « avant → après », corrections de l’appli sur filet `warn` avec leur mot, réponses rapides en lignes.
- Aujourd’hui, Hors batch, Mise en route, Profil, Apple Santé, Entraînement : listes à filets, chiffres clés, étapes numérotées en grand, verdicts en mots plutôt qu’en pastilles.
- Séance guidée : chiffre héros plus grand, phase en titre large, barres d’avancement plates, « Ensuite » sans panneau ; le chrono de repos tient dans sa colonne ; les mots du guide de rythme ne se chevauchent plus. Figures, bips et horloges inchangés.

## 2026-10-31 : Semaine et Composer au « Carnet de marché »
- Semaine : la période en titre démesuré, avec ses flèches et « Changer la période » ; grille 4/8 au bureau, la semaine choisie à gauche (trois chiffres : repas couverts, temps en cuisine, repas au congélo ; tes plats ; avertissements en lignes sobres, seulement s'il y en a) et la bibliothèque à droite, en grandes entrées qui se cochent (la coche suit le geste tout de suite), chaque plat dessiné en boîte sur sa nappe (`DishBox`, ingrédients lus par `src/components/semaine/dishes.ts`).
- Une barre d'action collante, le seul élément qui flotte : « 2 plats · 24 repas sur 28 » et l'action suivante (proposer la semaine, faire ou refaire la liste, voir la liste, puis « Cuisiner dimanche » quand les courses sont commandées).
- Absences, menu, quantités, nutrition et paquets entamés repliés sous des filets ; les explications de calcul passent derrière « Comment c'est calculé ». Le menu de la semaine quitte l'ardoise pour des étiquettes d'étiqueteuse sur la couleur du plat (et l'image partagée suit).
- Composer au même langage : titre en grand, bibliothèque en entrées à cocher avec leur boîte, résumé en trois chiffres, avertissements en lignes, « Lancer la session » en bleu cocotte, unités et associations en lignes à filet.
- Pièces de zone : `src/components/semaine/Pick.tsx` (entrée à cocher), `Parts.tsx` (`Figures`, `Notice`, `Fold`, `HowTo`, `Dock`).

## 2026-10-31 : fiche recette et bibliothèque au « Carnet de marché »
- Fiche : en tête, le plat en héros (sa boîte `DishBox` sur la nappe vichy), le nom en très grand et trois chiffres seulement (temps actif, kcal de la part du profil avec son verdict, prix de la part ou, sans prix, le nombre de repas). Au bureau, grille 5/7 : ingrédients en tableau (quantité à droite en chiffres serrés, dessin, nom, filet), regroupés par bol sous une étiquette à la couleur du plat ; étapes à numéros très grands, repères (récipient, feu, four, durée, bols) en une ligne sans puces.
- Nutrition, coût, En boîtes, variantes, notes et produits en sections à filets (titre sur 4 colonnes, contenu sur 8). Les explications de calcul passent sous « Comment c’est calculé ». Plus de rangée d'étiquettes ni de cachets décoratifs (« Nouveau », « De saison », « Se congèle ») : ces repères deviennent une ligne de texte. Sur téléphone, onglets Ingrédients, Étapes, Chiffres, Notes, Produits.
- Bibliothèque : liste éditoriale en tableau (la boîte du plat à la place du monogramme, temps actif, part du profil, deux repères au plus) au lieu de cartes, filtres en mots soulignés, recherche « un plat, un ingrédient ».
- Nouveaux composants de la fiche dans `src/components/fiche/` (`Block.tsx`, `Figures.tsx`, `Ingredients.tsx`, `words.ts`) ; `listDishRecipes` (`src/lib/recipes/queries.ts`) lit de quoi dessiner toutes les boîtes en deux requêtes. `StepItem` (partagé avec l'atelier) suit le même dessin. Recherche ⌘K aux rayons et à l'ombre du système. Aucun calcul ne change.

## 2026-10-31 : l'accueil, la semaine en un regard
- `/` n'est plus une redirection vers les recettes : un tableau de bord en 7/5 (une colonne au téléphone). Le titre dit la semaine en chiffres (« 4 plats, 28 repas, 4 h 20 demain. »), puis une seule action en cocotte, choisie en code (`src/lib/home/next.ts`, testé) : reprendre la session, choisir les plats, couvrir les repas qui manquent, faire la liste, faire les courses, cuisiner, ouvrir le frigo une fois la session finie.
- À côté : les repas du jour du profil actif (calories, protéines, le conseil s'il manque quelque chose), le frigo (boîtes regroupées par plat, la plus pressée d'abord, le congélo s'il reste de la place), l'état des courses. En bas, la période jour par jour, midi et soir.
- Lecture dans `src/lib/home/store.ts` (`homeView`), sur les modules existants (semaine, boîtes, courses, session, mangeurs). La fumée vérifie aussi `/`.

## 2026-10-31 : la boîte, visuel des plats
- `dishArt(recipe)` (`src/lib/illus/dish.ts`, pur, testé dans `tests/dish.test.ts`) compose la boîte d'un plat à partir de ses ingrédients et de ses étapes : la sauce (couleur `--i-*` tirée de la tomate, de la crème, du curry, du coco, du laqué soja-miel, de la moutarde, du bouillon), la garniture (les 2 ou 3 ingrédients les plus lourds, hors oignon, ail, farine et fromage, avec leur dessin `foodArt`), le compartiment du féculent cuit à part (`side`, ou riz et semoule, ou bouilli à part sans rejoindre la cocotte) avec le légume cuit à part, et la touche finale (herbe, citron, sésame). Quatre modèles : garni, mijoté, velouté, gratiné (fromage et cuisson au plat). Même recette, même boîte ; la variante `without` enlève un ingrédient ; un aliment sans dessin prend un morceau générique.
- `<DishBox recipe size="sm|md|lg|hero" />` (`src/components/ui/dish.tsx`, composant serveur) : la boîte de verre de trois quarts, couvercle cocotte (`--c-accent`), sur la nappe vichy de la couleur de la recette (`vichy()`, en CSS sur `--c-bg`). `hero` : bande plein cadre avec vapeur ; `live` l'anime (rien avec `prefers-reduced-motion`). `role="img"`, nom du plat en `aria-label`. Elle remplacera le monogramme de `RecipeTile` dans les pages.
- Démonstration : `/kit/boites` (les recettes de `src/seed/recipes`, toutes les tailles), ajoutée au test de fumée.

## 2026-10-31 : système graphique « Carnet de marché » (fondation)
- Nouveau système graphique, décrit dans `docs/design/systeme.md` : audit de la v2, références, direction, polices, palette, espacements, rayons, ombre, grille, ton et mouvement.
- Jetons : papier `#F3F1EC`, encre `#15161A`, filets, une seule ombre (`--sh-float`) pour ce qui flotte, échelle de texte `display / h1 / h2 / h3 / lead / body / small / label / num-xl`, trois rayons, mouvement en `--dur-1/2/3/sheet` et courbes `--ease-out`, `--ease-sheet`.
- Deux polices seulement : Archivo (titres larges, chiffres et étiquettes serrés) et Atkinson Hyperlegible Next. Caveat est retirée : rubans et ardoise deviennent des étiquettes d'étiqueteuse (classe `.label`).
- Kit : bouton principal plein encre, variante `accent` réservée à l'action du moment, cartes sans ombre, puces et onglets sobres, champs et tiroirs aux nouveaux rayons. Seuls les boutons s'enfoncent à la pression ; entrée décalée des listes avec `.reveal`.
- En-tête : mot-symbole à la cocotte (`Wordmark`), rubriques en texte soulignées d'encre, sans couleur par rubrique ; un seul bouton de thème ; barre d'onglets à cinq rubriques (le Composer reste accessible par son adresse).

## 2026-10-30 : la cuisine, pas à pas
- Description de la cuisine en parcours guidé (mise en route et Réglages) : une question par écran, choix par défaut, « Je ne sais pas » toujours possible (rubrique « à vérifier » au récapitulatif), aides « comment savoir » et « comment mesurer ».
- Plaque : type, préréglages courants (3 foyers dont un grand de 28 cm, 4, 2, 5 foyers ; feux de gaz), diamètre de chaque foyer, dessin de la plaque à l'échelle. Four : gradins, chaleur tournante. Poêles (inox, fonte, antiadhésive ; diamètre ; la fournée suit la taille), casseroles (diamètre, contenance), faitout et cocotte (contenance, passe au four), plats à four. Appareils : air fryer (contenance), mixeur plongeant, blender, petit hachoir, robot, autocuiseur, cuiseur à riz, balance.
- Nouveau format du réglage `kitchen` (`KitchenConfig` dans `src/lib/kitchen/presets.ts`, relu par `normalizeKitchen`) ; l'ancien format est traduit sans perte. Compatibilités foyer × récipient d'après les tailles réelles (`vesselFitsHob`), casseroles rangées sur le rôle de leur taille (une seule grande casserole = `casserole-18`). Un nom de récipient jamais retouché suit la description ; un nom donné à la main reste.
- Planificateur (`PLAN_VERSION` 4) : l'air fryer (`air-fryer`, appareil) est un récipient, sans foyer ni four ; rechange four ↔ air fryer avec conversion de la température et de la durée (`convertForSwap`), seulement si l'étape tient dans le panier. Noms courts des casseroles : petite, moyenne, grande. Documenté dans docs/recettes.md.
- Tests : `tests/cuisine.test.ts` (préréglages, compatibilités, ancien format, air fryer dans le plan).

## 2026-10-30 : session, téléphone d'abord
- La session s'ouvre sur une vue simple, pensée pour le téléphone (`src/components/session/Simple.tsx`, `SimpleDuo.tsx`) : trois temps plein écran, Prépare (tous les bols sur le plan de travail, aliments dessinés), Cuisine (une consigne à la fois, sous-étape en très grand, minuteur en pastille, « Suivant », « Ça sonne bientôt ») et Range (boîtes et frigo), une barre de progression en trois segments, un écran de transition entre les temps et une confirmation de fin. Une attente qui sonne ramène son étape au premier plan, dans l'écran lui-même.
- Le planificateur ne change pas. Le parcours vient d'un module pur (`src/lib/session/flow.ts` : temps en cours, avancement, ce qui sonne bientôt, une boîte par repas) ; la mise en boîtes est une note du journal (`boxed`, état `boxed` dans `state.ts`), partagée par tous les écrans.
- À deux : le fil de chacun sur son téléphone (`?personne=A`), les deux côte à côte sur grand écran (touches A et B).
- Grand écran : la vue simple par défaut, l'ancienne vue en option (`?vue=detail`, lien « Vue détaillée » du menu, « Vue simple » pour revenir). `?vue=telephone` garde la vue simple en plein écran. L'ancienne vue téléphone (`PhoneView.tsx`) est retirée.
- Clavier : espace = le bouton principal de l'écran (sauf sur un bouton qui a le focus), flèche gauche = retour.

## 2026-10-30 : grammes par boîte et stock du frigo
- Fin de session : on pèse chaque marmite cuite (et le riz ou la semoule à part), l'appli dit combien de boîtes pour chacun et combien de grammes dans chaque (« Alex 3 boîtes de 705 g + 250 g de riz »), sans parler d'unités. Une boîte par repas prévu dans la Semaine, puis la marge tour à tour ; la marmite est toujours entièrement répartie. Même calculette sur la fiche recette (« En boîtes »).
- Garniture cuite à part : nouveau champ facultatif `side` des lignes de recette (format, `recipe_ingredients.side`), posé sur le riz et la semoule de six fiches. Plat et garniture de chacun sont réglés pour viser kcal et protéines (deux poids, deux cibles), le rapport garniture / plat borné entre la moitié et le double de celui de la marmite ; repli sur la proportion simple sans repère ou sans le poids de la garniture (`splitPot`, `sideRatio` dans `src/lib/boxes/core.ts`, tests `tests/boxes.test.ts`).
- Stock de boîtes (table `meal_boxes`, migration 0003) : « Ranger les boîtes » en fin de session les crée (recette, pour qui, grammes, macros figées, date de cuisson), au frigo si le repas prévu tombe dans les jours de conservation, sinon au congélo (si la recette se congèle) ; la marge va au congélo. Nouvelle page **Frigo** (onglet de la navigation) : les boîtes par lieu, la plus pressée d'abord, avec leur date limite ; « Je la mange » l'inscrit au journal de Santé du profil de l'appareil, « Au congélo », « Sortir au frigo » (à manger le lendemain), « Jetée ».

## 2026-10-30 : Semaine, période libre
- La page Semaine choisit sa période « du … au … » (1 à 14 jours), avec des raccourcis 1 semaine, 10 jours, 2 semaines (« Changer la période », feuille avec deux champs date). La session a lieu la veille du premier jour (`COOK_DAY`).
- Migration `0003_periode` : `week_plans.days` (7 par défaut) ; `week_start` devient le premier jour, n'importe quel jour ; `meal_slots.day` va de 0 à `days − 1`. Les semaines existantes restent des semaines du lundi, sur 7 jours.
- Logique pure dans `src/lib/week/period.ts` : jours et libellés, lecture « du … au … » (plafond `MAX_DAYS` = 14), période par défaut (celle en cours tant qu'il reste plus de 3 jours, puis la suivante), navigation bout à bout, présences gardées à la même date quand la période bouge (`remapPlaces`).
- `setPeriod` (`src/lib/week/store.ts`) allonge, raccourcit ou déplace la période ; les recettes restent, les quantités se recalent. La présence par défaut suit le jour de la semaine de la date (`defaultPlace(weekday, …)`).
- Grille par rangées de 7 jours, menu, nutrition jour par jour (`weekNutrition(…, length)`), journal de Santé (`plannedMeals` trouve la période qui contient le jour) et listes de courses (« du 5 au 14 novembre ») suivent la période.

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
