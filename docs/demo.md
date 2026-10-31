# Mode démo

Pour montrer Mijote sans compte ni installation : `MIJOTE_DEMO=1`. Chaque visiteur arrive sur un foyer déjà rempli et peut tout essayer ; ses changements ne regardent que lui et s'effacent après deux heures sans visite.

Sans cette variable, rien ne change : une instance normale n'a ni bandeau, ni cookie de démo, ni dossier `demo/`.

## Lancer une démo

Avec Docker (l'image se construit depuis le dépôt) :

```bash
docker build -t mijote .
docker run --rm -p 3010:3010 -e MIJOTE_DEMO=1 mijote
```

Ou le service `mijote-demo` de `docker-compose.yml`, à décommenter (port 3011 par défaut).

Sans Docker : `pnpm build`, puis `MIJOTE_DEMO=1 MIJOTE_DATA_DIR=/tmp/mijote-demo pnpm start`.

Il n'y a rien à garder : le dossier `demo/` est vidé et refait à chaque démarrage. Derrière Internet, mettre la démo derrière un proxy HTTPS comme une instance normale ([installation.md](installation.md#3-accès-depuis-lextérieur-et-https)).

## Ce que voit le visiteur

Le foyer fictif des tests, Alex et Sam, avec tout ce qu'il faut pour que chaque écran parle. Tout est daté par rapport à aujourd'hui (heure de Paris), et la base modèle est refaite chaque jour :
- profils Santé complets (objectifs, sports, contraintes), goûts, habitude du matin de chacun ;
- huit semaines de pesées, de tour de taille et de séances de sport (un programme kettlebell pour Alex, renfo pour Sam) ;
- la semaine en cours : trois plats répartis, la liste payée samedi, la session terminée dimanche, les boîtes rangées (celles des repas passés mangées, ce qui remplit le journal ; la marge et les jours lointains au congélo, celles d'aujourd'hui et de demain sorties la veille) ;
- la semaine d'avant, cuisinée et mangée ; la suivante, avec ses plats et sa liste de courses à faire.

Tout est écrit avec les fonctions de l'appli (`src/lib/demo/seed.ts`) : la Semaine répartit, le planificateur fait la session, la marmite se partage en boîtes. Les données elles-mêmes sont pures et testées (`src/lib/demo/household.ts`, `tests/demo.test.ts`).

Pas de mise en route. Un bandeau discret en tête de chaque page : « Démo : tes changements s'effacent… », **Recommencer** (la base repart du modèle du jour) et **Installer Mijote** (ce guide).

## Ce qui est coupé

| Quoi | En démo |
|---|---|
| IA (Atelier, import, coach, assistant, ajuster, dessins, programme sur mesure) | Coupée même si `ANTHROPIC_API_KEY` est réglée. L'Atelier, l'import et le coach expliquent ce qu'ils font chez soi ; les autres boutons répondent « Pas d'IA dans la démo ». |
| Catalogue de produits | Coupé même si `CHRONOCATALOG_URL` est réglée : courses par rayon, sans prix. |
| Apple Santé | L'écran explique le Raccourci ; `/api/sante/import` répond 404. |
| Mot de passe | `MIJOTE_PASSWORD` est ignoré : la démo est faite pour être ouverte. |

Les réglages (foyer, cuisine, magasin) restent modifiables : ils ne valent que pour la base du visiteur.

## Une base par visiteur

Le choix : une copie de la base modèle par visiteur, reconnue par un cookie, plutôt qu'une base partagée remise à zéro à heure fixe. Une base partagée est plus simple, mais un visiteur y voit les essais des autres, et « Recommencer » effacerait le travail de tout le monde. Une copie SQLite d'environ 1 Mo coûte une milliseconde et reste entièrement isolée.

1. Au démarrage (`src/instrumentation.ts`), la base modèle se construit dans `<MIJOTE_DATA_DIR>/demo/modele.db`, puis une fois par jour à côté, et remplace l'ancienne d'un renommage.
2. `src/proxy.ts` lit le cookie `mijote.demo` (32 caractères hexadécimaux, sinon un nouvel identifiant est tiré) et le passe aux pages dans l'en-tête `x-mijote-demo`, toujours réécrit par le serveur.
3. `db` (`src/lib/db/client.ts`) retrouve, à chaque usage, la base du visiteur de la requête en cours (`src/lib/demo/request.ts`) ; à sa première visite, la base modèle est copiée en `demo/v-<id>.db`. Les pages, actions et routes n'ont rien à changer.
4. Sans visiteur reconnu (hors requête), ou si trop de bases viennent d'être créées : la base modèle en lecture seule. On voit tout, rien ne s'écrit.

## Garde-fous

| Limite | Défaut | Variable |
|---|---|---|
| Bases gardées à la fois (au-delà, la moins récemment utilisée est effacée) | 100 | `MIJOTE_DEMO_MAX_BASES` (1 à 1 000) |
| Effacement après inactivité | 120 min | `MIJOTE_DEMO_IDLE_MIN` (5 à 1 440) |
| Taille d'une base au-delà du modèle (SQLite refuse d'écrire plus) | 32 Mo | `MIJOTE_DEMO_MAX_MB` (4 à 512) |
| Nouvelles bases par minute (un robot sans cookie en créerait une par requête) | 30 | `MIJOTE_DEMO_NEW_PER_MIN` (1 à 600) |

Au pire, le dossier `demo/` tient donc dans `MAX_BASES × (1 Mo + MAX_MB)`. Le nom d'une base est tiré de l'identifiant validé, et son chemin vérifié dans le dossier : rien ne s'écrit ailleurs que dans `<MIJOTE_DATA_DIR>/demo/`. La purge passe toutes les 5 minutes et à chaque nouvelle base. Le test de fumée (`pnpm test:smoke`) démarre une démo et vérifie que deux visiteurs ne se voient pas.
