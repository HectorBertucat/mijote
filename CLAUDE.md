# Mijote — contexte pour les agents

À lire en premier, puis `README.md` et `docs/architecture.md`.

## Le projet
Appli web auto-hébergée de batch cooking pour un foyer (N personnes) : recettes, semaine, courses, session de cuisine multi-écrans planifiée selon l'équipement réel, nutrition et coût par part, module Santé et programmes de sport à la maison avec figures animées. Interface en français. Open source (MIT).

## Règles
1. **L'IA propose, le code vérifie.** Deux conversations seulement : le coach de Santé › Objectifs et l'assistant (partout, `src/lib/assistant/`). Elles ne font que *proposer* des actions typées (sortie structurée, outils stricts) ; le code les revalide (existence, bornes, cohérence nutritionnelle par les modules purs), la personne confirme chaque action d'un geste, et le code l'exécute avec les mêmes fonctions que l'interface. Jamais d'écriture directe par l'IA ; les chiffres affichés viennent du code. Tout appel IA passe par `src/lib/ai/` (`structured()` ou `chat()` en flux, schéma imposé, journal `ai_calls`, plafond `AI_MONTHLY_CAP_USD`). Sonnet pour planifier, Haiku pour les petites tâches et l'assistant au quotidien ; ids dans `src/lib/ai/pricing.ts`. Sans `ANTHROPIC_API_KEY`, rien d'IA n'apparaît et tout le reste marche.
2. **Déterministe en code** : quantités, portions, macros, coûts, planning de session, proposition de la semaine, générateur de programmes, vérification des figures et des dessins. Modules purs et testés (`tests/`).
3. **Rien de personnel dans le dépôt** : le foyer, la cuisine et le magasin viennent de la mise en route (`/bienvenue`, table `app_settings`). Pas de prénom, d'adresse, de date de naissance, de marque d'équipement ni de secret en dur. Les tests utilisent le foyer fictif « Alex et Sam » (`tests/helpers.ts`, `seedTest`). Les hooks git (`.githooks/`, `scripts/check-private.mjs`) le vérifient à chaque commit et push.
4. **Une migration par changement** (`pnpm db:generate --name <nom>`), jamais de modification d'une migration publiée.
5. **Interface** : kit `src/components/ui/` et jetons `src/app/cuisine-tokens.css`, jamais de couleur en dur ; clavier, doigt, téléphone. Un aliment ou un geste affiché = son dessin (`FoodIllu`, `StepIllu`).
6. **Catalogue facultatif** : sans `CHRONOCATALOG_URL`, tout marche (courses par rayon, sans prix). On ne lit que les champs documentés de l'API ; jamais d'appel direct à un site marchand.
7. **Commits et PR sans mention d'IA** : pas de ligne `Co-Authored-By: Claude`, pas de « Generated with Claude Code », dans les messages de commit comme dans les descriptions de PR. L'auteur est le mainteneur.
8. Économie : pas de workflows multi-agents sans demande explicite ; vérifications bon marché (types, tests ciblés).

## Façon de travailler
- Une branche par changement (`feat/…`, `fix/…`, `docs/…`), une pull request, la CI verte (types, tests, build et fumée en tâches parallèles, image Docker ; vérifications requises « Types, tests, build, fumée » et « Image Docker »), puis fusion « squash » dans `main`. Une correction d'une ligne dans la doc peut aller directement sur `main`.
- Avant de rendre la main : `pnpm typecheck`, `pnpm test`, et `pnpm build && pnpm test:smoke` si une page ou le démarrage change.
- Activer les hooks une fois par clone : `git config core.hooksPath .githooks`. Au push, ils vérifient les données privées puis les types (`MIJOTE_SKIP_TYPECHECK=1 git push` pour passer outre les types seulement).
- `next build` ne vérifie pas les types (`next.config.ts`) : c'est `pnpm typecheck`, obligatoire en CI et au push. Ne construire et déployer que des commits de `main`.
- Les paires de recettes du planificateur sont testées en quatre morceaux parallèles (`tests/planner-pairs.ts`, `planner-pairs-1…4.test.ts`) ; une recette ajoutée = ses plafonds dans `CEIL`.

## Commandes
| Quoi | Commande |
|---|---|
| Dev (port 3010) | `pnpm dev` |
| Types, lint, tests | `pnpm typecheck`, `pnpm lint` (Oxlint, `.oxlintrc.json`), `pnpm test` |
| Build | `pnpm build` |
| Docker | `docker compose up -d --build` |
| Démo | `pnpm build` puis `MIJOTE_DEMO=1 MIJOTE_DATA_DIR=/tmp/mijote-demo pnpm start` (docs/demo.md) |
| Migration | `pnpm db:generate --name <nom>` |
| Recettes de `src/seed/recipes/` | `pnpm import:recipes` |
| Dessins manquants | `pnpm illus:coverage` |
| Audit du planificateur | `pnpm plan:audit` |
| Journal (vérifier, afficher ; `--fold` sur main) | `pnpm changelog` |

## Où regarder
| Besoin | Fichier |
|---|---|
| Accueil (action du moment) | `src/app/page.tsx`, `src/lib/home/` (`next.ts` pur, `store.ts` : `homeView`) |
| Écran de lancement, visite guidée, premiers pas | `src/components/tour/` (`LaunchSplash.tsx`, `Tour.tsx`), `src/lib/tour/` (`core.ts` pur, `store.ts`), `src/components/accueil/FirstSteps.tsx`, images de démarrage iOS `src/lib/launch.ts` et `src/app/lancement/` |
| Mise en route, réglages, foyer | `src/app/bienvenue/`, `src/app/reglages/`, `src/lib/household.ts`, `src/lib/settings.ts` |
| Cuisine → équipement | `src/lib/kitchen/` (`presets.ts` pur, `store.ts`) |
| Mangeurs et parts | `src/lib/eaters/` (`core.ts` et `habits.ts` purs : part, habitudes hors batch, conseil ; `store.ts` : `loadEaters`, `householdMembers`, `leadOf`, `adviceFor`) |
| Nutrition | `src/lib/nutrition/` (incrémenter `NUTRITION_VERSION` si le calcul change) |
| Fiche recette, bibliothèque | `src/app/recettes/`, `src/components/fiche/` (bloc à filet, chiffres de tête, tableau d'ingrédients), `src/components/RecipeParts.tsx` (`StepItem`) |
| Semaine | `src/lib/week/` (`period.ts` : période du … au …, 14 jours au plus ; `fit.ts` pur : adéquation des recettes et de la sélection aux repères, pastilles, suggestion), `src/components/semaine/` (`Fit.tsx`) |
| Courses | `src/lib/shopping/`, catalogue `src/lib/chronocatalog.ts` (`catalogEnabled()`) |
| Session | `src/lib/session/` (`planner.ts`, `flow.ts` pour la vue simple), `src/components/session/` (`Simple.tsx` par défaut, vue détaillée `?vue=detail`) |
| Boîtes, frigo | `src/lib/boxes/` (`core.ts` pur : grammes par boîte, rangement ; `store.ts`), `src/app/frigo/`, `src/components/boxes/` |
| Assistant (partout, ⌘I) | `src/lib/assistant/` (`core.ts` pur : contexte, outils, `checkAction` ; `store.ts` : instantané, conversation, exécution), `src/app/api/assistant/route.ts` (flux), `src/components/assistant/` |
| Atelier IA, import d'un texte collé | `src/lib/atelier/` (`import.ts`) |
| Santé | `src/lib/health/`, docs/sante.md ; vue d'ensemble : `src/app/sante/page.tsx`, sections `src/components/sante/overview/`, séries `src/lib/health/overview.ts` (SQL) et `series.ts` (pur : périodes, paquets, synthèse) |
| Graphiques | `src/components/ui/charts/` (`LineChart`, `BarChart`, `Sparkline`, `CalendarHeat`, `HBarChart`, `PeriodScope` ; île client `hover.tsx`), jetons `--c-viz-*`, démonstration `/kit/graphiques`, docs/design/systeme.md § Graphiques |
| Apple Santé (app iPhone, import) | `src/lib/health/import-api.ts` (GET/POST), `ingest-v2.ts` (format v2 : bornes, dédoublonnage), `ingest.ts` (v1), `link.ts` (clé, code d'installation), `samples.ts` et `sleep.ts` (lecture), `src/app/sante/apple/` |
| Sport | `src/lib/training/` (`library.ts`, `generate.ts`, `ai.ts`, `motion-check.ts`, `programs.ts`), docs/sport.md |
| Dessins | `src/lib/illus/` (`art.ts`, `resolve.ts`, `dish.ts` : la boîte d'un plat, `sanitize.ts`, `ai.ts`), `src/components/ui/dish.tsx` (`DishBox`), docs/illustrations.md |
| Chargement, transitions de page | `loading.tsx` de chaque rubrique, kit `src/components/ui/skeleton.tsx`, `src/components/PageTransition.tsx`, onglets `src/components/Nav.tsx` |
| Accès | `src/proxy.ts`, `src/lib/auth.ts` |
| Mode démo (`MIJOTE_DEMO=1`) | `src/lib/demo/` (`core.ts` pur : ids, chemins, purge, plafonds ; `household.ts` pur : foyer daté ; `seed.ts` ; `store.ts` : base modèle et bases de visiteurs ; `request.ts`), `src/instrumentation.ts`, `src/components/demo/`, docs/demo.md |
| Schéma | `src/lib/db/schema.ts`, docs/schema.md |

## Contexte privé d'une instance
Une instance peut avoir un contexte privé dans `perso/` : un dépôt séparé, ignoré par git, jamais publié (la configuration de son serveur, ses recettes, ses notes). S'il existe, `perso/CLAUDE.md` est chargé ci-dessous et prime pour cette instance ; ses motifs interdits (`perso/denylist.txt`) sont vérifiés par les hooks. Rien de ce dossier ne doit être copié dans le dépôt public.

@perso/CLAUDE.md

## Garder le contexte à jour
À la fin d'une tâche qui change le comportement, le schéma ou une commande : un fragment `docs/changelog.d/AAAA-MM-JJ-sujet.md` (un titre `## AAAA-MM-JJ : titre`, des lignes `- …` ; voir le README du dossier), jamais d'écriture directe en tête de `docs/CHANGELOG.md` (conflits entre PR parallèles) ; et ce fichier si une règle, un chemin ou une commande change.
