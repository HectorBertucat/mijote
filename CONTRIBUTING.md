# Contribuer

Merci ! Mijote est une petite base de code TypeScript, sans service externe obligatoire.

## Lancer

```bash
pnpm install
cp .env.example .env.local     # MIJOTE_AI_MOCK=1 pour simuler l'IA
pnpm dev                       # http://localhost:3010
pnpm typecheck && pnpm test    # avant chaque commit
pnpm build && pnpm test:smoke  # l'appli construite, toutes les pages, sur une base vide
pnpm test:ai                   # facultatif : les fonctions IA en vrai (clé nécessaire, ~0,40 $)
```

## Avant le premier commit
```bash
git config core.hooksPath .githooks   # refuse les secrets, les bases, les .env et les mentions d'IA en co-auteur
```

## Branches
Une branche par changement (`feat/…`, `fix/…`, `docs/…`), une pull request, la CI doit être verte (types, tests, build, test de fumée, image Docker). Les pull requests sont fusionnées en « squash ».

## Conventions
- **Le calcul est pur et testé.** Ce qui doit être juste (quantités, macros, coûts, planning, vérifications de l'IA) vit dans un module sans base ni réseau, avec ses tests dans `tests/`. Les fichiers `store.ts` font le lien avec la base.
- **L'IA propose, le code vérifie.** Tout appel passe par `structured()` (`src/lib/ai/`), avec un schéma de sortie ; ce qui revient est contrôlé avant d'être affiché ou gardé.
- **Une migration par changement de schéma** : `pnpm db:generate --name <nom>`. Jamais de modification d'une migration publiée.
- **Interface** : le kit `src/components/ui/` et les jetons de `src/app/cuisine-tokens.css` (jamais de couleur en dur) ; chaque écran marche au clavier, au doigt sur tablette et sur téléphone. Démo vivante : `/kit`.
- **Textes** en français, phrases courtes, sans jargon.
- Une nouvelle recette de démonstration : `pnpm illus:coverage` et les dessins qui manquent ([docs/illustrations.md](docs/illustrations.md)).

## Brancher un magasin
Voir [docs/catalogue.md](docs/catalogue.md) et l'exemple [examples/catalogue-csv](examples/catalogue-csv).

## Idées
Voir [docs/roadmap.md](docs/roadmap.md). Ouvre une issue avant un gros changement.
