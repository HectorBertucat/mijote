# Recettes

## Ajouter une recette

Cinq façons :
1. **Atelier** (avec l'IA) : décris une envie, Mijote écrit la fiche complète et la vérifie. Elle arrive « à essayer ».
2. **Créer d'après des recettes publiées** (Atelier › Créer, avec l'IA) : l'envie part d'abord sur le web, Mijote résume quelques vraies recettes publiées (sources citées et liées), en tire deux propositions pour le foyer (une troisième à la demande), qu'on retouche (« plus de sauce ») avant de les ajouter « à essayer ». Voir plus bas.
3. **Ajuster** une recette existante : la variante est rattachée à sa recette d'origine.
4. **Importer** (avec l'IA, bon marché) : Recettes › Importer, on colle le texte d'une recette (légende d'un post Instagram ou TikTok, page de blog copiée) et son lien. Mijote la met au format, vérifie les quantités et montre un aperçu ; elle arrive « à essayer », avec le lien en source, et « à relire » si les quantités sont douteuses.
5. **Un fichier** au format standard dans `src/seed/recipes/` ou dans le dossier de `MIJOTE_RECIPES_DIR` (les deux sont importés ; sur un même slug, le second gagne) : importé au démarrage, réimporté s'il change (les notes sont gardées). En ligne de commande : `pnpm import:recipes`.

## Importer un texte collé

Rien n'est téléchargé (ni vidéo, ni page d'un réseau social) : seul le texte collé est lu, le lien est gardé tel quel comme source, sans ses paramètres de suivi (`igsh`, `utm_*`…). Le parcours (`src/lib/atelier/import.ts`) :

1. **Garde-fous en code**, sans appel ni coût : texte vide, de moins de 60 caractères, ou sans au moins deux quantités repérables (« 200 g », « 2 c. à s. », « - 2 oignons ») → refus clair. Hashtags retirés, texte tronqué à 6 000 caractères. Limite d'imports par jour : `AI_IMPORTS_PER_DAY` (10 par défaut, 0 coupe l'import).
2. **Un appel Haiku** avec le prompt système de l'Atelier (matériel de la cuisine, table nutritionnelle, goûts) : bols, sous-étapes chronométrées, récipients standard, quantités ramenées à un batch de 5 repas du foyer.
3. **Vérification en code** : celle de l'Atelier (catalogue, nutrition recalculée, sous-étapes), puis les quantités : ingrédient sans quantité, ligne de plus de 5 kg, aliment absent de la table, 35 à 300 g d'ingrédients et 60 à 350 kcal par unité, nombre d'unités proche du batch visé. Un écart : « quantités douteuses, à relire », et l'étiquette « à relire » sur la fiche.

## Créer d'après des recettes publiées

`/atelier/creer` (`src/lib/creation/` : `core.ts` pur, `index.ts` la base et l'IA). L'IA propose, le code vérifie :

1. **Recherche bornée** (Haiku, outils serveur de l'API : 3 recherches et 2 pages lues au plus, réseaux sociaux exclus). L'IA rend chaque source résumée dans ses mots (ingrédients qui comptent, technique en une phrase, ce qui la rend bonne) : rien n'est recopié. Le code ne garde que les adresses que l'API a vraiment renvoyées (une adresse inventée est écartée et montrée comme telle), deux par site, cinq en tout, textes tronqués. La même envie réutilise la recherche pendant 30 jours, sans nouveau coût.
2. **Composition** (Sonnet, un appel par proposition, chacun avec sa direction) : le prompt de l'Atelier (foyer, parts et repères, équipement réel, table nutritionnelle, goûts de la maison), plus les sources, les plats aimés et les retours de goût notés sur les fiches. Chaque proposition dit ce qui la rend bonne, de quelles sources elle s'inspire et ce qui change par rapport à elles.
3. **Vérification en code** avant d'afficher, et de nouveau avant d'enregistrer : aliments connus de la table nutritionnelle (ou signalés et non comptés), au moins 70 % des grammes connus, chaque étape de cuisson sur un récipient de la cuisine (ou sa rechange, l'air fryer sans four), four et plaque présents, température au four, durées, quantités (35 à 300 g et 60 à 350 kcal par unité, pas de ligne de plus de 5 kg), doublon de la bibliothèque. Un défaut bloquant empêche l'enregistrement ; « Corriger » renvoie les défauts relevés à l'IA. Les garnitures à part (`side`) sont reconnues par le code : un féculent dont le bol cuit seul, dans son propre récipient. Les chiffres d'une part pour chacun sont calculés par l'appli.
4. **Retouches** : « plus de sauce », « sans crème »… (6 au plus par proposition), même nombre d'unités, tout revérifié.
5. **Enregistrement** : la fiche entre « à essayer », étiquetée « atelier », avec ses sources (titre, site, lien) dans le champ source.

Le coût estimé est affiché avant chaque appel, et la demande est refusée clairement si elle ferait dépasser le plafond du mois (`AI_MONTHLY_CAP_USD`). Sans clé, l'entrée n'apparaît pas ; en démo, la page explique ce qu'elle ferait.

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
- **Garniture à part** : `"side": true` sur les lignes cuites et gardées à part (riz, semoule). En fin de session, on pèse alors le plat et la garniture séparément, et l'appli règle les deux dans chaque boîte : les calories de chacun, et moins de garniture pour qui manque de protéines (jamais plus que la proportion de la marmite).
- **Groupes servis à part** : une portion est faite de groupes qu'on se sert séparément (le plat et sa sauce, le riz, les haricots verts), pesés chacun en fin de session. L'appli les déduit des étapes (`src/lib/reserve/groups.ts` : bols cuits ensemble, même récipient, reprises). Quand la déduction ne convient pas, la fiche les déclare : `"serve": [{ "label": "plat", "bowls": ["A", "B"], "kind": "main" }, { "label": "riz", "bowls": ["D"], "kind": "starch" }]` (le premier reçoit ce qui n'est dans aucun bol ; `kind` : `main`, `starch` féculent, `veg` légume, `other`).
- **Variante du dépôt** : `"variantOf": "<slug>"` rattache la fiche à sa recette d'origine (`recipes.parent_id`, toujours la racine) ; les variantes s'importent après les autres. Exemple : `poulet-paprika-fume-pommes-de-terre`.
- **Nutrition** : `food` = l'id de la table nutritionnelle (`src/lib/nutrition/foods.ts`, valeurs Ciqual), `zero` pour sel, eau, herbes. `yield` dit ce qui est vraiment mangé (part du paquet, parure, gras resté dans la poêle). Les macros par unité sont recalculées à l'import : ne les écris pas.

## Goûts et variantes réelles

Le code apprend des goûts de chacun sans sacrifier les objectifs (`src/lib/feedback/`, testé dans `tests/gouts.test.ts`) :

- **Retour de goût** en un geste, sur Nos plats juste après « J'ai mangé » (ou « Mon avis » sur une portion mangée), sur la fiche (section Goûts) et dans l'app iPhone (`POST plats/avis`) : j'adore, ok ou bof, des étiquettes (sec, trop dense, fade, trop épicé, trop gras, portion trop grosse, je referais) et un mot libre. Le plus récent de chacun compte ; il s'affiche sur la fiche (« Sam : bof · sec, trop dense »).
- **Semaine** : une pastille par plat (« Sam : bof (sec) », « Alex adore ») ; un « bof » passe en fin de liste et coûte des points à la proposition tant qu'aucune variante n'est née après lui. Une recette et sa variante ne sont jamais proposées ensemble.
- **Ingrédient remplacé** (« J'ai remplacé un ingrédient » sur la fiche) : poids pour poids, par un aliment de la même famille de la table (féculent, viande, légume, laitage…). Rattaché à la réserve ouverte du plat (ses kcal et protéines par gramme suivent, les grammes pesés restent) ou à la session en cours (la réserve rangée en tient compte).
- **Ajuster d'après les retours**, en code : « sec » → la sauce × 1,5 (sinon un bouillon), servie dans chaque portion ; « trop dense » → la viande × 0,85, remontée tant que quelqu'un passerait sous le bas de son repère de protéines, et des légumes (× 1,4, ou des poivrons rôtis avec le féculent) ; « trop gras » → huile et beurre × 0,7 ; « fade » → un citron au service ; « trop épicé » → les épices piquantes × 0,6. Avec les remplacements notés, l'aperçu chiffré de la part de chacun (avant, après), puis « Enregistrer la variante » : une nouvelle fiche « à essayer », l'originale ne bouge pas. Avec l'IA, l'option « D'après les retours » d'Ajuster passe les retours à l'atelier, et le code revérifie.

## Dessins

Chaque aliment et chaque geste a son dessin animé. `pnpm illus:coverage` liste, recette par recette, ce qui tombe sur un dessin générique. Pour en ajouter : [illustrations.md](illustrations.md), ou le bouton « Dessiner avec l'IA » sur la fiche.

## Vérifier

```bash
pnpm test            # dont tests/phases.test.ts : les fiches de src/seed/recipes
pnpm plan:audit      # le planificateur sur toutes les paires de recettes
```
