## 2026-10-31 : CI plus rapide, journal sans conflits
- CI en tâches parallèles (types et lint, tests, build et fumée, image Docker) ; « Types, tests, build, fumée » devient une tâche de synthèse du même nom, la protection de `main` ne change pas. Un nouveau push sur une PR annule l'exécution précédente (jamais sur `main`).
- TypeScript 7 (compilateur natif) : `pnpm typecheck` 6,8 s → 1,6 s. `next build` ne revérifie plus les types (`typescript.ignoreBuildErrors`) : la vérification reste obligatoire en CI et au push ; ne construire que des commits de `main`.
- Paires du planificateur en quatre morceaux que `node --test` lance en parallèle (`tests/planner-pairs.ts`, `planner-pairs-1…4.test.ts`), durée d'une recette seule calculée une fois : toutes les paires restent vérifiées, la suite passe de 15 s à 8 s en local. Le premier morceau vérifie la couverture (chaque paire dans un seul morceau, un fichier par morceau, aucun plafond orphelin) ; un morceau vide échoue.
- Image Docker : cache des couches (buildx, `type=gha`), même vérification de démarrage.
- Hook pre-push : après le contrôle des données privées, vérifie les types (moins de 2 s) ; `MIJOTE_SKIP_TYPECHECK=1 git push` pour passer outre.
- Oxlint (`pnpm lint`, `.oxlintrc.json`) : les règles « correctness » en erreur, six règles déjà touchées en avertissement.
- Journal en fragments : une PR ajoute `docs/changelog.d/AAAA-MM-JJ-sujet.md` au lieu d'écrire en tête de ce fichier ; `pnpm changelog` vérifie et affiche le journal complet, `pnpm changelog --fold` les verse ici.
