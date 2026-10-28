# IA

L'IA est **facultative**. Sans `ANTHROPIC_API_KEY`, les boutons IA sont désactivés et tout le reste marche : recettes, semaine, courses, session, nutrition, coûts, santé, et le générateur de programmes de sport.

## Ce qu'elle fait, et ce qui est vérifié

| Fonction | Modèle | Ce que l'IA rend | Ce que le code vérifie avant de garder |
|---|---|---|---|
| Ajuster une recette | Sonnet | la recette complète modifiée | macros recalculées depuis les grammes, équipement réel, sous-étapes, ingrédients connus de la table nutritionnelle, produits du catalogue s'il y en a un |
| Atelier (créer) | Sonnet | une recette complète | la même chose, plus les doublons de la bibliothèque (une seconde tentative si trop proche) |
| Coach (Santé › Objectifs) | Sonnet | une réponse et des objectifs | rythme −1 à +0,5 %/sem., protéines 1,2 à 2,4 g/kg, poids visé dans un IMC sain, jamais sous le métabolisme de base |
| Programme de sport | Sonnet (2 appels) | les séances, puis la figure des exercices inventés | ids de la bibliothèque, matériel, séries et repos bornés, durée, chaque figure résolue par le squelette ; une figure refusée repart une fois, sinon l'exercice est remplacé |
| Dessiner un aliment | Sonnet | un fragment SVG | liste blanche stricte (balises, couleurs du thème, animations) ; refusé, il repart une fois |
| Estimer un repas | Haiku | kcal et macros | marqué « estimation » dans le journal |

Tous les appels passent par `structured()` (`src/lib/ai/index.ts`) : un schéma de sortie imposé (sorties JSON structurées), le contexte stable en cache (profil, équipement, goûts, table nutritionnelle), et une ligne par appel dans `ai_calls` (modèle, jetons, coût, écran, durée, erreur).

## Coût

Mesuré le 28/10/2026 avec `pnpm test:ai`, une fois chaque fonction :

| Fonction | Durée | Coût |
|---|---|---|
| Ajuster une recette | ~85 s | 0,16 $ |
| Créer une recette | ~60 s | 0,10 $ |
| Coach, un message | ~15 s | 0,02 $ |
| Programme de sport | ~50 s | 0,09 $ |
| Deux dessins d'aliments | ~15 s | 0,02 $ |
| Estimer un repas | ~3 s | moins de 0,001 $ |

Un usage normal (quelques ajustements et messages au coach par semaine) reste sous 5 $ par mois. `AI_MONTHLY_CAP_USD` (10 $ par défaut) coupe les boutons IA au-delà, jusqu'au mois suivant. La page Coûts montre la dépense du mois.

## Tester

- `pnpm test` : tous les parcours IA avec un **faux client** (réponse juste, fausse puis corrigée, fausse deux fois, plafond atteint), sans réseau ni coût (`tests/ia-parcours.test.ts`, `tests/atelier.test.ts`).
- `pnpm test:ai` : chaque fonction appelée **en vrai** sur une base jetable, et sa sortie contrôlée comme le fait l'appli. Il faut une clé ; compter environ 0,40 $. `pnpm test:ai programme` n'en lance qu'une.
- `MIJOTE_AI_MOCK=1` (hors production) : l'appli rend des réponses simulées, pour développer l'interface sans clé.

## Changer de modèle

Les ids et les prix sont dans `src/lib/ai/pricing.ts`.
