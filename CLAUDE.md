# Mijote — contexte pour les agents

À lire en premier, puis `README.md` et `docs/architecture.md`.

## Le projet
Appli web auto-hébergée de batch cooking pour un foyer (N personnes) : recettes, semaine, courses, session de cuisine multi-écrans planifiée selon l'équipement réel, nutrition et coût par part, module Santé et programmes de sport à la maison avec figures animées. Interface en français. Open source (MIT).

## Règles
1. **L'IA propose, le code vérifie.** Pas de chat (sauf le coach de Santé › Objectifs, dont chaque proposition est vérifiée). Tout appel IA passe par `src/lib/ai/` (`structured()`, schéma imposé, journal `ai_calls`, plafond `AI_MONTHLY_CAP_USD`). Sonnet pour planifier, Haiku pour les petites tâches ; ids dans `src/lib/ai/pricing.ts`.
2. **Déterministe en code** : quantités, portions, macros, coûts, planning de session, proposition de la semaine, générateur de programmes, vérification des figures et des dessins. Modules purs et testés (`tests/`).
3. **Rien de personnel dans le dépôt** : le foyer, la cuisine et le magasin viennent de la mise en route (`/bienvenue`, table `app_settings`). Pas de prénom, d'adresse, de date de naissance, de marque d'équipement ni de secret en dur. Les tests utilisent le foyer fictif « Alex et Sam » (`tests/helpers.ts`, `seedTest`). Les hooks git (`.githooks/`, `scripts/check-private.mjs`) le vérifient à chaque commit et push.
4. **Une migration par changement** (`pnpm db:generate --name <nom>`), jamais de modification d'une migration publiée.
5. **Interface** : kit `src/components/ui/` et jetons `src/app/cuisine-tokens.css`, jamais de couleur en dur ; clavier, doigt, téléphone. Un aliment ou un geste affiché = son dessin (`FoodIllu`, `StepIllu`).
6. **Catalogue facultatif** : sans `CHRONOCATALOG_URL`, tout marche (courses par rayon, sans prix). On ne lit que les champs documentés de l'API ; jamais d'appel direct à un site marchand.
7. **Commits et PR sans mention d'IA** : pas de ligne `Co-Authored-By: Claude`, pas de « Generated with Claude Code », dans les messages de commit comme dans les descriptions de PR. L'auteur est le mainteneur.
8. Économie : pas de workflows multi-agents sans demande explicite ; vérifications bon marché (types, tests ciblés).

## Façon de travailler
- Une branche par changement (`feat/…`, `fix/…`, `docs/…`), une pull request, la CI verte (types, tests, build, fumée, image Docker), puis fusion « squash » dans `main`. Une correction d'une ligne dans la doc peut aller directement sur `main`.
- Avant de rendre la main : `pnpm typecheck`, `pnpm test`, et `pnpm build && pnpm test:smoke` si une page ou le démarrage change.
- Activer les hooks une fois par clone : `git config core.hooksPath .githooks`.

## Commandes
| Quoi | Commande |
|---|---|
| Dev (port 3010) | `pnpm dev` |
| Types, tests | `pnpm typecheck`, `pnpm test` |
| Build | `pnpm build` |
| Docker | `docker compose up -d --build` |
| Migration | `pnpm db:generate --name <nom>` |
| Recettes de `src/seed/recipes/` | `pnpm import:recipes` |
| Dessins manquants | `pnpm illus:coverage` |
| Audit du planificateur | `pnpm plan:audit` |
| Raccourci Apple Santé | `pnpm shortcut:build` puis signer sur un Mac (docs/sante.md) |

## Où regarder
| Besoin | Fichier |
|---|---|
| Accueil (action du moment) | `src/app/page.tsx`, `src/lib/home/` (`next.ts` pur, `store.ts` : `homeView`) |
| Mise en route, réglages, foyer | `src/app/bienvenue/`, `src/app/reglages/`, `src/lib/household.ts`, `src/lib/settings.ts` |
| Cuisine → équipement | `src/lib/kitchen/` (`presets.ts` pur, `store.ts`) |
| Mangeurs et parts | `src/lib/eaters/` (`core.ts` et `habits.ts` purs : part, habitudes hors batch, conseil ; `store.ts` : `loadEaters`, `householdMembers`, `leadOf`, `adviceFor`) |
| Nutrition | `src/lib/nutrition/` (incrémenter `NUTRITION_VERSION` si le calcul change) |
| Fiche recette, bibliothèque | `src/app/recettes/`, `src/components/fiche/` (bloc à filet, chiffres de tête, tableau d'ingrédients), `src/components/RecipeParts.tsx` (`StepItem`) |
| Semaine | `src/lib/week/` (`period.ts` : période du … au …, 14 jours au plus) |
| Courses | `src/lib/shopping/`, catalogue `src/lib/chronocatalog.ts` (`catalogEnabled()`) |
| Session | `src/lib/session/` (`planner.ts`, `flow.ts` pour la vue simple), `src/components/session/` (`Simple.tsx` par défaut, vue détaillée `?vue=detail`) |
| Boîtes, frigo | `src/lib/boxes/` (`core.ts` pur : grammes par boîte, rangement ; `store.ts`), `src/app/frigo/`, `src/components/boxes/` |
| Atelier IA, import d'un texte collé | `src/lib/atelier/` (`import.ts`) |
| Santé | `src/lib/health/`, docs/sante.md |
| Sport | `src/lib/training/` (`library.ts`, `generate.ts`, `ai.ts`, `motion-check.ts`, `programs.ts`), docs/sport.md |
| Dessins | `src/lib/illus/` (`art.ts`, `resolve.ts`, `dish.ts` : la boîte d'un plat, `sanitize.ts`, `ai.ts`), `src/components/ui/dish.tsx` (`DishBox`), docs/illustrations.md |
| Chargement, transitions de page | `loading.tsx` de chaque rubrique, kit `src/components/ui/skeleton.tsx`, `src/components/PageTransition.tsx`, onglets `src/components/Nav.tsx` |
| Accès | `src/proxy.ts`, `src/lib/auth.ts` |
| Schéma | `src/lib/db/schema.ts`, docs/schema.md |

## Contexte privé d'une instance
Une instance peut avoir un contexte privé dans `perso/` : un dépôt séparé, ignoré par git, jamais publié (la configuration de son serveur, ses recettes, ses notes). S'il existe, `perso/CLAUDE.md` est chargé ci-dessous et prime pour cette instance ; ses motifs interdits (`perso/denylist.txt`) sont vérifiés par les hooks. Rien de ce dossier ne doit être copié dans le dépôt public.

@perso/CLAUDE.md

## Garder le contexte à jour
À la fin d'une tâche qui change le comportement, le schéma ou une commande : une entrée datée en tête de `docs/CHANGELOG.md`, et ce fichier si une règle, un chemin ou une commande change.
