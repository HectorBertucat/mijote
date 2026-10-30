# Recettes

## Ajouter une recette

Quatre façons :
1. **Atelier** (avec l'IA) : décris une envie, Mijote écrit la fiche complète et la vérifie. Elle arrive « à essayer ».
2. **Ajuster** une recette existante : la variante est rattachée à sa recette d'origine.
3. **Importer** (avec l'IA, bon marché) : Recettes › Importer, on colle le texte d'une recette (légende d'un post Instagram ou TikTok, page de blog copiée) et son lien. Mijote la met au format, vérifie les quantités et montre un aperçu ; elle arrive « à essayer », avec le lien en source, et « à relire » si les quantités sont douteuses.
4. **Un fichier** au format standard dans `src/seed/recipes/` ou dans le dossier de `MIJOTE_RECIPES_DIR` (les deux sont importés ; sur un même slug, le second gagne) : importé au démarrage, réimporté s'il change (les notes sont gardées). En ligne de commande : `pnpm import:recipes`.

## Importer un texte collé

Rien n'est téléchargé (ni vidéo, ni page d'un réseau social) : seul le texte collé est lu, le lien est gardé tel quel comme source, sans ses paramètres de suivi (`igsh`, `utm_*`…). Le parcours (`src/lib/atelier/import.ts`) :

1. **Garde-fous en code**, sans appel ni coût : texte vide, de moins de 60 caractères, ou sans au moins deux quantités repérables (« 200 g », « 2 c. à s. », « - 2 oignons ») → refus clair. Hashtags retirés, texte tronqué à 6 000 caractères. Limite d'imports par jour : `AI_IMPORTS_PER_DAY` (10 par défaut, 0 coupe l'import).
2. **Un appel Haiku** avec le prompt système de l'Atelier (matériel de la cuisine, table nutritionnelle, goûts) : bols, sous-étapes chronométrées, récipients standard, quantités ramenées à un batch de 5 repas du foyer.
3. **Vérification en code** : celle de l'Atelier (catalogue, nutrition recalculée, sous-étapes), puis les quantités : ingrédient sans quantité, ligne de plus de 5 kg, aliment absent de la table, 35 à 300 g d'ingrédients et 60 à 350 kcal par unité, nombre d'unités proche du batch visé. Un écart : « quantités douteuses, à relire », et l'étiquette « à relire » sur la fiche.

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
- **Étapes** : `kind` parmi `prep`, `sear`, `braise`, `boil`, `bake`, `rest`, `cool`, `preheat`… `equipmentId` parmi les récipients standard : `poele-28`, `cocotte`, `faitout`, `casserole-14`, `casserole-16`, `casserole-18`, `plat-grand`, `plat-moyen`, `plat-four`, `oven`, `air-fryer`. Ce sont des rôles (la poêle de saisie, la grande casserole…) : leurs vraies tailles viennent de la cuisine décrite. `equipmentAlt` : récipients de rechange si celui-ci est pris ou absent de la cuisine.
- **Air fryer** (`air-fryer`) : un récipient à part entière, avec sa température (`ovenTemp`), sans foyer ni four. Toujours une rechange au four (`"equipmentAlt": ["plat-grand"]`), puisque beaucoup de cuisines n'en ont pas : le planificateur convertit alors la température (+20 °C) et la durée (÷ 0,8), dans le texte aussi. À l'inverse, un plat au four avec `"equipmentAlt": ["air-fryer"]` peut y passer (−20 °C, 20 % de temps en moins) quand le four est pris à une autre température, si l'étape tient dans le panier (environ 150 g par litre).
- **Sous-étapes** (`phases`) : **obligatoires** sur toute étape de cuisson. Chacune a son minuteur en session ; `wait: true` pour une attente sans geste (l'écran passe à autre chose et sonne à la fin). Règles et filet de sécurité : `src/lib/recipes/phases.ts`, test `tests/phases.test.ts`.
- **Garniture à part** : `"side": true` sur les lignes cuites et gardées à part (riz, semoule). En fin de session, on pèse alors le plat et la garniture séparément, et l'appli règle les deux dans chaque boîte pour viser à la fois les calories et les protéines de chacun.
- **Nutrition** : `food` = l'id de la table nutritionnelle (`src/lib/nutrition/foods.ts`, valeurs Ciqual), `zero` pour sel, eau, herbes. `yield` dit ce qui est vraiment mangé (part du paquet, parure, gras resté dans la poêle). Les macros par unité sont recalculées à l'import : ne les écris pas.

## Dessins

Chaque aliment et chaque geste a son dessin animé. `pnpm illus:coverage` liste, recette par recette, ce qui tombe sur un dessin générique. Pour en ajouter : [illustrations.md](illustrations.md), ou le bouton « Dessiner avec l'IA » sur la fiche.

## Vérifier

```bash
pnpm test            # dont tests/phases.test.ts : les fiches de src/seed/recipes
pnpm plan:audit      # le planificateur sur toutes les paires de recettes
```
