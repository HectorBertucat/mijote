# Architecture

## Le principe : l'IA propose, le code vérifie

Mijote n'est pas un chat. Tout ce qui doit être juste est **déterministe, en code, testé** :
- quantités, portions et macros par part (`src/lib/nutrition/`, `src/lib/eaters/`) ;
- coûts (`src/lib/costs/`) ;
- planning de session sous contraintes de ressources (`src/lib/session/planner.ts`) ;
- proposition de la semaine (`src/lib/week/propose.ts`) ;
- programmes de sport du générateur (`src/lib/training/generate.ts`).

L'IA (API Claude, sorties JSON structurées) **rédige et propose** derrière des boutons, et le code contrôle avant d'afficher ou de garder :

| Bouton | Ce que propose l'IA | Ce que vérifie le code |
|---|---|---|
| Ajuster / Atelier / Importer | une recette complète | ingrédients connus de la table nutritionnelle, macros recalculées, équipement réel, sous-étapes, doublons de la bibliothèque, produits du catalogue |
| Coach (Santé › Objectifs) | des objectifs | rythme −1 à +0,5 %/sem., protéines 1,2–2,4 g/kg, IMC visé sain, cible jamais sous le métabolisme de base |
| Programme sur mesure | séances, et exercices inventés avec leurs figures | ids de la bibliothèque, matériel, séries et repos bornés, durée, figures résolues par le squelette (sol, cadre, appuis, membres qui atteignent leur cible) |
| Dessiner un aliment | un fragment SVG | liste blanche stricte de balises, attributs, couleurs (jetons du thème) et animations |
| Estimer un repas | kcal et macros | marqué « estimation » dans le journal |

Tous les appels passent par **un seul module** (`src/lib/ai/`) qui impose le schéma, journalise chaque appel (`ai_calls` : modèle, jetons, coût, écran, durée) et applique un plafond mensuel.

## Les modules

```
src/
  app/                 pages (App Router) et actions serveur
    bienvenue/ reglages/   mise en route et réglages de l'instance
    recettes/ atelier/     bibliothèque, fiche, ajustement, création
    semaine/ composer/     semaine de repas, sélection libre
    courses/ couts/ placard/
    session/               centre de contrôle (SSE)
    sante/                 santé, objectifs, Apple Santé, entraînement
    kit/                   démonstration vivante du kit de composants
  components/          composants (kit dans components/ui)
  lib/
    ai/                point d'entrée unique de l'IA
    atelier/           ajuster et créer une recette (prompts, vérification)
    chronocatalog.ts   client du catalogue de produits (facultatif)
    costs/             achats, lots du placard, coût par part
    db/                schéma Drizzle, migrations, ouverture
    eaters/            mangeurs, cible d'un repas, part de chacun
    health/            santé : tendance, dépense, cibles, journal, coach, Apple Santé
    household.ts       le foyer (personnes)
    illus/             dessins animés : banque, choix, filtre et dessins de l'IA
    kitchen/           cuisine du foyer → équipement du planificateur
    nutrition/         table nutritionnelle, calcul par part
    products/          produits du drive associés aux ingrédients
    recipes/           format des fiches, sous-étapes, variantes, saisons
    session/           planificateur, état, durées réelles
    settings.ts        réglages de l'instance
    shopping/          liste de courses, panier, rayons
    training/          programmes, bibliothèque, générateur, IA, figures, séance partagée
    week/              période, présence, proposition, restes, goûts
  seed/                données de départ et recettes de démonstration
  proxy.ts             mot de passe facultatif, mise en route
tests/                 node:test, un fichier par domaine
```

Les modules « purs » (sans base ni réseau) portent le calcul et sont testés directement : `nutrition/compute.ts`, `eaters/core.ts`, `week/propose.ts`, `week/period.ts`, `session/planner.ts`, `health/core.ts`, `health/goals.ts`, `training/generate.ts`, `training/motion-check.ts`, `illus/sanitize.ts`, `kitchen/presets.ts`… Les fichiers `store.ts` font le lien avec la base.

## Données

SQLite (un fichier), Drizzle pour le schéma (`src/lib/db/schema.ts`, décrit dans [schema.md](schema.md)). Les migrations s'appliquent au démarrage, une transaction chacune, même si plusieurs process démarrent ensemble. Au démarrage aussi : les recettes de `src/seed/recipes/` nouvelles ou modifiées sont importées (empreinte du fichier, qui inclut la version du calcul nutritionnel et du planificateur).

## Temps réel

Une session de cuisine et une séance de sport vivent sur le serveur (journal d'événements, état versionné). Chaque écran s'abonne en SSE. Les minuteurs sont une **heure de fin** : chaque écran fait son propre décompte, juste même après une mise en veille.

## Interface

Un kit de composants maison (`src/components/ui/`, démo vivante sur `/kit`) et des jetons de couleur (`src/app/cuisine-tokens.css`) : clair et sombre, une couleur par recette et par rubrique, jamais de couleur en dur. Chaque écran marche au clavier et à la souris, au doigt sur tablette, et en lecture rapide sur téléphone. Les dessins (aliments, gestes, exercices) sont des SVG animés, coupés si le système demande moins d'animations.
