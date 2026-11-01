# API de l'app iPhone (v1)

L'app Mijote Santé affiche Santé, le journal, la course et le sport en natif, et pilote la séance guidée. Elle lit et écrit par cette API ; la synchro d'Apple Santé reste sur `/api/sante/import` (docs/sante.md).

**Contrat additif** : on ajoute des routes et des champs, on n'en retire pas et on n'en change pas le sens. L'app ignore ce qu'elle ne connaît pas et n'affiche que ce que `features` annonce. Code : `src/lib/app-api/` (testé dans `tests/app-api.test.ts`), routes : `src/app/api/app/v1/`.

## Accès

- **Signal** : le `GET` de l'import (`/api/sante/import`) annonce `"app_v1"` dans `features` quand cette API existe. Sans lui, l'app n'appelle rien ici.

- Base : `<racine de l'instance>/api/sante/import/app/v1/` (conseillée), ou `<racine>/api/app/v1/` (la même API). La première est sous le préfixe de l'import : derrière Cloudflare Access, la règle « Service Auth » de `/api/sante/import` la couvre déjà ; la seconde demande sa propre règle, sinon Access répond par une redirection 302 vers sa page de connexion. Même code d'installation que l'import : l'URL, la clé de la personne et, derrière Cloudflare Access, le jeton de service.
- En-têtes : `X-Mijote-Key: <clé>` (obligatoire ; elle désigne la personne), `CF-Access-Client-Id` et `CF-Access-Client-Secret` si l'instance est derrière Access. Pas de mot de passe d'instance sur ce chemin : la clé suffit.
- Réponses en JSON : `{ ok: true, … }` ou `{ ok: false, error }` avec 400 (demande invalide), 401 (clé manquante ou inconnue), 404 (chemin, séance ou entrée inconnus, ou pas à cette personne), 409 (séance terminée).
- Corps des `POST` en JSON. Jours `AAAA-MM-JJ` (jour de Paris) ; instants des séances et des horloges en **ms depuis l'epoch, heure du serveur** (`now`, `state.serverTime`, l'événement `hello` du flux : l'app corrige l'écart avec son horloge et décompte en local) ; autres instants en ISO 8601 avec décalage.
- **Valeur absente = clé absente** : aucune réponse ne contient `null` dans un objet (le serveur retire ces clés). Dans un tableau, un trou reste à sa place (`null`), pour garder l'alignement d'une série.
- Chaque réponse porte `generatedAt` (ISO 8601) à la racine.
- **`actionId`** (facultatif, tout `POST`, chaîne de 80 caractères au plus, un uuid) : un renvoi du même `actionId` avec la même clé rend la réponse du premier envoi sans refaire l'action (réseau qui coupe). Gardé en mémoire pour les 500 derniers gestes : l'app n'en renvoie pas un vieux de plusieurs heures.

## Routes

| Route | Ce qu'elle rend ou fait |
|---|---|
| `GET moi` | `{ version: 1, features, person: { id, name }, today, running }` (`running` : plan de course actif) |
| `GET sante?periode=` | `{ overview, series, goals, review, waist }` : la vue d'ensemble de Santé (`periode` : `7j`, `30j` par défaut, `3m`, `1an`, `tout`, comme `/sante`), les objectifs, le repère de la semaine, les derniers tours de taille |
| `GET jour?date=` | `{ date, entries, totals, complete, todo: { planned, templates }, review }` : le journal d'un jour (aujourd'hui par défaut) |
| `POST jour` | une action sur le journal (ci-dessous) → `{ message, jour }` (le jour à jour) |
| `POST pesee` | `{ kg }` (25 à 350) → `{ message, weighIns }` |
| `GET course` | `{ enabled, view? }` : la vue de Santé › Course (`view` absent si le plan n'est pas actif). Les séances de la semaine (`view.week`…) gardent les ids des `plans` de la v2.1 (`/api/sante/import/plans`) : la séance du plan et celle programmée sur la montre ont le même id. |
| `GET course/sorties?before=&limit=` | `{ runs, more }` : les sorties, de la plus récente à la plus ancienne, avant le jour `before` (exclu), `limit` 20 par défaut (100 au plus) ; chacune avec `sampleId` et `uuid` (l'uuid HealthKit de la séance envoyée par l'app) ; `more` : il en reste |
| `GET sport` | `{ today, program, workouts, apple, guide, live, partner }` |
| `GET sport/figures?ex=a,b&programme=` | `{ drawing, figures }` : les figures animées (tous les exercices du programme si `ex` est vide) |
| `GET sport/figures/<id>` | une figure seule : `{ id, version, loop, cycle, fps, steps, cues, frames, props, gear, accessories, muscles }` |
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

## Sport

`program.exercises[]` : la fiche (`name`, `short`, `reps: [min, max]`, `uni`, `unit: "s"` pour une tenue, `tempo`, `cues`, `errors`, `ladder`, `guide`), plus `gear` (`[{ id, label }]`), `pattern`, `muscles` (`[{ id, label, load }]`, `load` 3 = cible, 2 = aide, 1 = stabilise, du plus au moins sollicité), `level` (cran en cours), `last` (la dernière fois), `ready` (prêt à monter d'un cran), `hasFigure`, `cycle` (durée d'une répétition au rythme guidé, en secondes : celle de la figure, ou de la figure de planche si l'exercice n'en a pas, comme le site ; la série dure `reps × cycle`).

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
- **`figureIds`** : les figures dont la séance a besoin (à télécharger avant de commencer) ; `GET sport` les donne aussi par séance du programme (`program.figureIds.A`…).
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
{ cycle, fps, steps: [{ to, dur, label, count }], frames: [{ j: [x0, y0, x1, y1, …], bell?: { hand, at: [x, y] }, step }],
  props: [{ kind, x, y, w, h, back? }], gear: [...], muscles: [{ id, label, load }] }
```

- `version` : change quand la figure ou son dessin change (l'app garde une figure tant que sa version ne bouge pas). `loop` : toujours `true` (une répétition qui boucle). `cues` : `[{ t, label }]`, le début de chaque étape du tempo dans la répétition, en secondes. `muscles[].role` : `primary` (cible, `load` 3), `secondary` (aide, 2), `stabilizer` (stabilise, 1).
- `accessories` : le matériel à plat : `{ type: "kettlebell", attachedTo: [main], position: "frames[].bell.at" }` (la boule bouge par image), `{ type: "dumbbell", attachedTo: [mains] }`, `{ type: "band", from, attachedTo: [mains] }`, `{ type: "miniband", attachedTo: ["kneeN", "kneeF"] }`, `{ type: "bench" | "chair" | "sofa" | "counter", rect: { x, y, w, h }, back? }`. Même contenu que `props`, `gear` et `frames[].bell`, sous une seule forme.
- `frames` : une répétition échantillonnée à `fps` images par seconde (`frames.length = ceil(cycle × fps)`) ; l'image à l'instant `t` est `frames[floor((t mod cycle) / cycle × length)]` (interpoler entre deux images est permis). `j` donne x, y pour chaque articulation dans l'ordre `drawing.figure.joints` : `hip, shoulder, neck, head, kneeN, ankleN, toeN, kneeF, ankleF, toeF, elbowN, handN, elbowF, handF`. Repère y vers le bas ; N = côté proche, F = côté éloigné. `step` : l'étape du tempo en cours (`steps[step].label` est le mot affiché).
- **Dessin** (comme `src/lib/training/draw.ts`) : membres en capsules galbées, rayon au départ → à l'arrivée : cuisse (hip → knee) 6,6 → 5 ; tibia (knee → ankle) 5 → 3,6 ; pied (ankle → toe) 3,3 → 2,4 ; bras (shoulder → elbow) 4,4 → 3,6 ; avant-bras (elbow → hand) 3,6 → 3 ; main : disque de 3,5. Buste (hip → shoulder) 7,8 → 9,2, cou (shoulder → neck) 3,8 → 3,6, tête : disque de 11 centré sur `head`. Ordre : sol, tapis, ombre, matériel posé, côté F (en retrait), buste, cou, tête, côté N, matériel tenu.
- **Kettlebell** (`bell`) : l'anse dans la main `hand`, la boule (rayon 7,6) à `at`.
- **`gear`** : `{ kind: "dumbbell", hands }` (haltères dans ces mains : barre de 16 en travers de l'avant-bras, un disque à chaque bout ; ils remplacent la kettlebell), `{ kind: "band", from, to }` (élastique tendu de l'articulation `from` aux mains `to`), `{ kind: "miniband" }` (mini-bande juste sous les deux genoux).
- **`props`** : un rectangle dont le haut est la surface d'appui ; `kind` : `bench` (banc), `chair` (chaise, dossier du côté `back`, gauche par défaut), `sofa` (canapé), `counter` (plan de travail).
- **Tapis** : pour les exercices au sol, sous le corps (à calculer sur les poses, ou à poser de x = 10 à 190).

### Les séries (`GET sante` → `series`)

Les courbes de la vue d'ensemble, à plat pour Swift Charts : `{ steps, activeKcal, exercise, restingHr, hrv, sleep, weight }`, chacune `{ unit, grain, mode, points: [{ date, value }] }` (seulement celles qui ont des mesures). `date` = premier jour du paquet ; `grain` = `day`, `week` ou `month` (les courbes du cœur restent au jour jusqu'à un an) ; `mode` : `mean` (moyenne par jour mesuré) ou `sum` (total du paquet). Unités : `pas/jour`, `kcal/jour`, `min`, `bpm`, `ms`, `min/nuit`, `kg`. `weight.extra.trend` : la tendance lissée, `[{ date, value, range? }]` (`range` : plus basse et plus haute pesée du paquet). Les objectifs restent dans `goals`.

`drawing.body` : la carte des muscles : `{ viewBox: "0 0 120 256", mirrorX: 60, limbs, shapes, front, back }`. On dessine la moitié gauche puis son miroir autour de x = 60 : la silhouette (`shapes` : tracés pleins ; `limbs` : segments arrondis `{ a, b, w }`), puis chaque muscle de `front` (vue de face) et `back` (vue de dos), des tracés SVG simples (commandes `M`, `L`, `C`, `Z`). Teinte : cible pleine (qui s'allume au tempo pendant le rythme), aide à 55 %, stabilise à 28 %, le reste en neutre.
