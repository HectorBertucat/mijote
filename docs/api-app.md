# API de l'app iPhone (v1)

L'app Mijote Santé affiche Santé, le journal, les plats du batch, la course et le sport en natif, et pilote la séance guidée. Elle lit et écrit par cette API ; la synchro d'Apple Santé reste sur `/api/sante/import` (docs/sante.md).

**Contrat additif** : on ajoute des routes et des champs, on n'en retire pas et on n'en change pas le sens. L'app ignore ce qu'elle ne connaît pas et n'affiche que ce que `features` annonce. Code : `src/lib/app-api/` (testé dans `tests/app-api.test.ts`), routes : `src/app/api/app/v1/`.

## Accès

- **Signal** : le `GET` de l'import (`/api/sante/import`) annonce `"app_v1"` dans `features` quand cette API existe. Sans lui, l'app n'appelle rien ici.

- Base : `<racine de l'instance>/api/sante/import/app/v1/` (conseillée), ou `<racine>/api/app/v1/` (la même API). La première est sous le préfixe de l'import : derrière Cloudflare Access, la règle « Service Auth » de `/api/sante/import` la couvre déjà ; la seconde demande sa propre règle, sinon Access répond par une redirection 302 vers sa page de connexion. Même code d'installation que l'import : l'URL, la clé de la personne et, derrière Cloudflare Access, le jeton de service.
- En-têtes : `X-Mijote-Key: <clé>` (obligatoire ; elle désigne la personne), `CF-Access-Client-Id` et `CF-Access-Client-Secret` si l'instance est derrière Access. Pas de mot de passe d'instance sur ce chemin : la clé suffit.
- Réponses en JSON : `{ ok: true, … }` ou `{ ok: false, error }` avec 400 (demande invalide), 401 (clé manquante ou inconnue), 404 (chemin, séance ou entrée inconnus, ou pas à cette personne), 409 (séance terminée).
- Corps des `POST` en JSON. Jours `AAAA-MM-JJ` (jour de Paris) ; instants des séances et des horloges en **ms depuis l'epoch, heure du serveur** (`now`, `state.serverTime`, l'événement `hello` du flux : l'app corrige l'écart avec son horloge et décompte en local) ; autres instants en ISO 8601 avec décalage.
- **Valeur absente = clé absente** : aucune réponse ne contient `null` dans un objet (le serveur retire ces clés). Dans un tableau, un trou reste à sa place (`null`), pour garder l'alignement d'une série.
- Chaque réponse porte `generatedAt` (ISO 8601) à la racine.
- **`actionId`** (facultatif, tout `POST`, chaîne de 80 caractères au plus, un uuid) : un renvoi du même `actionId` par la même personne ne refait pas l'action (réseau qui coupe) et répond 200 avec `replayed: true`. Il rejoue le `message` (et `serving`, `workoutId`…) du premier envoi, mais l'état est recalculé maintenant : `plats`, `jour`, `live` et `weighIns` sont ceux du moment du renvoi (un autre geste a pu passer entre-temps). Gardé en base 30 jours (table `app_actions`), redémarrages et déploiements compris ; deux renvois simultanés n'en font qu'un. Seuls les gestes réussis sont gardés : après un refus (400, 404, 409), le même `actionId` peut repartir. Le même `actionId` sur une autre route répond 409.

## Routes

| Route | Ce qu'elle rend ou fait |
|---|---|
| `GET moi` | `{ version: 1, features, person: { id, name }, today, running }` (`running` : plan de course actif) |
| `GET sante?periode=` | `{ overview, series, goals, review, waist, status }` (`status` : comme `GET statut`, ajouté le 3/11) : la vue d'ensemble de Santé (`periode` : `7j`, `30j` par défaut, `3m`, `1an`, `tout`, comme `/sante`), les objectifs, le repère de la semaine, les derniers tours de taille |
| `GET statut` | `{ status }` : « Où j'en suis » (annoncé par `"statut"`, ci-dessous) |
| `GET jour?date=` | `{ date, entries, totals, complete, todo: { planned, templates }, check, review }` : le journal d'un jour (aujourd'hui par défaut) ; `check` (ajouté le 3/11) : ce que « terminer » noterait |
| `POST jour` | une action sur le journal (ci-dessous) → `{ message, jour }` (le jour à jour) |
| `POST pesee` | `{ kg }` (25 à 350) → `{ message, weighIns }` |
| `GET plats` | `{ today, person, dishes, eaten, batch, avis }` : les plats du batch et les portions restantes de chacun, le bilan du batch du moment, le vocabulaire du retour de goût (ci-dessous) |
| `POST plats/manger` | `{ dishId, boxId?, grams?, date?, meal? }` → `{ message, serving, plats }` : « j'ai mangé une portion » |
| `POST plats/annuler` | `{ servingId }` → `{ message, plats }` : annule une portion mangée |
| `POST plats/reglage` | `{ dishId, weights?, left? }` → `{ message, plats }` : nouvelle pesée, portions restantes de chacun |
| `POST plats/base-refaire` | `{ family, rawG?, grams? }` → `{ message, plats }` : « C'est cuit », un nouveau gros récipient d'une base (le riz) |
| `POST plats/base-pesee` | `{ baseId, grams }` → `{ message, plats }` : nouvelle pesée d'un gros récipient |
| `POST plats/base-fini` | `{ baseId }` → `{ message, plats }` : le récipient est fini (vide, ou jeté) |
| `POST plats/avis` | `{ servingId?, dishId?, rating, tags?, note? }` → `{ message, avis, plats }` : le retour de goût après « j'ai mangé » (annoncé par `"gouts"`) |
| `GET course` | `{ enabled, view? }` : la vue de Santé › Course (`view` absent si le plan n'est pas actif). Les séances de la semaine (`view.week`…) gardent les ids des `plans` de la v2.1 (`/api/sante/import/plans`) : la séance du plan et celle programmée sur la montre ont le même id. |
| `GET course/sorties?before=&limit=` | `{ runs, more }` : les sorties, de la plus récente à la plus ancienne, avant le jour `before` (exclu), `limit` 20 par défaut (100 au plus) ; chacune avec `sampleId` et `uuid` (l'uuid HealthKit de la séance envoyée par l'app) ; `more` : il en reste |
| `GET sport` | `{ today, program, workouts, apple, guide, live, partner }` |
| `GET sport/figures?ex=a,b&programme=` | `{ drawing, figures }` : les figures animées (tous les exercices du programme si `ex` est vide, plus la figure de repli `jPlank` si l'un d'eux n'a pas la sienne) |
| `GET sport/figures/<id>` | une figure seule : `{ id, version, loop, cycle, fps, keys, steps, cues, frames, props, gear, accessories, muscles }` |
| `POST sport/reglages` | `{ auto?, lead?, change? }` → `{ guide }` : réglages du rythme guidé de la personne ; une séance en cours les prend tout de suite |
| `GET sport/seance` | `{ live }` : la séance en cours de la personne (moins de 6 h) ; `live` absent s'il n'y en a pas |
| `POST sport/seance` | `{ type?, duo? }` → `{ live }` : lance une séance (`type` : `A`, `B`… ; par défaut la suivante du programme ; `duo: true` lance aussi celle de l'autre personne qui a un programme, côte à côte sur l'écran du site) |
| `GET sport/seance/<id>` | `{ live }` ; avec `?since=<revision>` : attente longue, la réponse part dès que la séance passe au-delà de cette révision (ou se termine), au plus tard après 25 s |
| `POST sport/seance/<id>/action` | un geste nommé (ci-dessous) → `{ live }` ; 409 avec `{ live }` si `revision` est périmée |
| `POST sport/seance/<id>/geste` | un geste (ci-dessous) → `{ live }` |
| `POST sport/seance/<id>/fin` | `{ note }` (enregistre dans le carnet) ou `{ abandon: true }` → `{ message, workoutId }` |
| `GET sport/seance/<id>/flux` | flux SSE : `event: hello` `{ now }`, puis un `data:` (le même objet que `live`) à chaque changement, un commentaire toutes les 15 s |

### Actions du journal (`POST jour`)

`action` et `date` toujours ; une date future est refusée.

| `action` | Champs |
|---|---|
| `recette` | `meal` (`breakfast`, `lunch`, `dinner`, `snack`), `recipeId`, `units`, `plan` (vient du prévu de la Semaine) |
| `habitude` | `templateId` (une des `todo.templates`) |
| `libre` | `meal`, `label`, `kcal`, `proteinG`, `fatG?`, `carbsG?` |
| `parts` | `id` (une entrée du jour), `units` |
| `retirer` | `id` |
| `complete` | `complete` (la journée compte ou non pour la cible) |
| `terminer` | `planned?` (clés `<meal>:<recipeId>` de `check.planned`), `templates?` (ids de `check.templates`) : note ces lignes puis marque la journée complète, en un geste ; sans liste, tout ce que propose `check` (annoncé par `"terminer"`) |

`check` : `{ planned: [clé], templates: [id], empty: ["lunch" | "dinner"], ready }`. `planned` et `templates` : les repas prévus de la Semaine pas encore notés et les habitudes prévues ce jour-là, à proposer cochés ; `empty` : midi ou soir sans rien de noté ni de prévu (à ajouter, ou sauté) ; `ready` : rien de tout ça.

## Où j'en suis (`GET statut`)

Annoncé par `"statut"`. Tout est calculé par le serveur (`src/lib/health/status.ts`) : l'app affiche les phrases et les chiffres reçus.

```
{ status: { person: { id, name }, goal?, targetWeightKg?, headline,
  trend?: { kg, rateKg?, ratePct?, aimedKg, aimedPct, pace?, text },
  target?: { kcal, proteinG, tdee, confidence, word, text },
  update: { next, window: { start, end }, complete: { have, need, daysLeft }, weighIns: { have, need, thisWeek },
            firstWeighOk, ready, nextConfidence, measuredBy? },
  todo: [string],
  protein: { target?, avg?, days, fromComplete, mode, perKg?, suggestPerKg? },
  portions: { mode, ref?, targetRef?, follows, limited, text, next? },
  days: [{ date, kcal?, proteinG?, complete }] } }
```

- `target.confidence` : `adaptive` (dépense mesurée), `holding` (en attente : la dernière dépense mesurée), `estimate` (formule) ; `word` : « mesurée », « en attente », « estimation ».
- `update` : la prochaine mise à jour (`next`, un lundi) et sa fenêtre de 21 jours ; `complete` et `weighIns` : ce qui est déjà là et ce qu'il faut (12 journées complètes, 3 pesées) ; `daysLeft` : jours encore notables d'ici dimanche ; `ready` : lundi, la dépense sera mesurée ; `nextConfidence` : d'où elle viendra sinon ; `measuredBy` : le premier lundi possible en notant chaque journée complète.
- `todo` : ce qui manque, en phrases (« 2 journées complètes de plus d'ici dimanche… », « Pèse-toi une fois de plus d'ici dimanche… ») ; vide si `ready`. `headline` : la phrase de tête (la cible et la première chose à faire, toujours présente).
- `trend.pace` : `rythme`, `lent`, `rapide`, `inverse`, `stable` (maintien tenu), `ecart` (le poids bouge en maintien) ; `rateKg` et `aimedKg` en kg par semaine.
- `protein` : `avg` sur `days` journées complètes des 14 derniers jours (`fromComplete`), sinon sur les jours notés de la semaine ; `mode` : `g` (grammes fixes) ou `gkg` ; `suggestPerKg` : en recomposition avec des grammes fixes, le même apport en g/kg.
- `portions` : `mode` `auto` (le repère suit la cible chaque lundi) ou `fixe` (il ne la suit pas : `follows: false`) ; `ref` : le repère d'un repas `{ kcalMin, kcalMax, proteinMin, proteinMax }`, `targetRef` : ce que la cible seule donnerait, `limited` : le pas de la semaine l'a retenu.
- `days` : les jours de la fenêtre, d'aujourd'hui en arrière (`kcal` absent : rien de noté).

## Plats (la réserve du batch)

Annoncé par `"plats"` dans `features`. Ce qui est fixe, c'est **qui mange combien de portions de quel plat** ; le jour où on le mange est libre (la Semaine reste un prévisionnel). Une marmite cuite est une **réserve** : des **groupes** servis séparément (le plat et sa sauce, le riz, les haricots verts), pesés en fin de session, et un nombre de portions par personne. Une portion est en grammes de chaque groupe, calculée par le code d'après le repère de la personne (kcal et protéines), sans jamais plus de féculent que la proportion de la marmite. Chaque portion mangée retire ses grammes de la réserve, et **les portions restantes de chacun se recalculent** sur ce qui reste : l'app affiche les chiffres reçus, sans recalculer. Une portion peut être dans le grand récipient (au frigo) ou rangée dans une boîte (frigo ou congélo, ses grammes sont figés). Code : `src/lib/reserve/`.

### `GET plats`

```
{ today, person: { id, name },
  dishes: [{ id, recipeId, slug, name, status, cookedOn?, limit?, freshness?,
             groups: [{ key, label, kind, leftG?, estimated? }],
             people: [Share], rest?: { grams: [Gram], kcal? }, boxes: [Box], short,
             sessionId?, estimated }],
  eaten: [Serving],
  avis: { ratings: [{ id, label }], tags: [{ id, label }] },
  batch?: { id, title, cookedOn, dishes, toWeigh, portions, left, estimated,
            items: [{ dishId, recipeId?, slug?, name, open, weigh }] },
  bases: [Base], freeze: [Freeze] }
```

- **`dishes`** : les plats en réserve, le plus pressé d'abord, puis (`status: "planned"`) les plats de la période en cours pas encore cuisinés, avec seulement les portions prévues (`people[].total`, pas de grammes). `status: "cooked"` : en réserve. `limit` (`AAAA-MM-JJ`) et `freshness` (`ok`, `soon` : aujourd'hui ou demain, `past` : à jeter) : la date limite du grand récipient au frigo (cuisson + jours de conservation de la recette).
- **`estimated`** (ajouté le 2/11) : `true` tant qu'un groupe du plat n'est pas pesé : une session finie sans pesée met quand même ses plats en réserve, chaque groupe estimé d'après le cru (les grammes de la session × le rendement de cuisson) et les portions de chacun d'après la Semaine. Les grammes affichés sont alors approximatifs (« ≈ », « estimé ») ; on peut déjà manger. La pesée tardive passe par `POST plats/reglage` (`weights` : ce qui reste dans le grand récipient) : les kcal restantes ne changent pas, seulement les grammes. `sessionId` : la session qui l'a cuit (le bilan du site : `/plats/batch/<sessionId>`).
- **`batch`** (ajouté le 2/11) : le batch du moment, le plus récent dont un plat est encore en réserve (absent sinon). `title` (« Le batch du 1er novembre »), `cookedOn`, `dishes` (plats cuits), `toWeigh` (encore en réserve et pas entièrement pesés), `portions` (de tout le foyer, en tout), `left` (restantes), `estimated` (`toWeigh > 0`) ; `items[]` : un plat par ligne, `dishId` (un des `dishes[].id`), `open` (encore en réserve), `weigh` : `estimated` (rien de pesé), `partial` (en partie), `weighed`.
- **`groups`** : dans l'ordre d'affichage. `key` (stable : `plat`, `riz`, `haricots-verts`…), `label` (« plat », « riz », « haricots verts »), `kind` : `main` (le plat, la viande et sa sauce), `starch` (féculent), `veg` (légume), `other`. `leftG` : grammes restants dans le grand récipient (hors boîtes). `estimated: true` : pas pesé, estimé d'après les grammes crus. `base` (ajouté le 3/11) : une base du foyer (ci-dessous) ; son `leftG` est alors ce qui revient au plat (la proportion de la marmite), pas un récipient à part, et elle ne compte ni dans `estimated` ni pour dire le plat fini.
- **`Gram`** : `{ key, label, g, base? }`, une ligne par groupe, dans l'ordre de `groups`, grammes arrondis à 5 g. `base` (ajouté le 3/11) : ce groupe se sert dans le gros récipient de cette base (`riz`), pas dans celui du plat : « plat 210 g + riz 185 g, dans le récipient de riz ».
- **`Share`** (`people[]`, la personne de la clé d'abord, avec `me: true` ; puis les autres : « la part de l'autre ») :

```
{ personId, name, me, total, eaten, left, inBoxes,
  portion?: { grams: [Gram], kcal?, protein? },
  next?: { source, boxId?, grams: [Gram], kcal?, protein? } }
```

  `total` : portions de ce plat pour elle en tout ; `eaten` : déjà mangées ; `left` : restantes (`total − eaten`, jamais négatif) ; `inBoxes` : dont rangées en boîtes. `portion` : une portion à se servir dans le grand récipient (absente s'il n'y en a plus pour elle ou si le plat n'est pas cuisiné). `next` : ce que sert « manger » sans autre précision : `source: "recipient"` (le grand récipient, grammes de `portion`) ou `"boite"` (sa boîte au frigo la plus pressée, `boxId`) ; absent quand il ne lui reste rien.
- **`rest`** : ce qui dépasse le haut des repères de tous, pour qui veut (absent le plus souvent). **`short`** : `true` quand le grand récipient ne couvre pas les portions visées (chacune est plus petite que sa part).
- **`Box`** : `{ id, personId?, place: "fridge" | "freezer", thawed, limit, freshness, grams: [Gram], kcal?, protein? }` ; `personId` absent : pour qui veut.
- **`eaten`** (`Serving`) : les portions mangées par la personne ces trois derniers jours, la plus récente d'abord, pour proposer « Annuler » :

```
{ id, dishId, name, slug?, date, meal, at, source, boxId?, grams: [Gram], kcal, protein, entryId }
```

  `at` : instant (ISO 8601) ; `meal` : `breakfast`, `lunch`, `dinner`, `snack` ; `entryId` : sa ligne du journal (`GET jour`). `avis` (ajouté le 3/11, annoncé par `"gouts"`) : `{ rating, tags }`, le retour de goût déjà donné pour cette portion (absent sinon), pour ne pas le redemander.
- **`avis`** (ajouté le 3/11) : le vocabulaire du retour de goût, dans l'ordre d'affichage. `ratings` : `love` (« j'adore »), `ok`, `meh` (« bof ») ; `tags` : `sec`, `dense` (« trop dense »), `fade`, `epice` (« trop épicé »), `gras` (« trop gras »), `portion` (« portion trop grosse »), `referais` (« je referais »). L'app affiche les `label` reçus.

### Bases (ajouté le 3/11)

Annoncé par `"bases"` dans `features`. Le riz, les haricots verts, les pommes de terre cuits à part en grande quantité vont dans de **gros récipients** où chacun se sert à chaque repas, pour tous les plats de la période : ce sont les **bases du foyer**. Une base mélangée au plat (riz cuit dans la sauce, one-pot) reste dans la recette. Manger une portion d'un plat retire aussi ses grammes de base du récipient (le plus ancien d'abord). L'app affiche les chiffres reçus. Code : `src/lib/reserve/bases.ts`.

```
Base: { family, label, the, leftG, limit?, freshness?, portionG, needG, low, fridgeDays,
        containers: [{ id, cookedOn, limit, freshness, leftG, cookedG, estimated, sessionId?, boxes? }],
        dishes: [{ dishId, name }],
        remake: { family, cookedG, rawG, waterL, pot?: { id, name }, batches, minutes, boxes?, steps, pantryG? },
        freeze: { ok, how, portions, g, by? } }
Freeze: { dishId, name, slug?, ok, portions, people: [{ personId, name, n }], by, note? }
```

- **`bases`** : une ligne par base (`family` : `riz`, `pates`, `semoule`, `quinoa`, `boulgour`, `pommes-de-terre`, `patates-douces`, `haricots-verts`, `brocoli`, `chou-fleur`, `petits-pois`, `epinards`, `courgettes`, `carottes`), celles à refaire d'abord. `leftG` : ce qui reste en tout ; `containers` : chaque gros récipient (`id` = `baseId` des gestes), le plus ancien d'abord (c'est lui qui sert), sa limite au frigo (`cookedOn` + `fridgeDays`), `boxes` : combien de gros récipients ce qui reste remplit. `portionG` : la plus grande portion de base servie en ce moment (150 g sans portion) ; `needG` : grammes encore prévus dans les portions restantes des plats qui la prennent ; **`low`** : moins de deux portions, « Refaire du riz ».
- **`remake`** : ce qu'il faut pour en refaire, d'après la cuisine réglée : `rawG` de cru (de quoi servir `needG`, au moins un gros récipient, au plus tous), `waterL` d'eau par fournée, `pot` (la plus petite casserole qui le tient ; `batches` > 1 : en fournées dans la plus grande), `minutes` en tout, `boxes` gros récipients à remplir (absent sans gros récipient réglé), `steps` (trois gestes, à afficher tels quels), `pantryG` (ce que le placard suivi en a, absent sans lot).
- **`freeze`** (d'une base) : `ok` (se congèle, `how` : comment, ou pourquoi pas), `portions` de `portionG` à congeler `by` (la limite au frigo du récipient qui sert) : ce qui dépasse ce qui sera servi d'ici là.
- **`freeze`** (la liste) : les plats dont des portions ne seront pas mangées avant leur limite au frigo (`by`) : les repas prévus par la Semaine d'ici là, sinon deux repas par jour partagés entre les plats ouverts. `ok: true` : à congeler (« 2 portions de poulet teriyaki d'ici jeudi », `people` : combien de chacun ; `note` : ce qui se congèle mal dans le plat) ; `ok: false` : la fiche ne se congèle pas, à manger d'abord.

`POST plats/base-refaire` : `{ family, rawG?, grams? }`, `rawG` (cru, le cuit est estimé : × rendement) ou `grams` (pesé cuit, sans le récipient), l'un des deux ; un nouveau récipient, cuit aujourd'hui. 404 : base inconnue ; 400 : ni cru ni cuit. `POST plats/base-pesee` : `{ baseId, grams }` (0 à 50 000), ce qui reste dans ce récipient. `POST plats/base-fini` : `{ baseId }`, le récipient sort (404 inconnu). Tous répondent `{ message, plats }`.

### `POST plats/manger`

`{ dishId, boxId?, grams?, date?, meal? }` → `{ message, serving, plats }` (`plats` : la même réponse que `GET plats`, à jour).

- Sans `boxId` ni `grams` : la portion `next` de la personne. Plusieurs fois par jour, le même plat deux fois : permis.
- `boxId` : mange cette boîte (une des `boxes`, à la personne ou pour qui veut), entière.
- `grams` : `{ <key>: g }` (0 à 3 000 par groupe), ce que la personne a vraiment pris dans le grand récipient ; un groupe absent compte pour 0. Les kcal et protéines en sont recalculés.
- `date` (aujourd'hui par défaut, jamais dans le futur) et `meal` (par défaut d'après l'heure de Paris : `lunch` de 10 h à 16 h, `dinner` à partir de 17 h, `snack` sinon).
- Une ligne s'ajoute au journal du jour (kcal et protéines de la portion), comme « Je la mange » sur le site. Si la personne n'avait plus de portion de ce plat, son `total` monte d'une (les autres portions rapetissent pour tout répartir).
- 404 : plat ou boîte inconnus ; 409 : plus rien à servir dans ce plat (récipient vide et plus de boîte).

### `POST plats/annuler`

`{ servingId }` (un des `eaten[].id`) → `{ message, plats }`. La ligne du journal est retirée, les grammes reviennent dans le grand récipient (ou la boîte revient au frigo), les portions se recalculent. 404 si ce n'est pas une portion de cette personne. Retirer la ligne par `POST jour` (`retirer`, `id` = `entryId`) fait la même chose.

### `POST plats/avis`

Annoncé par `"gouts"` dans `features` (ajouté le 3/11). `{ servingId?, dishId?, rating, tags?, note? }` → `{ message, avis: { id, recipeId, rating, tags, note?, at }, plats }` : ce que la personne a pensé du plat, en un geste après `POST plats/manger` (l'`id` de son `serving`).

- `servingId` (une de ses portions, `eaten[].id`) ou, à défaut, `dishId` (un des `dishes[].id`) : la recette notée est celle du plat. Au moins l'un des deux ; 404 si la portion n'est pas à elle ou si le plat est inconnu.
- `rating` : `love`, `ok` ou `meh` ; `tags` : parmi `avis.tags[].id` ; `note` : 500 caractères au plus. 400 sinon.
- Un retour par repas, gardé ; c'est le plus récent de chacun qui compte. Le site s'en sert : pastille et tri de la Semaine (un « bof » pas encore ajusté n'est plus proposé d'office), ajustement proposé sur la fiche (variante enregistrée, l'originale reste), contexte de l'assistant et de l'atelier. Code : `src/lib/feedback/`.

### `POST plats/reglage`

`{ dishId, weights?, left? }` → `{ message, plats }` : réajuster après coup.

- `weights` : `{ <key>: g }` (0 à 50 000), une nouvelle pesée de ce qui reste dans le grand récipient (hors boîtes), pour les groupes pesés.
- `left` : `{ <personId>: n }` (0 à 30), les portions restantes voulues pour une personne (une de plus, une de moins).

## Sport

`program.exercises[]` : la fiche (`name`, `short`, `reps: [min, max]`, `uni`, `unit: "s"` pour une tenue, `tempo`, `cues`, `errors`, `ladder`, `guide`), plus `gear` (`[{ id, label }]`), `pattern`, `muscles` (`[{ id, label, load }]`, `load` 3 = cible, 2 = aide, 1 = stabilise, du plus au moins sollicité), `level` (cran en cours), `last` (la dernière fois), `ready` (prêt à monter d'un cran), `hasFigure`, `cycle` (durée d'une répétition au rythme guidé, en secondes : celle de la figure, ou de la figure de planche si l'exercice n'en a pas, comme le site ; la série dure `reps × cycle`), `guideFigure` (l'id de la figure qui rythme la série : courbe du guide, mots de phase, `cycle` ; l'exercice lui-même s'il a sa figure, sinon `jPlank`, la planche, comme le site ; servie par `GET sport/figures` et comptée dans `figureIds`).

`guide` : `{ auto, lead, change }` : enchaînement automatique, secondes de mise en place avant une série (0 à 30), secondes pour passer d'un exercice à l'autre dans un superset (0 à 90).

### La séance (`live`)

```
{ id, personId, version, ended, now, state, figureIds,
  live: { program, type, steps, i, t0, log, levels, cur: { reps?, guide?, restEnd?, emom?, paused? }, pair?, opts? },
  opts: { auto, lead, change },
  view: { step, exercise?, reps?, restLeft?, next?: { step, exercise }, paused } }
```

- **`state`** : ce que l'app affiche sans recalculer : `{ revision, serverTime, phase, phaseEndsAt?, pausedPhase?, side?, auto }`. `revision` = `version` (monte à chaque changement). `phase` : `warmup` (échauffement, attend un geste), `setup` (mise en place avant une série ou le finisher), `work` (série ou finisher en cours ; sans rythme guidé, pas de `phaseEndsAt` : elle attend `log`), `switch` (changement de côté), `rest`, `bonus` (gainage proposé), `paused` (avec `pausedPhase`, sans `phaseEndsAt`), `done`. `phaseEndsAt` : fin de la phase en ms, heure du serveur. `side` : côté en cours d'un exercice unilatéral.
- **Gestes automatiques** : `state.autoGesture` (`record` d'une série guidée ou du finisher, `go` d'un repos), `state.autoAt` et `state.autoUntil` (ms, heure du serveur). Un écran envoie ce geste seul quand l'heure du serveur est entre `autoAt` et `autoUntil` (5 minutes) ; après, la séance a été oubliée : il attend un geste de la personne (`log`, `next`). Absents en pause et quand la phase attend un geste. Le site applique la même règle.
- **`figureIds`** : les figures dont la séance a besoin (à télécharger avant de commencer), la figure de repli comprise (le `guideFigure` de chaque exercice) ; `GET sport` les donne aussi par séance du programme (`program.figureIds.A`…).
- `steps[i]` est l'étape affichée : `warm`, `ex` (`ex`, `set`, `sets`, `block`), `rest` (`sec`), `emom` (`ex`, `rounds`, `every`, `reps`, `block`), `bonus`, `end`. `view.exercise` est la fiche de l'exercice en cours (forme de `program.exercises[]`), `view.reps` l'objectif de la série.
- **Rythme guidé** : `cur.guide` est l'heure de départ ; elle peut être dans le futur (la mise en place). Avec `T` = (`cur.paused` ?? heure du serveur) − `cur.guide`, en secondes, et `dur` = `reps × cycle` (ou `reps` secondes pour une tenue) :
  - `T < 0` : mise en place, `−T` secondes restantes (bips à 3, 2, 1) ;
  - `T < dur` : en cours, côté 1 ; la figure se lit à `T mod cycle`, la répétition en cours est `floor(T / cycle) + 1` ;
  - unilatéral (`uni`) : de `dur` à `dur + 5`, changement de côté, puis côté 2 jusqu'à `2 × dur + 5` ;
  - ensuite : fini. Un écran envoie alors `record` (1,2 s après la fin, et seulement dans les 5 minutes qui suivent : voir `state.autoGesture`) avec `value` = l'objectif (des répétitions, ou des secondes pour une tenue) ; le serveur ignore les doublons.
- **Repos** : `cur.restEnd` ; `view.restLeft` en secondes. À 0, un écran envoie `go` `n: 1`.
- **Finisher** (`emom`) : `cur.emom` est le départ (peut être dans le futur : mise en place) ; un tour toutes les `every` secondes.
- **Pause** : `cur.paused` fige toutes ces horloges à cet instant ; `resume` les décale du temps passé.
- **Mode automatique** (`opts.auto`) : à l'arrivée sur une série ou un finisher, le serveur pose lui-même le départ après la mise en place (`lead`, ou `max(lead, change)` quand l'exercice d'avant, sans repos entre, était un autre).

### Gestes (`POST sport/seance/<id>/geste`)

Le serveur applique le geste à l'heure du serveur (le même `act` que le site, `src/lib/training/live.ts`). `at` = l'étape où le geste est fait (`live.i`) : rejoué sur une étape déjà passée, il ne fait rien (deux écrans, un appui en double).

| `k` | Champs | Effet |
|---|---|---|
| `go` | `at`, `n` (1 ou −1) | étape suivante ou précédente |
| `record` | `at`, `ex`, `set`, `value`, `level?` | note la série et passe à la suite |
| `correct` | `ex`, `set`, `value` | corrige une série déjà notée |
| `level` | `ex`, `level` | change de variante |
| `reps` | `at`, `reps` | objectif de la série |
| `guide` | `at`, `on`, `reps?`, `lead?` | lance le rythme guidé (après `lead` ou `opts.lead` secondes) ou l'arrête |
| `pause`, `resume` | `at` | pause, reprise |
| `lead+` | `at`, `sec` | allonge la mise en place (`sec` négatif : « Go », part tout de suite) |
| `rest+` | `at`, `sec` | allonge le repos |
| `emom` | `at` | lance le finisher (après la mise en place) |
| `bonus` | `at` | ajoute le gainage proposé |
| `opts` | `opts: { auto?, lead?, change? }` | réglages du rythme (gardés pour la personne) |

### Gestes nommés (`POST sport/seance/<id>/action`)

`{ action, revision?, actionId?, reps?, sec? }`, appliqués à l'étape en cours (même effet que les gestes ci-dessus) :

| `action` | Effet |
|---|---|
| `start` | lance le rythme guidé (après la mise en place ; `reps` : objectif) ou le finisher ; à l'échauffement, passe à la suite |
| `stop` | arrête le rythme guidé |
| `start_now` | « Go » : fin de la mise en place tout de suite |
| `more_time` | `sec` de plus (5 par défaut à la mise en place, 15 au repos) |
| `pause`, `resume` | pause, reprise |
| `next`, `skip`, `previous` | étape suivante, suivante, précédente |
| `auto_on`, `auto_off` | mode automatique (gardé pour la personne) |
| `log` | note la série en cours (`reps`, sinon l'objectif) ou le finisher, et passe à la suite. La charge et l'effort ressenti ne sont pas encore gardés par Mijote : ne pas les envoyer |

## Les figures

`drawing.figure` : `{ viewBox: "0 -22 200 214", groundY: 187, joints }` ; `figures[ex]` :

```
{ cycle, fps, keys, steps: [{ to, dur, label, count }], frames: [{ j: [x0, y0, x1, y1, …], bell?: { hand, at: [x, y] }, step }],
  props: [{ kind, x, y, w, h, back? }], gear: [...], muscles: [{ id, label, load }] }
```

- `version` : change quand la figure ou son dessin change (l'app garde une figure tant que sa version ne bouge pas). `loop` : toujours `true` (une répétition qui boucle). `cues` : `[{ t, label }]`, le début de chaque étape du tempo dans la répétition, en secondes. `muscles[].role` : `primary` (cible, `load` 3), `secondary` (aide, 2), `stabilizer` (stabilise, 1).
- `accessories` : le matériel à plat : `{ type: "kettlebell", attachedTo: [main], position: "frames[].bell.at" }` (la boule bouge par image), `{ type: "dumbbell", attachedTo: [mains] }`, `{ type: "band", from, attachedTo: [mains] }`, `{ type: "miniband", attachedTo: ["kneeN", "kneeF"] }`, `{ type: "bench" | "chair" | "sofa" | "counter", rect: { x, y, w, h }, back? }`. Même contenu que `props`, `gear` et `frames[].bell`, sous une seule forme.
- `keys` : le nombre de poses clés de la figure (`steps[].to` va de 0 à `keys − 1`). Dans le guide du rythme, la pose `k` est à la hauteur `1 − k / (keys − 1)` (1 si `keys ≤ 1`) : en haut la pose de départ, en bas la dernière, comme `keyLevel` (`src/lib/training/rhythm.ts`). Ajouté sans changer `version` : une figure gardée d'avant peut ne pas l'avoir (repli : `max(steps[].to) + 1`).
- `frames` : une répétition échantillonnée à `fps` images par seconde (`frames.length = ceil(cycle × fps)`) ; l'image à l'instant `t` est `frames[floor((t mod cycle) / cycle × length)]` (interpoler entre deux images est permis). `j` donne x, y pour chaque articulation dans l'ordre `drawing.figure.joints` : `hip, shoulder, neck, head, kneeN, ankleN, toeN, kneeF, ankleF, toeF, elbowN, handN, elbowF, handF`. Repère y vers le bas ; N = côté proche, F = côté éloigné. `step` : l'étape du tempo en cours (`steps[step].label` est le mot affiché).
- **Dessin** (comme `src/lib/training/draw.ts`) : membres en capsules galbées, rayon au départ → à l'arrivée : cuisse (hip → knee) 6,6 → 5 ; tibia (knee → ankle) 5 → 3,6 ; pied (ankle → toe) 3,3 → 2,4 ; bras (shoulder → elbow) 4,4 → 3,6 ; avant-bras (elbow → hand) 3,6 → 3 ; main : disque de 3,5. Buste (hip → shoulder) 7,8 → 9,2, cou (shoulder → neck) 3,8 → 3,6, tête : disque de 11 centré sur `head`. Ordre : sol, tapis, ombre, matériel posé, côté F (en retrait), buste, cou, tête, côté N, matériel tenu.
- **Kettlebell** (`bell`) : l'anse dans la main `hand`, la boule (rayon 7,6) à `at`.
- **`gear`** : `{ kind: "dumbbell", hands }` (haltères dans ces mains : barre de 16 en travers de l'avant-bras, un disque à chaque bout ; ils remplacent la kettlebell), `{ kind: "band", from, to }` (élastique tendu de l'articulation `from` aux mains `to`), `{ kind: "miniband" }` (mini-bande juste sous les deux genoux).
- **`props`** : un rectangle dont le haut est la surface d'appui ; `kind` : `bench` (banc), `chair` (chaise, dossier du côté `back`, gauche par défaut), `sofa` (canapé), `counter` (plan de travail).
- **Tapis** : pour les exercices au sol, sous le corps (à calculer sur les poses, ou à poser de x = 10 à 190).

### Les séries (`GET sante` → `series`)

Les courbes de la vue d'ensemble, à plat pour Swift Charts : `{ steps, activeKcal, exercise, restingHr, hrv, sleep, weight }`, chacune `{ unit, grain, mode, points: [{ date, value }] }` (seulement celles qui ont des mesures). `date` = premier jour du paquet ; `grain` = `day`, `week` ou `month` (les courbes du cœur restent au jour jusqu'à un an) ; `mode` : `mean` (moyenne par jour mesuré) ou `sum` (total du paquet). Unités : `pas/jour`, `kcal/jour`, `min`, `bpm`, `ms`, `min/nuit`, `kg`. `weight.extra.trend` : la tendance lissée, `[{ date, value, range? }]` (`range` : plus basse et plus haute pesée du paquet). Les objectifs restent dans `goals`.

`drawing.body` : la carte des muscles : `{ viewBox: "0 0 120 256", mirrorX: 60, limbs, shapes, front, back }`. On dessine la moitié gauche puis son miroir autour de x = 60 : la silhouette (`shapes` : tracés pleins ; `limbs` : segments arrondis `{ a, b, w }`), puis chaque muscle de `front` (vue de face) et `back` (vue de dos), des tracés SVG simples (commandes `M`, `L`, `C`, `Z`). Teinte : cible pleine (qui s'allume au tempo pendant le rythme), aide à 55 %, stabilise à 28 %, le reste en neutre.
