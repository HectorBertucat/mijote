# Le planificateur de session

`src/lib/session/planner.ts` fait le plan d'une session (une à quatre recettes) avec l'équipement réel de la cuisine : la prep en bols, puis un fil d'étapes avec l'heure, le foyer et son niveau, ou le four et sa température. Tout est déterministe et testé ; l'IA n'y intervient pas. Ce document dit les règles ; les modules purs autour du planificateur les portent.

| Module | Ce qu'il calcule |
|---|---|
| `capacity.ts` | le volume que prend chaque étape dans son récipient, celui qu'offre un récipient, les cuissons de base, la surface du four |
| `attention.ts` | pour chaque moment d'une étape : mains, surveille ou libre, et les rappels |
| `containers.ts` | où attend chaque groupe d'ingrédients : au moment, dans quel bol ou boîte de la cuisine, sur une assiette |
| `text.ts` | le titre court et complet d'une étape, le détail à part ; le foyer du texte remis d'accord avec le foyer choisi |
| `audit.ts` | ce que le plan promet, vérifié de l'extérieur (tests, `pnpm plan:audit`) |

## Capacités réelles

Avant d'affecter un récipient, le planificateur calcule ce qu'il recevra au plus fort, quantités **mises à l'échelle** :
- un mijoté ou une sauce : les bols versés dans ce récipient depuis le début, l'eau écrite dans le texte (« + 540 ml d'eau », « eau à hauteur (environ 500 ml) »), le liquide d'un bol décrit en prep (« 2 cubes de bouillon dans 1,3 L d'eau ») ; à la dernière étape du récipient principal, ce qui a été saisi à la poêle avant et la viande hors bol ; tout compte pour 1 L par kilo, les feuilles 1,5 ;
- riz à l'absorption (1,5 fois son volume d'eau) : 3,8 L par kilo de riz cru au plus fort ;
- pâtes à grande eau : 8 L d'eau par kilo (2 L au moins) et 1,5 L par kilo ;
- légumes et œufs à l'eau : 2,5 L d'eau par kilo (1,5 L au moins) et 1,5 L par kilo.

Le récipient offre sa contenance (notée en réglages, sinon estimée d'après le fond et la hauteur) **remplie aux trois quarts quand ça bout, à 85 % pour un mijoté**. Exemple : 450 g de riz demandent 1,7 L, soit une casserole d'au moins 2,3 L ; la casserole de 2 L ne les reçoit jamais.

Si ça ne tient pas, dans l'ordre :
1. un récipient de rechange de la fiche qui tient, sinon le plus petit récipient de la cuisine qui va sur la plaque (et au four s'il le faut) et qui tient ; le plan dit pourquoi (« il faut environ 3,4 L, plus que n'en prend la grande casserole ») ;
2. pour une cuisson à l'eau, des fournées dans la même eau (la moitié, sortie à l'écumoire, puis l'autre) ;
3. sinon un avertissement clair (« environ 5 L dans le faitout, qui n'en prend que 4,5 L… ») : jamais un récipient trop petit en silence.

La poêle garde sa charge par fournée (500 g pour 28 cm). Au four, ce qui rôtit en une couche demande environ 1 cm² pour 1,5 g : le plan dit sur quelles plaques et quels plats l'étaler (les plaques du four comptent), ou prévient que la surface manque.

## Bases communes

Une **cuisson de base** est une cuisson à l'eau dont les bols ne contiennent qu'un aliment de base (riz, pâtes, semoule, quinoa, boulgour, haricots verts, brocoli, petits pois), déduit de l'aliment (`food`) de la fiche. Elle ne retient pas sa recette (le riz se garde à part), seul le rangement l'attend.

Quand plusieurs recettes cuisent la même base de la même façon, le planificateur en fait **une seule cuisson** dans le récipient qui la tient, puis une sous-étape « Partage le riz : 1 kg cuit pour …, 1,1 kg cuit pour … » (poids cuit estimé : riz × 2,5, pâtes × 2,2…). Trop pour un récipient : le moins de cuissons possible (une recette entière par cuisson), dans les récipients les moins pris par ailleurs. Le plan le dit dans ses décisions.

## Bols de prep

Les lettres du plan (bol A, bol B…) restent celles des fiches. Chaque groupe trouve où attendre :
- **au moment** : rien à couper ni à mélanger, des choses qui se versent ou se pèsent (une boîte de pulpe, la crème, le riz rincé dans la passoire) ; à plusieurs, seulement dans un mijoté, une eau ou un four, pas dans une saisie. Pas de pesée en prep : l'étape les liste (« Pèse et verse : pulpe de tomate 800 g, concentré 30 g, miel 15 g ») ;
- **un bol ou une boîte** de l'inventaire de la cuisine (Réglages › Cuisine › Bols et boîtes) : le plus petit qui convient (rempli à 90 %), une boîte fermée pour la nuit au frigo, réutilisé dès qu'il se vide (rincé en 1 min) ; deux groupes qui entrent ensemble dans le récipient partagent un bol (jamais avec de la viande crue) ; trop gros pour un seul, deux bols ;
- faute de bol libre : une pesée attend le moment, des légumes coupés une **assiette**, un autre groupe se remplit quand un bol se vide (`fillAfter`, le plan le dit), sinon le plan dit combien de bols il manque.

## Attention

Chaque étape et chaque sous-étape portent un niveau d'attention :
- **mains** : la personne y est tout entière (saisir, égrener, peser, mettre en boîtes, ajouter un bol) ;
- **surveille** : on peut faire autre chose mais il faut revenir ; un rappel le dit (« Remue la sauce, gratte le fond » toutes les 5 min, « Remue » toutes les 2 min pour des oignons « de temps en temps », toutes les 3 min pour des pâtes ou un one-pot) ; une poêle vide qui préchauffe se pose (30 s aux mains) puis se surveille ;
- **libre** : attente pure (le four, l'eau qui chauffe couverte, le riz qui repose sans ouvrir).

Le temps « mains » d'une sous-étape longue sans attente est borné par le temps actif de la fiche. Le planificateur ne met **jamais deux moments « mains » en même temps** pour une personne, et à deux, une étape reste entière à une personne. Un geste court entre deux attentes (« Inverse les plats », 30 s) peut avancer ou reculer de 2 min, les attentes autour s'ajustent ; le dernier geste après une attente (sortir le plat, égrener) peut attendre 2 min, l'étape finit d'autant plus tard ; égoutter, jamais. `validatePlan` le vérifie (`hands_busy`, `person_busy`).

Une étape principale qui suit un à-côté (« Pendant que la sauce mijote : saisis le poulet ») l'attend : « Poulet dans la sauce » ne part qu'une fois le poulet saisi.

## Ce que le plan donne à l'interface

Champs ajoutés le 01/11/2026 (tous facultatifs : un plan enregistré avant reste lisible) :

| Où | Champ | Ce que c'est |
|---|---|---|
| `PlanStep` | `title`, `detail` | titre court et complet (jamais coupé dans une parenthèse), le reste du texte |
| | `attention` | `mains`, `surveille` ou `libre` pour l'étape dans l'ensemble |
| | `hands` | intervalles « mains » en minutes, même base que `startMin` |
| | `reminders` | `{ fromMin, untilMin, everyMin, text }`, minutes depuis le début de l'étape |
| | `ingredients` | `{ item, name, food, grams, units, qty, bowl, holder, recipeSlug, optional, phase }` : quantités mises à l'échelle, bol d'origine, sous-étape où il entre |
| | `base`, `shared` | cuisson de base (« riz ») et, partagée, la part de chaque recette `{ recipeSlug, bowl, rawG, cookedG, share }` |
| | `load` | `{ liters, usableL, mode }` : volume au plus fort et ce qu'offre le récipient |
| | `dishes` | au four : plaques et plats où étaler, surface demandée et offerte (cm²) |
| | `batches` | fournées (poêle, ou base à l'eau en plusieurs fois) |
| `StepPhase` | `attention`, `reminder` | par sous-étape |
| `PlanBowl` | `holder`, `container`, `containerLabel`, `with`, `fillAfter`, `liters` | où attend le groupe (`moment`, `bol`, `boite`, `assiette`), quel contenant, partagé avec qui, rempli quand quel bol se vide |
| `PlanBowlItem` | `grams`, `units` | quantités en nombres |
| `SessionPlan` | `containers` | `{ used, peak, owned, moment, plates, missing, storage }` : bols sortis, au plus fort, de la cuisine, au moment, sur assiette, manquants, boîtes de conservation |

Les gestes de pesée (« Pèse et verse : … ») donnent maintenant les quantités. `PLAN_VERSION` passe à 5 : les sessions ouvertes refont leur plan au réimport.

## Audit

`pnpm plan:audit` planifie toutes les paires dans trois cuisines fictives (standard, petite, grande) et tous les triplets dans la cuisine standard (`--tout` : dans chaque cuisine), seul et à deux, et vérifie avec `auditPlan` : aucun récipient trop petit en silence, pas plus de bols que l'inventaire (ou le plan le dit), bases regroupées, quantités sur chaque étape qui prend des bols, jamais deux tâches « mains » à la fois, aucune erreur. `--paires` affiche l'ancien tableau (durée face à la borne basse). Les tests de paires (`tests/planner-pairs.ts`) passent chaque paire à `auditPlan`.
