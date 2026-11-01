# Module Santé

Une page par partie, sous `/sante/…` (liste dans `src/components/sante/SanteNav.tsx`). Le calcul est pur dans `src/lib/health/core.ts` et `goals.ts` (tests `tests/sante.test.ts`), la base dans `store.ts`.

## Principe
- **Cible adaptative** (méthode MacroFactor) : dépense = apports moyens des journées complètes − variation de la tendance × 7 700 kcal/kg, sur 21 jours. Mise à jour chaque lundi. Il faut au moins 4 journées complètes par tranche de 7 jours et une pesée par semaine ; sinon « en attente » (dernière dépense mesurée) ; sans mesure du tout, « estimation » (Mifflin-St Jeor × activité). Un jour non complet est ignoré, jamais compté comme zéro.
- **Cible** = dépense + rythme visé (% du poids par semaine × 7 700 / 7), bouge d'au plus 150 kcal par semaine.
- **Tendance du poids** : moyenne exponentielle à 10 % par jour, jours sans pesée sautés.
- **Protéines** : grammes fixes ou g/kg de la tendance (1,6 par défaut).
- **Part d'un repas** (`src/lib/eaters/`) : (cible du jour ± tolérance − ce qui est mangé hors batch) / 2 ; la part de chaque recette en unités en découle, bornée entre 60 et 160 % de la part de base.
- **Hors batch** (`src/lib/eaters/habits.ts`, pur) : les habitudes de la personne (aliments de la table nutritionnelle × grammes, avec leurs jours). Hors batch d'un jour = somme des habitudes prises ce jour-là ; le repère d'un repas prend la moyenne de la semaine (parts identiques chaque jour), le bilan de la Semaine compte jour par jour. Sans habitude : le chiffre libre (`people.outside_kcal`), puis 20 % de la journée par défaut, sans alerte.
- **Conseil** (`adviceOf`, sans IA) : cible du jour − 2 repas moyens du batch (Semaine en cours, sinon part des recettes de la bibliothèque) − hors batch. À partir de 15 g de protéines ou 250 kcal par jour, il propose un shaker ou un petit-déjeuner ; sinon il dit qu'aucun complément n'est utile.
- **Profils** : les personnes du foyer, sélecteur dans la barre du haut (cookie par appareil, `src/lib/health/active.ts`).

## Les pages
- **Vue d'ensemble** (`src/app/sante/page.tsx`, sections dans `src/components/sante/overview/`) : de haut en bas, la phrase de la semaine (calculée, `synthesis`), la tendance du poids, la cible et les protéines, « Cette semaine » (pas, énergie active, séances, sommeil, FC au repos, variabilité, VO2max, masse grasse, chacun avec sa comparaison au mois d'avant et sa courbe sur 30 jours, seulement s'il existe), « Activité » (régularité sur un an, dernières séances avec durée, distance, énergie), « Évolution » sur la période choisie (`?periode=7j|30j|3m|1an|tout`, 30 jours par défaut : poids, pas, énergie, minutes d'activité, temps par type de séance, sommeil par phase, FC au repos, variabilité), puis objectifs et tour de taille. Les séries sont regroupées en SQL par jour, semaine ou mois (`src/lib/health/overview.ts`), le calcul est pur (`series.ts`, tests `tests/sante-series.test.ts`). Une section de plus (la course) s'ajoute comme composant.
- **Démarrer** (`/sante/demarrer`) : ce qui manque pour une part juste, le formulaire (hors batch : les habitudes, ou un chiffre), ce qui en découle et le conseil.
- **Aujourd'hui** : repas prévus de la Semaine cochés en un tap, habitudes du jour proposées d'office, journal par repas, « Journée complète ».
- **Hors batch** (`/sante/habitudes`) : les habitudes (modèles shaker protéiné, petit-déjeuner classique, rien), leurs aliments et leurs jours, le hors batch jour par jour et le conseil.
- **Objectifs** : poids visé, échéance, plan de sport, contraintes ; le coach (IA) propose, `checkProposal` (`goals.ts`) vérifie : rythme −1 à +0,5 %/sem., protéines 1,2–2,4 g/kg, poids visé dans un IMC 18,5–30, cible jamais sous le métabolisme de base.
- **Apple Santé** (`/sante/apple`) : l'app iPhone Mijote Santé, distribuée à part, envoie ce que la personne choisit dans Santé. La page affiche, pour le profil ouvert, le code d'installation en QR code et en texte, le dernier envoi, ce qui a été reçu par type et si l'historique complet est arrivé ; « Tout renvoyer » et « Changer la clé ». L'import du fichier d'export de Santé (lu dans le navigateur) reste en option repliée. Voir « Apple Santé » plus bas.
- **Sommeil et forme** (vue d'ensemble) : si l'app les envoie, sommeil moyen des 7 dernières nuits (phases de la dernière), FC au repos et variabilité cardiaque sur 7 jours comparées au mois d'avant, VO2max, masse grasse, et leurs graphiques sur la période. Affichés seulement ; ni la cible ni l'assistant ni le coach ne les lisent.
- **Entraînement** : voir [sport.md](sport.md).
- **Course** (`/sante/course`) : le module Course, activable par personne (réglages en sous-page : jours et heures, 2 à 4 sorties, objectif, FC saisies facultatives). En tête la séance du jour ou la prochaine (blocs et cibles de FC, état sur la montre, pourquoi elle), son conseil de nutrition, le ressenti à noter ; puis les signaux de prudence, la semaine avec la natation et le renforcement, la phase et ses critères, forme et fatigue sur trois mois, volume, régularité, allure à FC égale, les sorties (une page chacune : FC sur ses zones, temps par zone, temps au kilomètre, découplage, ressenti), les zones, pause et reprise. « Demander au coach » ouvre l'assistant. La vue d'ensemble a sa section Course quand le module est activé. Méthode : [course.md](course.md).

### La phrase de la semaine
Calculée en code, sans IA (`synthesis`, `src/lib/health/series.ts`) : pas par jour sur les 7 derniers jours complets face aux 28 jours d'avant (« autant » sous 5 % d'écart), séances des 7 derniers jours face au plan, sommeil moyen (« un peu court » sous 7 h), FC au repos si elle a bougé de 3 bpm ou plus, tendance du poids et son rythme. Une phrase par chiffre présent, rien sans mesure.

### Les séries
- Totaux du jour (pas, énergie, minutes) : moyenne par jour mesuré dans une semaine ou un mois (pas, énergie), total du paquet (minutes) ; un jour sans donnée n'est pas un zéro. La barre d'aujourd'hui (ou de la semaine en cours) est pâle : elle n'est pas finie.
- Mesures à un instant (cœur) : moyenne du jour (heure d'hiver de Paris), points du jour et moyenne glissante sur 7 jours ; au-delà de deux ans d'historique, à la semaine et sur 4 semaines.
- Poids : la tendance de l'appli calculée sur tout l'historique, la fourchette des pesées des 7 derniers jours ; au-delà d'un peu plus d'un an, un point par semaine.
- Séances : carnet guidé et Apple Santé réunis sans doublon (même règle que les objectifs) ; les quatre types les plus pratiqués gardent leur couleur, le reste va dans « Autre ».

## Apple Santé

L'app Mijote Santé lit HealthKit sur l'iPhone et l'envoie à `/api/sante/import` (`src/lib/health/import-api.ts`, route `src/app/api/sante/import/route.ts`). Ce chemin est ouvert sans le mot de passe de l'instance (`src/lib/auth.ts`) : chaque requête porte la clé secrète d'une personne, et c'est elle qui dit à qui vont les données. 404 en mode démo.

### Le code d'installation
Affiché par Santé › Apple Santé, un par personne, en QR code ou en texte :
```json
{ "mijote-sante": 1, "url": "https://<instance>/api/sante/import", "id": "", "secret": "", "key": "<clé de la personne>" }
```
`url` vient de `MIJOTE_PUBLIC_URL`, sinon de l'adresse de la page. `id` et `secret` sont le jeton de service Cloudflare Access, saisi une fois sur la même page (table `app_settings`) ; vides sans Cloudflare Access. « Changer la clé » refuse l'ancien code.

### En-têtes
`X-Mijote-Key: <key>` (l'ancien Raccourci envoyait `X-Cuisine-Key` : encore lu), `CF-Access-Client-Id` et `CF-Access-Client-Secret` si le code a un jeton, `Content-Type: application/json`.

### GET : l'état
```json
{ "ok": true, "person": "Alex", "mode": "week", "window": 7, "lastSyncAt": "2026-10-31T07:12:00.000Z", "v2": true, "features": ["workout_details", "plans"], "history": "all" }
```
`features` (v2.1) : Mijote accepte le détail des séances et sert les séances planifiées.
`history: "all"` tant que l'app n'a pas envoyé tout l'historique de la personne, et de nouveau après « Tout renvoyer ». `mode` et `window` ne servent qu'à l'ancien Raccourci.

### POST v2
```json
{
  "version": 2, "source": "app", "app": { "version": "1.0", "device": "iPhone", "tz": "Europe/Paris" },
  "batch": { "id": "…", "index": 0, "last": true, "history": "complete" },
  "samples": [{ "uuid": "…", "type": "body_mass", "start": "…", "end": "…", "value": 73.4, "unit": "kg", "sourceName": "…", "meta": {} }],
  "daily": [{ "type": "steps", "date": "2026-10-30", "value": 9120, "unit": "count" }],
  "workouts": [{ "uuid": "…", "activity": "swimming", "start": "…", "end": "…", "durationMin": 45, "kcal": 410, "distanceM": 1500, "hrAvg": 128, "hrMax": 162 }],
  "sleep": [{ "uuid": "…", "stage": "deep", "start": "…", "end": "…" }],
  "deleted": [{ "uuid": "…", "type": "body_mass" }]
}
```
- **Types et bornes** (`src/lib/health/ingest-v2.ts`) : `samples` : `body_mass` 25–300 kg (vers `weigh_ins`), `body_fat` 2–75 %, `lean_mass` 15–200 kg, `resting_hr` 25–200 bpm, `hrv_sdnn` 1–500 ms, `vo2max` 5–100 mL/kg/min, `menstrual` code entier 1–5. `daily` (jour civil du téléphone) : `steps`, `active_energy`, `basal_energy` (kcal), `exercise_min`, `walk_run_m`, `diet_energy`, `diet_protein` (g), `water` (mL), positifs et bornés. Sommeil : `stage` parmi `in_bed`, `asleep`, `core`, `deep`, `rem`, `awake`, 24 h au plus. Séances : `activity` en snake_case, traduit en français (`activityLabel`), comme les séances du Raccourci.
- **Un élément refusé ne bloque pas le paquet** : illisible, type inconnu, hors bornes, fin avant le début, date à plus d'un jour dans le futur → compté dans `skipped`. Une enveloppe illisible → 400.
- **Doublons** : par uuid pour `samples`, `workouts`, `sleep` ; par (type, date) pour `daily`, dont le total remplace le précédent. Une pesée ou une séance déjà reçue du Raccourci ou de l'export au même instant est reprise sous son uuid. `deleted` retire par uuid.
- **Paquets** : 2 000 éléments et 1 Mo au plus par requête (au-delà : 413). Sans `batch`, la requête est le dernier paquet. `lastSyncAt` n'est noté qu'au paquet `last: true` ; l'historique n'est noté reçu qu'au paquet `last: true, history: "complete"`.
- **Réponse** : `{ "ok": true, "accepted": { "samples": 12, "daily": 4, "workouts": 1, "sleep": 9, "deleted": 0 }, "skipped": 0 }` (éléments acceptés, déjà connus compris) ; sinon `{ "ok": false, "error": "…" }` en 400, 401 ou 413.

### v2.1 : le détail des séances
Champ facultatif `details` d'une séance (`src/lib/running/details.ts`), lu champ par champ : un champ illisible ou hors bornes est retiré, la séance et le reste du détail passent.
- `hr` : paires `[s, bpm]`, 2 000 points au plus (au-delà, la série est refusée), bpm 25–250, temps entre 0 et la durée + 1 min ; un même instant deux fois : le dernier gagne.
- `splits` : 300 au plus, `km` croissants (sinon tous retirés), `sec` 1 s–24 h, `hrAvg` 25–250, dénivelés 0–5 000 m.
- `cadenceAvg` 30–260, `strideM` 0,2–3, `elevGainM`/`elevLossM` 0–20 000, `power.avgW` 0–2 500, `indoor`, `pausesSec`, `events` (500 au plus), `source` (`name`, `model`), `plannedId`, `effort` 1–10 (arrondi à 0,1), `weather` (`tempC` −40–60, `humidityPct` 0–100).
- Rangé dans `workout_details`, à côté de la séance : la série en binaire (3 octets par point, 6 Ko pour 2 000 points contre ~24 Ko en JSON), hors de `health_samples` pour que les agrégations de Santé restent légères ; le pic de 30 s et « FC douteuse » sont calculés à l'arrivée.
- Complétion par uuid : une séance renvoyée avec détail le remplace ; renvoyée sans, elle garde le sien ; supprimée dans Santé, son détail part avec. `accepted.details` compte les détails rangés (les autres clés de la réponse ne bougent pas).

### v2.1 : les séances vers la montre
`/api/sante/import/plans` (`src/lib/running/watch-api.ts`, route `src/app/api/sante/import/plans/route.ts`) : même clé, même chemin ouvert dans `src/lib/auth.ts` (préfixe `/api/sante/import`), donc la même règle Cloudflare Access. 404 en démo.
- `GET` : `{ ok, plans: [{ id, version, date, time?, title, workout, notes }], removed: [id] }`, les séances prévues du jour J à J+7. `workout` est le `WorkoutSpec` de l'app (`toWorkoutSpec`, `src/lib/running/workout.ts`) : alertes de FC en plage de bpm (`range_min`, `range_max`), jamais en zone de la montre. `id` est un UUID stable (personne, semaine, rôle) ; `version` monte quand la séance change ; `removed` : les séances annulées à venir.
- `POST` : l'accusé `{ scheduled: [{ id, version, at }], failed: [{ id, version, error }], removed: [id], scheduler: { supported, authorized } }` → `{ ok: true }`. Programmée dans la version en cours : statut « programmée » ; un échec garde son message ; ids inconnus ignorés.
- Une course reçue avec `details.plannedId` coche la séance prévue ; sans, Mijote la rapproche par le jour.

### Ce qui en est fait
Les pesées font la courbe et la cible ; pas et séances comptent pour les objectifs d'activité ; sommeil, cœur, VO2max et masse grasse s'affichent dans la vue d'ensemble. L'énergie active et au repos ne change pas la cible (la balance mesure mieux la dépense). Les apports (`diet_*`, `water`) et le cycle (`menstrual`) sont gardés et comptés sur la page Apple Santé, mais ne sont lus ni par l'assistant ni par le coach.

### Format v1
Le format de l'ancien Raccourci iOS (`weights`, `steps`, `activeKcal`, `workouts`, `window`) est toujours accepté pour les Raccourcis déjà installés (`src/lib/health/ingest.ts`) ; le Raccourci n'est plus proposé.
