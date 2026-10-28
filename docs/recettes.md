# Recettes

## Ajouter une recette

Trois façons :
1. **Atelier** (avec l'IA) : décris une envie, Mijote écrit la fiche complète et la vérifie. Elle arrive « à essayer ».
2. **Ajuster** une recette existante : la variante est rattachée à sa recette d'origine.
3. **Un fichier** au format standard dans `src/seed/recipes/` (ou le dossier de `MIJOTE_RECIPES_DIR`) : importé au démarrage, réimporté s'il change (les notes sont gardées). En ligne de commande : `pnpm import:recipes`.

## Le format

Un fichier JSON par recette, validé par `src/lib/recipes/format.ts` (zod) :

```json
{
  "slug": "chasseur-porc",
  "name": "Porc chasseur",
  "description": "…",
  "servingsUnits": 36,
  "tags": ["porc", "four"],
  "fridgeDays": 4,
  "freezerOk": true,
  "ingredients": [
    { "lineRaw": "1,5 kg sauté de porc", "item": "Sauté de porc", "grams": 1500, "group": "A", "food": "saute_porc" },
    { "lineRaw": "sel, poivre", "item": "Sel", "pantry": true, "food": "zero" }
  ],
  "steps": [
    { "kind": "prep", "text": "Bol A : coupe le porc en cubes de 3 cm.", "durationMin": 8, "activeMin": 8, "bowls": ["A"] },
    {
      "kind": "sear", "text": "Saisis le porc du bol A en 3 fournées…", "durationMin": 18, "activeMin": 18,
      "equipmentId": "poele-28", "hobLevel": 7, "bowls": ["A"], "cue": "croûte brun doré, grésillement franc",
      "phases": [
        { "text": "Poêle vide, préchauffe", "min": 2.5, "hobLevel": 7 },
        { "text": "Test de la goutte d'eau", "min": 0.5 },
        { "text": "Fournée 1, sans toucher", "min": 4, "batch": 1 }
      ]
    }
  ]
}
```

- **Unités** : `servingsUnits` = le nombre d'unités de la marmite. Une part d'adulte fait 4 à 5 unités ; la part de chacun est calculée par l'appli.
- **Bols** : `group` (ingrédient) et `bowls` (étape) relient la prep à la cuisson : « bol C ».
- **Étapes** : `kind` parmi `prep`, `sear`, `braise`, `boil`, `bake`, `rest`, `cool`, `preheat`… `equipmentId` parmi les récipients standard : `poele-28`, `cocotte`, `faitout`, `casserole-14`, `casserole-16`, `casserole-18`, `plat-grand`, `plat-moyen`, `plat-four`, `oven`. `equipmentAlt` : récipients de rechange si celui-ci est pris ou absent de la cuisine.
- **Sous-étapes** (`phases`) : **obligatoires** sur toute étape de cuisson. Chacune a son minuteur en session ; `wait: true` pour une attente sans geste (l'écran passe à autre chose et sonne à la fin). Règles et filet de sécurité : `src/lib/recipes/phases.ts`, test `tests/phases.test.ts`.
- **Nutrition** : `food` = l'id de la table nutritionnelle (`src/lib/nutrition/foods.ts`, valeurs Ciqual), `zero` pour sel, eau, herbes. `yield` dit ce qui est vraiment mangé (part du paquet, parure, gras resté dans la poêle). Les macros par unité sont recalculées à l'import : ne les écris pas.

## Dessins

Chaque aliment et chaque geste a son dessin animé. `pnpm illus:coverage` liste, recette par recette, ce qui tombe sur un dessin générique. Pour en ajouter : [illustrations.md](illustrations.md), ou le bouton « Dessiner avec l'IA » sur la fiche.

## Vérifier

```bash
pnpm test            # dont tests/phases.test.ts : les fiches de src/seed/recipes
pnpm plan:audit      # le planificateur sur toutes les paires de recettes
```
