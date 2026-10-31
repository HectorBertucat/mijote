# IA

L'IA est **facultative**. Sans `ANTHROPIC_API_KEY`, les boutons IA sont désactivés et tout le reste marche : recettes, semaine, courses, session, nutrition, coûts, santé, et le générateur de programmes de sport.

## Ce qu'elle fait, et ce qui est vérifié

| Fonction | Modèle | Ce que l'IA rend | Ce que le code vérifie avant de garder |
|---|---|---|---|
| Ajuster une recette | Sonnet | la recette complète modifiée | macros recalculées depuis les grammes, équipement réel, sous-étapes, ingrédients connus de la table nutritionnelle, produits du catalogue s'il y en a un |
| Atelier (créer) | Sonnet | une recette complète | la même chose, plus les doublons de la bibliothèque (une seconde tentative si trop proche) |
| Assistant (partout, ⌘I) | Haiku ; Sonnet pour composer toute la semaine | une réponse en flux, et jusqu'à trois actions par outils stricts | chaque action revérifiée par `checkAction` (`src/lib/assistant/core.ts`) : existence, bornes, cohérence nutritionnelle ; chiffres des cartes calculés par le code ; appliquée d'un geste, revérifiée, puis exécutée par les fonctions de l'interface |
| Coach (Santé › Objectifs) | Sonnet | une réponse et des objectifs | rythme −1 à +0,5 %/sem., protéines 1,2 à 2,4 g/kg, poids visé dans un IMC sain, jamais sous le métabolisme de base |
| Programme de sport | Sonnet (2 appels) | les séances, puis la figure des exercices inventés | ids de la bibliothèque, matériel, séries et repos bornés, durée, chaque figure résolue par le squelette ; une figure refusée repart une fois, sinon l'exercice est remplacé |
| Dessiner un aliment | Sonnet | un fragment SVG | liste blanche stricte (balises, couleurs du thème, animations) ; refusé, il repart une fois |
| Importer une recette | Haiku | une recette complète, depuis un texte collé | garde-fous avant l'appel (texte vide, trop court, sans quantités, limite du jour) ; puis comme l'Atelier, plus les quantités (grammes et kcal par unité, taille du batch) : « à relire » si elles sont douteuses |
| Estimer un repas | Haiku | kcal et macros | marqué « estimation » dans le journal |

Tous les appels passent par `structured()` ou `chat()` (`src/lib/ai/index.ts`) : un schéma imposé (sorties JSON structurées, ou outils stricts dont l'entrée est revalidée), le contexte stable en cache (profil, équipement, goûts, table nutritionnelle), et une ligne par appel dans `ai_calls` (modèle, jetons, coût, écran, durée, erreur).

## L'assistant

Un bouton dans l'en-tête (⌘I ou Ctrl I, ou « Demander » dans ⌘K) ouvre un panneau, en feuille du bas sur téléphone. Il sait sur quelle page on est (fiche recette ouverte, semaine affichée) et qui parle (profil de l'appareil).

- **Contexte compact, construit en code** (`buildContext`) : pour chaque personne, objectif, cible du jour, repère d'un repas, repas moyen du batch, habitudes hors batch et le conseil de l'appli ; la semaine et sa liste de courses ; la bibliothèque avec la part de chacun déjà calculée ; le frigo ; les aliments possibles d'une habitude. Pas de dump de base.
- **Cache** : le texte d'instructions et le contexte du foyer sont deux blocs du system, chacun avec un point de cache (outils compris) ; la page et la question vont dans le message. Mesuré : ~4 500 jetons écrits en cache au premier message, relus au suivant.
- **Modèle** : Haiku par défaut (répondre et proposer une ou deux actions sur un contexte déjà chiffré), effort bas. Sonnet seulement pour composer toute la semaine ou pour un long message (`pickModel`) : arbitrer plusieurs recettes entre les cibles de chacun, c'est planifier (règle 1).
- **Actions** : `ajouter_recette`, `retirer_recette`, `ajouter_habitude`, `retirer_habitude`, `manger_boite`, `faire_courses`. Une action écartée par la vérification reste visible avec sa raison ; le modèle la voit dans l'historique.
- **Conversation** : par personne (`assistant_messages`), 30 messages gardés, 12 envoyés ; « Repartir de zéro » la vide. Une question sans réponse (erreur, plafond) n'est pas gardée et revient dans le champ.
- **Plafond** : vérifié avant chaque appel ; atteint, le panneau le dit (« l'assistant reprend le mois prochain »).

## Coût

Mesuré le 28/10/2026 avec `pnpm test:ai`, une fois chaque fonction :

| Fonction | Durée | Coût |
|---|---|---|
| Ajuster une recette | ~85 s | 0,16 $ |
| Créer une recette | ~60 s | 0,10 $ |
| Assistant, un message (Haiku, 31/10/2026) | quelques secondes | ~0,001 $ |
| Coach, un message | ~15 s | 0,02 $ |
| Programme de sport | ~50 s | 0,09 $ |
| Deux dessins d'aliments | ~15 s | 0,02 $ |
| Estimer un repas | ~3 s | moins de 0,001 $ |
| Importer une recette | ~30 s (estimé) | environ 0,003 $ (estimé, affiché avant l'appel) |

Un usage normal (quelques ajustements et messages au coach par semaine) reste sous 5 $ par mois. `AI_MONTHLY_CAP_USD` (10 $ par défaut) coupe les boutons IA au-delà, jusqu'au mois suivant. La page Coûts montre la dépense du mois. L'import de recettes a en plus une limite par jour : `AI_IMPORTS_PER_DAY` (10 par défaut), chaque appel compte, réussi ou non.

## Tester

- `pnpm test` : tous les parcours IA avec un **faux client** (réponse juste, fausse puis corrigée, fausse deux fois, plafond atteint), sans réseau ni coût (`tests/ia-parcours.test.ts`, `tests/atelier.test.ts`, `tests/importer.test.ts`).
- `pnpm test:ai` : chaque fonction appelée **en vrai** sur une base jetable, et sa sortie contrôlée comme le fait l'appli. Il faut une clé ; compter environ 0,40 $. `pnpm test:ai programme` n'en lance qu'une.
- `MIJOTE_AI_MOCK=1` (hors production) : l'appli rend des réponses simulées, pour développer l'interface sans clé.

## Changer de modèle

Les ids et les prix sont dans `src/lib/ai/pricing.ts`.
