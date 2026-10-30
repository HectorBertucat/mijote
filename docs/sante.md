# Module Santé

Une page par partie, sous `/sante/…` (liste dans `src/components/sante/SanteNav.tsx`). Le calcul est pur dans `src/lib/health/core.ts` et `goals.ts` (tests `tests/sante.test.ts`), la base dans `store.ts`.

## Principe
- **Cible adaptative** (méthode MacroFactor) : dépense = apports moyens des journées complètes − variation de la tendance × 7 700 kcal/kg, sur 21 jours. Mise à jour chaque lundi. Il faut au moins 4 journées complètes par tranche de 7 jours et une pesée par semaine ; sinon « en attente » (dernière dépense mesurée) ; sans mesure du tout, « estimation » (Mifflin-St Jeor × activité). Un jour non complet est ignoré, jamais compté comme zéro.
- **Cible** = dépense + rythme visé (% du poids par semaine × 7 700 / 7), bouge d'au plus 150 kcal par semaine.
- **Tendance du poids** : moyenne exponentielle à 10 % par jour, jours sans pesée sautés.
- **Protéines** : grammes fixes ou g/kg de la tendance (1,6 par défaut).
- **Part d'un repas** (`src/lib/eaters/`) : (cible du jour ± tolérance − ce qui est mangé hors batch) / 2 ; la part de chaque recette en unités en découle, bornée entre 60 et 160 % de la part de base.
- **Hors batch** (`src/lib/eaters/habits.ts`, pur) : les habitudes de la personne (aliments de la table nutritionnelle × grammes, avec leurs jours). Hors batch d'un jour = somme des habitudes prises ce jour-là ; le repère d'un repas prend la moyenne de la semaine (parts identiques chaque jour), le bilan de la Semaine compte jour par jour. Sans habitude : le chiffre libre (`people.outside_kcal`), puis 20 % de la journée par défaut, sans alerte.
- **Conseil** (`adviceOf`, sans IA) : cible du jour − 2 repas moyens du batch (Semaine en cours, sinon part des recettes de la bibliothèque) − hors batch. À partir de 15 g de protéines ou 250 kcal par jour, il propose un shaker ou un petit-déjeuner ; sinon il dit qu'aucun complément n'est utile.
- **Profils** : les personnes du foyer, sélecteur dans la barre du haut (cookie par appareil, `src/lib/health/active.ts`).

## Les pages
- **Vue d'ensemble** : poids et tendance, rythme réel et visé, cible de la semaine et son explication, tour de taille.
- **Démarrer** (`/sante/demarrer`) : ce qui manque pour une part juste, le formulaire (hors batch : les habitudes, ou un chiffre), ce qui en découle et le conseil.
- **Aujourd'hui** : repas prévus de la Semaine cochés en un tap, habitudes du jour proposées d'office, journal par repas, « Journée complète ».
- **Hors batch** (`/sante/habitudes`) : les habitudes (modèles shaker protéiné, petit-déjeuner classique, rien), leurs aliments et leurs jours, le hors batch jour par jour et le conseil.
- **Objectifs** : poids visé, échéance, plan de sport, contraintes ; le coach (IA) propose, `checkProposal` (`goals.ts`) vérifie : rythme −1 à +0,5 %/sem., protéines 1,2–2,4 g/kg, poids visé dans un IMC 18,5–30, cible jamais sous le métabolisme de base.
- **Apple Santé** : `POST /api/sante/import` (clé secrète par personne, en-tête `X-Mijote-Key`) reçoit pesées, pas et séances d'un Raccourci iOS généré en code (`src/lib/health/shortcut.ts`, `pnpm shortcut:build`, à signer sur un Mac : `shortcuts sign -m anyone -i build/sante-mijote.unsigned.shortcut -o public/raccourcis/sante-mijote.shortcut`). L'appli décide de la fenêtre de synchro (6 mois la première fois, puis le mois, puis la semaine). Historique complet : l'export d'Apple Santé est lu dans le navigateur.
- **Entraînement** : voir [sport.md](sport.md).
