# Course : fondations

Ce document fixe ce que le module Course calcule et comment : zones cardiaques, charge et forme, analyse d'une sortie, plan de reprise, nutrition, ce que l'IA peut proposer, graphiques. Les choix sont ceux des outils de référence (TrainingPeaks, intervals.icu, Runalyze, Garmin/Firstbeat, Polar, Apple Forme) quand ils sont publiés et solides, et la littérature quand elle tranche. Chaque constante a sa source (§ 9) ; ce qui est un choix de Mijote est dit comme tel.

Principes, ceux du reste de l'appli :
- **Tout se calcule en code pur et testé** (règle 2) : zones, charge, analyses, plan, séances. Même entrée, même sortie ; pas de hasard, pas de date courante cachée.
- **Activable par personne**, comme l'Entraînement. Sans données de fréquence cardiaque, tout marche avec l'effort perçu et la durée.
- **L'IA ne fait que proposer** des ajustements typés, que le code vérifie contre les invariants du § 6 avant de les montrer ; la personne confirme d'un geste.
- **Pas de prétention médicale.** Douleur qui dure, malaise, essoufflement anormal : le module s'arrête et renvoie vers un professionnel de santé.
- **Prudent par défaut.** Le public visé est le débutant ou le coureur qui reprend. Les règles sont écrites pour lui ; un coureur confirmé peut desserrer les réglages, jamais l'inverse sans le savoir.

Rangement : `src/lib/running/` — purs : `constants.ts` (toutes les constantes, avec leur paragraphe), `zones.ts`, `series.ts` (FC à 1 Hz, nettoyage, pic de 30 s, vitesse et pente tirées des temps au kilomètre), `load.ts`, `analysis.ts`, `signals.ts`, `trends.ts`, `workout.ts` (séances en blocs, `WorkoutSpec` de la montre), `plan.ts`, `actions.ts` (§ 6), `details.ts` (détail envoyé par l'app) ; `store.ts` pour la base, `watch-api.ts` pour la montre. Tests `tests/running-formulas.test.ts`, `running-plan.test.ts`, `running-store.test.ts`. `RUNNING_VERSION` (dans `constants.ts`) à incrémenter quand un calcul change (comme `NUTRITION_VERSION`) : les analyses gardées sont refaites.

### Ce qui est en place, et les écarts

En place : réglages par personne et page minimale `/sante/course` ; détail des séances reçu de l'app (contrat v2.1, docs/sante.md) ; zones, charge, forme, analyse d'une sortie, signaux du matin, tendances ; plan rangé dans `run_sessions` et servi à la montre (`/api/sante/import/plans`) ; six actions proposables par l'assistant ; démo. À venir : les graphiques du § 7 (kit `src/components/ui/charts/`), la nutrition du § 5, la VO2max en tendance, la question du ressenti « en un geste » après chaque course.

Écarts et précisions, choix de Mijote :
- **Volumes en minutes de course** : une course réalisée compte sa durée en mouvement moins 10 min (échauffement et retour au calme), comme les séances prévues (le pas principal).
- **Sortie longue** : `L_{s−1}` est la plus longue *réellement* courue la semaine d'avant (sinon la prévue), comme le volume se calcule sur le réalisé ; une première semaine commencée en cours de route ne compte pas dans `V_réf`.
- **Marche-course** : la règle des 30 jours ne s'y applique pas ; les niveaux du § 4.3 (déjà plus rapides que × 1,10 sur le temps de course) et le ressenti la remplacent.
- **Sans trace GPS** (choix de vie privée de l'app) : vitesse et pente par kilomètre, d'après les temps au kilomètre et leurs dénivelés ; le verrouillage sur la cadence se repère avec la cadence moyenne et un saut de FC de plus de 20 bpm au-dessus de la médiane de la sortie.
- **Objectifs** : *reprendre* (phase 1, sortie longue 60 min), *courir plus longtemps* (phase 2, 90 min), *une vraie sortie longue* (phase 2, 120 min), *semi* (phase 3) ; le 10 km et la date d'une course ne sont pas encore proposés. Un objectif en mots est gardé tel quel.
- **Activités fixes** : réglées, sinon tirées de l'historique (un jour de la semaine avec natation ou renforcement au moins 2 fois sur les 4 dernières semaines, carnet guidé compris).
- **Recalcul** : le plan se recalcule à chaque lecture (page, assistant, montre), de façon déterministe ; ce qui est passé reste écrit en base, une séance qui change prend une nouvelle version.
- **Tests de terrain** : test aérobie la 2e semaine de phase 2 puis toutes les 5 ; test de Friel la 2e semaine de phase 3 puis tous les 3 mois, si la FCseuil n'est pas saisie.
- **Sans date de naissance** : FC max de Tanaka sur 35 ans, dit sur la page.
- **Actions de l'IA** (§ 6) : `course_decaler`, `course_raccourcir`, `course_remplacer` (seulement plus facile), `course_sorties` (2 à 4, à la place de `run.week.adjust`), `course_decharge`, `course_fc`. La création du plan, la pause et la reprise, le ressenti restent des gestes de la personne sur la page.
- **Douleur** : une note par jour ; « plus forte le lendemain matin » se lit en notant de nouveau le lendemain.

## 0. Les données

| Donnée | D'où | Déjà reçue ? |
|---|---|---|
| Âge, sexe, taille | `people.birth_date`, `people.sex`, `people.height_cm` | oui |
| Poids (tendance) | Santé (`weigh_ins`) | oui |
| FC au repos, variabilité (SDNN), VO2max estimée | app iPhone, `resting_hr`, `hrv_sdnn`, `vo2max` | oui |
| Sommeil | app iPhone, phases | oui |
| Séances (type, début, durée, distance, kcal, FC moyenne et max) | app iPhone, `workouts` | oui |
| **Par course** : série de FC, temps au km, cadence, altitude, allure | app iPhone | à venir |
| **Par séance** : effort 1–10 (`workoutEffortScore` saisi, sinon `estimatedWorkoutEffortScore` d'Apple) | HealthKit iOS 18+, lu avec `predicateForWorkoutEffortSamplesRelated` | à demander à l'app |
| **Par séance** : température et humidité (`HKMetadataKeyWeatherTemperature`, `…Humidity`), intérieur (`HKMetadataKeyIndoorWorkout`) | métadonnées de la séance | à demander à l'app |
| Ressenti après la séance (effort, douleur 0–10 et où) | une question dans Mijote, en un geste | à faire |
| Repas prévus (kcal, protéines par repas) | Semaine, Santé | oui |

Ce que l'app devrait envoyer pour chaque course, pour que les analyses du § 3 soient possibles : la série de FC (`HKQuantityTypeIdentifier.heartRate`, échantillons horodatés, environ toutes les 5 s pendant une séance), la trace (`HKWorkoutRoute` : positions horodatées avec altitude) ou, à défaut, la distance cumulée (`distanceWalkingRunning`) et la vitesse (`runningSpeed`), les pas (`stepCount`, pour la cadence), le dénivelé (`HKMetadataKeyElevationAscended`), et les segments ou tours si la montre en a. La série est rangée par séance ; un échantillonnage irrégulier est attendu.

## 1. Zones cardiaques

### 1.1 Les trois repères

**FC max (FCmax).** Ordre de priorité :
1. La valeur saisie par la personne (test encadré, course à fond) : elle prime toujours.
2. La FCmax **observée**, si elle dépasse l'estimation par l'âge.
3. L'estimation de **Tanaka** : `FCmax = 208 − 0,7 × âge` (méta-analyse de 351 études, 18 712 personnes, sans différence de sexe ni de niveau d'activité). On n'utilise pas `220 − âge`, moins juste. L'écart-type individuel autour de l'estimation est d'environ 10 bpm : c'est une estimation, affichée comme telle.

La FCmax observée, robuste aux artefacts :
1. Nettoyer chaque série de course (§ 3.1) : valeurs hors de 35–230 bpm retirées ; pics retirés (saut de plus de 25 bpm en 5 s ou moins par rapport à la médiane des 30 s précédentes) ; **verrouillage sur la cadence** retiré (capteur optique : sur au moins 30 s, |FC − cadence en pas/min| ≤ 3 alors que l'allure est facile).
2. Pic de la sortie = maximum de la **moyenne glissante sur 30 s** de la série nettoyée (fenêtre valide si au moins 25 s de mesures).
3. FCmax observée = le plus haut pic des 365 derniers jours **confirmé** : une autre sortie de la période a un pic à 5 bpm ou moins. Un pic isolé est montré (« à confirmer ») mais pas utilisé.
4. Bornes : entre `Tanaka − 25` et `min(230, Tanaka + 30)` ; au-delà, c'est un artefact.

Mise à jour : le 1er du mois (comme Apple), automatiquement **vers le haut seulement** ; à la baisse, seulement par une saisie. Un débutant n'atteint presque jamais sa FCmax en footing : une FCmax observée basse dit surtout qu'il n'a pas couru vite. Changement retenu seulement s'il fait au moins 2 bpm (pas de zones qui sautillent).

**FC au repos (FCrepos).** Médiane des mesures `resting_hr` des 30 derniers jours, s'il y en a au moins 7. Sinon la dernière médiane connue de moins de 90 jours ; sinon 60 bpm, marqué « estimée ». Même mise à jour mensuelle, même seuil de 2 bpm.

**FC au seuil lactique (FCseuil, LTHR).** Ordre de priorité :
1. Saisie.
2. **Test de Friel** (proposé seulement en phase 3, § 4.6) : 30 min seul, à fond régulier ; FCseuil = FC moyenne des 20 dernières minutes.
3. Défaut : `FCrepos + 0,80 × (FCmax − FCrepos)`, marqué « estimée ». Choix de Mijote : chez le coureur entraîné le seuil est vers 85–92 % de la FCmax, plus bas chez le débutant ; 0,80 de la réserve tombe vers 85–87 % de la FCmax, en bas de la zone 4, là où le placent les guides. Les estimations des montres sont imprécises (étude de validation sur 100 coureurs, 2025) : on ne les reprend pas.

### 1.2 Les cinq zones

**Méthode par défaut : la réserve cardiaque (Karvonen).** `FC cible = FCrepos + p × (FCmax − FCrepos)`. C'est la méthode qu'Apple applique à ses zones (FCmax et FCrepos personnelles, mises à jour chaque mois) et le pourcentage de réserve suit le pourcentage de la réserve de VO2 (Swain et Leutholtz 1997), ce qui en fait la meilleure méthode sans test.

| Zone | Nom affiché | % de la réserve | Exemple (FCmax 186, FCrepos 58) |
|---|---|---|---|
| — | sous les zones (marche, arrêt) | < 50 % | < 122 |
| Z1 | Récupération | 50 – 60 % | 122 – 134 |
| Z2 | Endurance | 60 – 70 % | 135 – 147 |
| Z3 | Tempo | 70 – 80 % | 148 – 159 |
| Z4 | Seuil | 80 – 90 % | 160 – 172 |
| Z5 | VO2max | ≥ 90 % | ≥ 173 |

Bornes : borne basse incluse, haute exclue, arrondies au bpm le plus proche ; la borne haute affichée d'une zone est la borne basse de la suivante moins 1.

**Si la FCseuil est mesurée (saisie ou test), les zones de Friel la remplacent**, plus justes autour du seuil (course à pied ; ses zones 5a, 5b, 5c réunies en une) :

| Zone | % de la FCseuil |
|---|---|
| Z1 | < 85 % (et ≥ 50 % de la réserve, sinon « sous les zones ») |
| Z2 | 85 – 89 % |
| Z3 | 90 – 94 % |
| Z4 | 95 – 99 % |
| Z5 | ≥ 100 % |

La méthode en cours est affichée avec les zones (« d'après l'âge », « d'après vos courses », « d'après votre test ») et l'historique se recalcule quand elle change.

**Trois zones pour la répartition** (modèle de Seiler) : *facile* = sous les zones, Z1, Z2 ; *modéré* = Z3 ; *difficile* = Z4, Z5. Cible : au moins **80 %** du temps de course en facile sur 4 semaines (les coureurs d'endurance qui progressent font environ 80 % de leur volume sous le premier seuil), et jamais plus de 20 % en modéré + difficile. Pour un débutant la cible est plus simple encore : presque tout en facile jusqu'à la phase 2.

Pas d'autres méthodes : la formule de Maffetone (`180 − âge`) n'est qu'un plafond empirique, proche de notre haut de Z2 chez l'adulte jeune ; on ne la retient pas.

**Repères sans cardio.** Chaque zone a aussi un effort perçu (échelle 0–10) et un test de la parole, affichés à côté des bpm : Z1–Z2 = 2 à 4, on parle en phrases complètes ; Z3 = 5 à 6, phrases courtes ; Z4 = 7 à 8, quelques mots ; Z5 = 9 à 10, pas un mot.

**Alertes de montre.** `HeartRateZoneAlert(zone:)` de WorkoutKit utilise les zones *réglées sur la montre*, qui peuvent différer des nôtres. Les séances envoyées utilisent donc `HeartRateRangeAlert` avec les bpm de Mijote (§ 4.10).

## 2. Charge et forme

### 2.1 L'unité : le point de charge

Une seule unité pour toutes les séances, comparable au hrTSS de TrainingPeaks : **100 points = 1 h à la FCseuil**.

Le calcul de base est le **TRIMP de Banister**, intégré seconde par seconde sur la série nettoyée :

```
x(t)   = borné entre 0 et 1 de (FC(t) − FCrepos) / (FCmax − FCrepos)
TRIMP  = Σ  Δt_min × x × a × e^(b × x)
         homme : a = 0,64, b = 1,92 ; femme : a = 0,86, b = 1,67 ;
         sexe non renseigné : a = 0,75, b = 1,795 (moyenne, choix de Mijote)
TRIMP_seuil_1h = 60 × xs × a × e^(b × xs),  avec xs = (FCseuil − FCrepos) / (FCmax − FCrepos)
charge = 100 × TRIMP / TRIMP_seuil_1h
```

C'est la formule de HRSS (Elevate pour Strava), la plus proche du hrTSS de TrainingPeaks dont la table n'est pas publiée. Le facteur exponentiel donne plus de poids aux minutes intenses, ce que la durée seule ne fait pas.

Exemple (homme, FCmax 186, FCrepos 58, FCseuil estimée 160) : 40 min à 140 bpm → x = 0,64, TRIMP = 56,1, TRIMP_seuil_1h = 142,7, **charge = 39**.

### 2.2 Sans série de FC : la même formule, x estimé

Pour que tout reste comparable, on garde la formule et on estime seulement x, dans cet ordre (le premier possible gagne ; la source est gardée avec la séance) :

1. **Série de FC valide sur au moins 80 % de la durée** : calcul exact ci-dessus.
2. **FC moyenne seule** (séances déjà reçues, `hrAvg`) : x de la FC moyenne, appliqué à toute la durée. Sous-estime un peu les séances fractionnées.
3. **Effort perçu 1–10** (saisi, ou estimé par Apple) : x d'après la table ci-dessous.
4. **Allure** (course, sans FC) : si la personne a au moins 5 courses avec FC dans les 90 jours, droite personnelle FC = f(vitesse ajustée à la pente) par moindres carrés, puis x de la FC prédite. Sinon, étape 5.
5. **Défaut par type** : marche 0,35 ; marche-course 0,55 ; footing et sortie longue 0,62 ; fartlek 0,70 ; côtes 0,72 ; tempo 0,78 ; natation 0,60 ; kettlebell et renforcement 0,55 ; vélo 0,60 ; autre 0,50.

Table effort perçu → x (choix de Mijote, calée sur les correspondances effort / réserve de l'ACSM et sur la méthode de Foster) et charge résultante pour une heure (homme, xs = 0,80) :

| Effort | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| x | 0,40 | 0,50 | 0,60 | 0,67 | 0,73 | 0,78 | 0,83 | 0,88 | 0,93 | 0,97 |
| charge pour 1 h | 23 | 35 | 51 | 65 | 80 | 94 | 110 | 128 | 149 | 168 |

La méthode de Foster (effort de séance × minutes) est valide et fidèle pour suivre la charge en sport d'endurance ; on la traduit ici dans la même unité que le TRIMP au lieu de garder une unité à part. Apple fait la même chose (« charge d'entraînement » = effort × durée, 7 jours comparés aux 28 précédents).

Natation : la FC optique sous l'eau est peu fiable, on préfère l'effort perçu à la FC pour la nage (étape 3 avant 1). Kettlebell : la FC dit mal l'effort musculaire, même règle.

### 2.3 Deux charges, deux usages

- **Charge totale** (toutes les séances) : la fatigue générale. Sert à la forme (§ 2.4) et aux alertes de fatigue.
- **Charge de course** (course et marche-course seulement), et surtout le **volume de course** en minutes et en kilomètres : la contrainte mécanique (tendons, os) qui fait les blessures du coureur. La natation n'en ajoute pas. Sert aux règles de progression et à la règle de la sortie la plus longue (§ 2.6).

### 2.4 Forme, fatigue et équilibre (CTL, ATL, TSB)

Le modèle impulsion-réponse de Banister, sous la forme qu'utilisent TrainingPeaks, intervals.icu et Runalyze : deux moyennes exponentielles de la charge quotidienne `C_j` (somme des séances du jour, 0 les jours sans) :

```
CTL_j = CTL_{j−1} + (C_j − CTL_{j−1}) × (1 − e^(−1/42))     « condition », 42 jours
ATL_j = ATL_{j−1} + (C_j − ATL_{j−1}) × (1 − e^(−1/7))      « fatigue », 7 jours
TSB_j = CTL_{j−1} − ATL_{j−1}                                « fraîcheur » du matin, avant les séances du jour
TSB%_j = 100 × TSB_j / CTL_{j−1}                             si CTL_{j−1} ≥ 5, sinon non affiché
```

Constantes 42 et 7 : les valeurs par défaut de tous les outils cités (demi-vies d'environ 29 et 5 jours). Départ à 0 au premier jour d'historique, recalcul complet à chaque changement (un an de séances se calcule en quelques millisecondes). On affiche le pourcentage, comme intervals.icu par défaut, pour que les seuils aient un sens chez un débutant dont la condition vaut 10 comme chez un confirmé qui vaut 60.

| TSB% | Lecture | Effet sur le plan |
|---|---|---|
| ≥ +20 | En transition : repos prolongé, on perd de la condition | aucun ; message si cela dure plus de 14 jours |
| +5 à +20 | Frais | aucun |
| −10 à +5 | Neutre | aucun |
| −30 à −10 | Productif : la charge construit | aucun |
| < −30 | Risque : fatigue trop haute | la prochaine séance devient un footing court (§ 4.8) |

Bornes reprises d'intervals.icu (même valeurs en absolu et en %, risque sous −30).

### 2.5 Rapport aigu/chronique (ACWR) : affiché, jamais décisif

Calculé dans sa forme « découplée » : charge de course des 7 derniers jours ÷ moyenne hebdomadaire des jours 8 à 35. Montré à titre indicatif, avec la bande grise 0,8–1,3 que reprennent Garmin (« optimal » de 0,8 à 1,4) et Gabbett.

Il **ne déclenche rien**. Raisons : le rapport couple mathématiquement ses deux termes (Lolli 2019), ses « zones idéales » sont des découpages arbitraires et son usage pour piloter la charge suppose une causalité non démontrée (Impellizzeri 2020, 2021) ; surtout, sur 5 205 coureurs suivis 18 mois (Frandsen 2025), les pics d'ACWR n'étaient **pas** associés à plus de blessures (plutôt moins), pas plus que la variation d'une semaine à l'autre.

### 2.6 La règle qui compte : la sortie la plus longue des 30 derniers jours

Même étude (Frandsen 2025, 588 071 sorties) : ce qui prédit la blessure de surmenage, c'est **une sortie plus longue de plus de 10 % que la plus longue des 30 derniers jours**.

`R = distance de la sortie ÷ plus longue distance courue sur les 30 jours précédents`

| R | Catégorie | Taux de blessure de surmenage (vs R ≤ 1,10) |
|---|---|---|
| ≤ 1,10 | dans la règle | référence |
| 1,10 – 1,30 | petit pic | × 1,64 (IC 95 % 1,31–2,05) |
| 1,30 – 2,00 | pic moyen | × 1,52 (1,16–2,00) |
| > 2,00 | grand pic | × 2,28 (1,50–3,48) |
| pas de course sur 30 jours | reprise | règles de reprise du § 4.2 |

Conséquences :
- Le générateur **ne planifie jamais** une sortie au-delà de 1,10 × la plus longue des 30 jours. Les auteurs notent que même +1 à +10 % porte un léger risque (× 1,19, non significatif) et que trois sorties de suite à +10 % dans la même semaine restent trop : **une seule sortie « record » par période de 7 jours**, la sortie longue.
- Pendant la marche-course, la règle s'applique sur la **durée de course** (hors marche), plus parlante que la distance à ce stade.
- Après la sortie, si R > 1,10 : un point orange (R ≤ 1,30) ou rouge, et le message « la prochaine sortie longue attend 7 jours ».

### 2.7 Autres repères de charge

- **Volume hebdomadaire de course.** Le « 10 % par semaine » n'a pas de preuve : un programme gradué à 10 % n'a pas eu moins de blessures qu'un programme à 24 % (Buist 2008, 532 débutants). En revanche, au-delà de +30 % sur deux semaines, les débutants ont eu plus de blessures liées à la distance (Nielsen 2014, 874 débutants). Règles retenues au § 4.4 : +10 % visé, +20 % au plus par rapport aux deux semaines précédentes ; alerte orange au-delà de +30 % sur ce qui est réellement couru.
- **Monotonie** (Foster 1998, facultatif) : moyenne ÷ écart-type de la charge quotidienne sur 7 jours ; au-dessus de 2, message « varier les jours faciles et les jours de repos ».
- **Repères du matin** (§ 4.8) : FC au repos, variabilité, sommeil.

Tableau des alertes de charge :

| Condition | Couleur | Action |
|---|---|---|
| Sortie avec R entre 1,10 et 1,30 | orange | prochaine sortie longue au plus tôt dans 7 jours |
| Sortie avec R > 1,30 | rouge | idem, et semaine suivante sans qualité |
| Volume de course de la semaine > 1,30 × moyenne des 2 précédentes | orange | semaine suivante plafonnée au volume de la précédente |
| TSB% < −30 | rouge | prochaine séance : footing court ou repos |
| TSB% ≥ +20 depuis plus de 14 jours | info | message « reprendre doucement » ; règles de reprise si plus de 28 jours sans courir |

## 3. Analyse d'une sortie

### 3.1 Préparation des séries

1. Remettre la série de FC à 1 Hz par interpolation linéaire entre deux mesures séparées de 10 s au plus ; au-delà, trou (pas de valeur).
2. Nettoyer (§ 1.1) ; si plus de 20 % de la durée est retirée, la sortie est marquée « FC douteuse » : affichée, mais exclue des tendances et du calcul de FCmax.
3. Distance et altitude : à partir de la trace, altitude lissée (médiane glissante sur 30 s) ; dénivelés positif et négatif cumulés avec un seuil de 2 m pour ignorer le bruit du GPS. Sans trace : distance cumulée seulement, pas d'ajustement à la pente.
4. **Course, marche, arrêt**, seconde par seconde : *course* si cadence ≥ 140 pas/min (ou, sans cadence, vitesse ≥ 2,0 m/s) ; *arrêt* si vitesse < 0,5 m/s ; *marche* sinon. Les secondes d'arrêt ne comptent dans aucune durée.
5. La première minute et les secondes de verrouillage sur la cadence sont exclues des analyses de FC.

### 3.2 Ce qu'on calcule pour chaque sortie

| Mesure | Calcul |
|---|---|
| Durée, distance, allure moyenne | temps en mouvement (course + marche) ; allure = temps ÷ distance |
| Temps de course et de marche | d'après le classement du § 3.1 |
| **Temps par zone** | secondes de course dans chaque zone (et « sous les zones ») ; la marche à part |
| Répartition en trois zones | facile, modéré, difficile (§ 1.2) |
| **Temps au kilomètre** | par km : temps, allure, allure ajustée à la pente, FC moyenne, dénivelés, cadence moyenne |
| Charge | § 2.1 |
| Sortie la plus longue | R (§ 2.6) |
| Allure ajustée à la pente | § 3.3 |
| Facteur d'efficacité, découplage, dérive | § 3.4 et 3.5, si les conditions sont remplies |
| VO2max effective | § 3.6, si les conditions sont remplies |
| Conformité au plan | pour une séance planifiée : chaque bloc réalisé ou non, temps dans la plage visée (§ 4.10) |
| Conditions | température, humidité si la montre les donne ; « chaleur » si ≥ 25 °C |

### 3.3 Allure ajustée à la pente

Coût énergétique de la course en pente, Minetti 2002 (mesuré de −45 % à +45 %), en J/kg/m, avec `g` la pente en fraction (0,05 = 5 %) :

```
Cr(g) = 155,4 g⁵ − 30,4 g⁴ − 43,3 g³ + 46,3 g² + 19,5 g + 3,6
vitesse ajustée = vitesse × Cr(g) / 3,6
```

| Pente | −15 % | −10 % | −5 % | −2 % | 0 | +2 % | +5 % | +10 % | +15 % |
|---|---|---|---|---|---|---|---|---|---|
| Facteur `Cr(g)/3,6` | 0,51 | 0,60 | 0,76 | 0,90 | 1 | 1,11 | 1,30 | 1,66 | 2,06 |

Application : par tronçon d'au moins 100 m (pente = dénivelé du tronçon ÷ sa longueur, altitude lissée), `g` borné à ±0,20. Choix de Mijote : **facteur minimum 0,80 en descente**. La courbe de laboratoire rend les descentes raides bien plus « faciles » qu'elles ne le sont sur le terrain (elle ignore le freinage et la technique ; Strava a d'ailleurs remplacé Minetti par un modèle tiré de la FC de ses coureurs). Sans altitude fiable (moins de 10 m de dénivelé par km en tout, ou pas de trace), allure ajustée = allure.

### 3.4 Facteur d'efficacité (EF) et découplage aérobie

Définitions de TrainingPeaks (Friel) pour la course :

```
EF = vitesse ajustée moyenne (m/min) ÷ FC moyenne
découplage (Pa:HR) = (EF_1re moitié − EF_2e moitié) ÷ EF_1re moitié × 100
```

Ce qui est analysé (la « section stable ») : la sortie sans ses 10 premières minutes (échauffement, la FC monte encore) et sans la marche de retour au calme ; coupée en deux moitiés de même **durée**.

Conditions, sinon « non calculable » et pourquoi :
- section stable d'au moins 30 min, dont au moins 95 % en course (pas de marche-course) ;
- au moins 90 % de la section en facile (Z1–Z2) : le découplage n'a de sens qu'en endurance ;
- vitesse ajustée régulière : coefficient de variation par minute < 15 % ;
- FC valide sur au moins 90 % de la section.

Seuils (Friel : « 5 % ou moins de façon répétée sur les sorties d'endurance, l'endurance aérobie est solide ») :

| Découplage | Lecture |
|---|---|
| < −2 % | probablement un artefact (échauffement compté, capteur) : affiché grisé |
| −2 à 5 % | bonne endurance à cette durée |
| 5 à 8 % | correct ; la durée est à la limite actuelle |
| > 8 % | dérive marquée : durée au-delà de l'endurance actuelle, chaleur, déshydratation ou fatigue |

Chaleur : la dérive cardiaque (hausse de la FC et baisse du volume d'éjection à effort constant après 10–20 min) augmente avec la température et la déshydratation (Coyle et González-Alonso 2001). Une sortie à ≥ 25 °C garde son découplage affiché avec la mention « chaleur », mais elle est exclue des tendances et des critères de passage de phase.

### 3.5 Dérive cardiaque

Complément lisible du découplage : `dérive = FC moyenne 2e moitié − FC moyenne 1re moitié` (bpm), sur la même section stable, avec la variation d'allure ajustée entre les deux moitiés. « +9 bpm à allure égale » se comprend mieux que « 6 % ».

### 3.6 VO2max effective (facultatif)

À la manière de Runalyze, une estimation par sortie, tirée de l'équation de coût de Daniels et Gilbert et de l'équivalence réserve cardiaque ≈ réserve de VO2 (Swain et Leutholtz 1997) :

```
v (m/min) = vitesse ajustée moyenne de la section stable
VO2(v) = −4,60 + 0,182258 v + 0,000104 v²            (mL/kg/min)
x̄ = (FC moyenne − FCrepos) / (FCmax − FCrepos)
VO2max effective = 3,5 + (VO2(v) − 3,5) / x̄
```

Conditions : section stable d'au moins 20 min, x̄ ≥ 0,50, pas de chaleur. Affichée en tendance (médiane des 5 dernières sorties valides), à côté de la VO2max d'Apple, jamais seule : elle dépend de la FCmax et de la FCrepos retenues. Exemple : 7:30/km (v = 133 m/min) à x̄ = 0,64 → VO2(v) = 21,5 → VO2max effective ≈ 31,7.

### 3.7 VDOT : seulement pour une course ou un test

Les équations de Daniels et Gilbert (`VO2(v)` ci-dessus et la part de VO2max tenable pendant `t` minutes : `0,8 + 0,1894393 e^(−0,012778 t) + 0,2989558 e^(−0,1932605 t)`, VDOT = VO2(v) ÷ cette part) ne valent que pour un effort à fond. Elles servent si la personne note une course ou un test (5 km ou plus) : VDOT, allures d'entraînement de Daniels et prédictions. Pas d'estimation de VDOT à partir de footings.

Après une interruption, Daniels réduit le VDOT (table officielle de VDOT O2, extrait) :

| Arrêt | ≤ 5 j | 7 j | 14 j | 28 j | 42 j | 56 j | ≥ 72 j |
|---|---|---|---|---|---|---|---|
| Sans autre sport | 1,000 | 0,994 | 0,973 | 0,931 | 0,889 | 0,847 | 0,800 |
| Avec un autre sport d'endurance | 1,000 | 0,997 | 0,986 | 0,965 | 0,944 | 0,923 | 0,900 |

(La valeur 0,994 publiée pour 42 j avec autre sport est une coquille évidente ; on retient 0,944.) Utile pour les allures ; le volume, lui, suit les règles de reprise du § 4.2.

### 3.8 Tendances

| Tendance | Calcul | Question |
|---|---|---|
| Volume par semaine | minutes et km de course (lundi–dimanche), empilés par zone | je progresse sans à-coups ? |
| Régularité | semaines avec au moins 2 sorties sur les 8 dernières ; séances prévues faites / prévues | je tiens le rythme ? |
| Sortie la plus longue | durée et distance de la plus longue de chaque semaine | j'allonge ? |
| **Allure en Z2** | par sortie : médiane de la vitesse ajustée pendant les secondes de course où la FC est à ±3 bpm du milieu de Z2, après 10 min ; il en faut au moins 5 min ; tendance = médiane glissante sur 6 semaines (sorties sans chaleur ni « FC douteuse ») | mon cardio s'améliore ? |
| EF des footings | EF des sorties faciles valides, médiane glissante sur 6 semaines | idem, sur toute la sortie |
| Découplage des sorties longues | une valeur par sortie longue valide | j'encaisse mieux la durée ? |
| Répartition d'intensité | trois zones sur 4 semaines glissantes, contre la cible 80 / 20 | je cours assez lentement ? |
| FC au repos, variabilité | moyenne sur 7 jours contre la bande de référence (§ 4.8) | je récupère ? |
| VO2max | Apple et effective, mensuelles | grande tendance |

L'allure en Z2 est la tendance principale du débutant : à FC égale, on court plus vite à mesure que l'endurance vient. Elle se lit en mois, pas en jours.

## 4. Le plan de reprise

Un générateur déterministe (`plan.ts`), qui produit des semaines de séances décrites en blocs (§ 4.10), recalculé chaque lundi d'après ce qui a été réellement fait (comme la cible de Santé) : la semaine en cours est ferme, les suivantes indicatives.

### 4.1 Entrées

- La personne : âge, sexe, zones (§ 1), historique de course et des autres séances.
- Ses disponibilités : jours possibles pour courir, durée maximale par jour, jour préféré pour la sortie longue (samedi ou dimanche par défaut).
- Ses autres activités fixes : jours de natation, de kettlebell ou de renforcement (le programme de l'Entraînement s'il y en a un).
- Son objectif : *courir plus longtemps* (par défaut : tenir 60 min, puis allonger), *10 km*, *semi-marathon*. Une date seulement pour 10 km et semi.
- La date de départ.

### 4.2 Point de départ

Calculé d'après l'historique :
- `arrêt` = jours depuis la dernière course ;
- `capacité` = la plus longue course continue (sans marche) des 8 semaines précédant l'arrêt, et le nombre de sorties sur ces 12 semaines.

| Arrêt | Départ |
|---|---|
| ≤ 7 jours | on continue la semaine prévue |
| 8 à 28 jours | on recule : volume de la semaine × 0,75, sortie longue × 0,80, pas de qualité la première semaine |
| 29 à 56 jours | phase 1, semaine 1 (si capacité ≥ 30 min continues) ; sinon phase 0, niveau 5 |
| > 56 jours | **phase 0** : niveau 4 si capacité ≥ 30 min continues et au moins 8 sorties sur les 12 semaines, sinon niveau 1 |
| jamais couru | phase 0, niveau 1 |

Pourquoi : les gains récents de VO2max sont entièrement perdus après plus de 4 semaines d'arrêt chez quelqu'un qui s'entraînait depuis peu (Mujika et Padilla 2000), et les tendons et les os se désadaptent aussi ; mais quelqu'un qui a déjà couru reprend plus vite qu'un vrai débutant. Le débutant se blesse plus que le coureur habitué (17,8 blessures pour 1 000 h de course contre 7,7 ; Videbæk 2015) : on commence bas et on monte vite si tout va bien, plutôt que l'inverse.

La première séance est une **séance repère** au niveau de départ : son ressenti décide du saut (§ 4.3).

### 4.3 Phase 0 : marche-course

Le principe du « Couch to 5K » du NHS (9 semaines, 3 séances, de 60 s de course / 90 s de marche à 30 min continues), en paliers et piloté par le ressenti. Chaque séance : 5 min de marche rapide, les blocs, 5 min de marche.

| Niveau | Blocs | Course | Séance |
|---|---|---|---|
| 1 | 8 × (1 min course, 1 min 30 marche) | 8 min | 30 min |
| 2 | 6 × (2 min, 1 min) | 12 min | 28 min |
| 3 | 5 × (3 min, 1 min) | 15 min | 30 min |
| 4 | 4 × (5 min, 1 min) | 20 min | 34 min |
| 5 | 3 × (8 min, 1 min) | 24 min | 37 min |
| 6 | 2 × (12 min, 1 min) | 24 min | 36 min |
| 7 | 20 min continues | 20 min | 30 min |
| 8 | 25 à 30 min continues | 25–30 min | 35–40 min |

Course en Z1–Z2 (effort 3 à 4, on peut parler) ; si la FC dépasse le haut de Z2, ralentir, et marcher si besoin : c'est prévu, pas un échec.

Règles, après chaque séance (effort perçu et douleur, § 4.8) :
- **Monter d'un niveau** après 2 séances du niveau faites en entier, effort ≤ 4, douleur ≤ 2.
- **Sauter un niveau** si les 2 séances étaient à effort ≤ 3 (une fois par semaine au plus). La séance repère peut faire sauter jusqu'à 2 niveaux si son effort est ≤ 3.
- **Rester** si effort 5 à 6.
- **Redescendre d'un niveau** si effort ≥ 7, séance interrompue, ou douleur 3 à 4.
- Douleur ≥ 5 : § 4.8.
- 3 séances par semaine (au moins un jour sans course entre deux), 2 si la personne n'a que 2 jours ; à 2 séances, il faut 3 séances réussies pour monter.

**Passage en phase 1** : niveau 8 fait deux fois, effort ≤ 4.

### 4.4 Phase 1 : base continue

Tout en footing facile (Z2, Z1 permis). Objectif : 3 sorties par semaine, la plus longue jusqu'à 60 min.

Volumes (en minutes de course ; les kilomètres suivent, on ne les prescrit pas) :
- Semaine 1 : `V₁ = n × 25 min` (n = nombre de sorties, § 4.7), sortie longue `L₁ = min(30 min, part × V₁)`.
- Volume visé : `V_s = arrondi_5(V_réf × 1,10)`, avec `V_réf` = la moyenne des 2 dernières semaines **réalisées** (pas prévues), semaines de décharge exclues ; au plus `V_réf × 1,20` ; au moins `V_réf` (pas de recul sans raison).
- Sortie longue : `L_s = min(L_{s−1} + 5 min, 1,10 × plus longue des 30 jours, part × V_s)` avec `part` = 0,55 à 2 sorties, 0,40 à 3, 0,35 à 4.
- Footings : `(V_s − L_s) / (n − 1)`, bornés entre 20 et 50 min ; en dessous de 20 min, une sortie de moins.
- Le plan se compte en minutes ; la règle des 30 jours se vérifie en distance prévue = durée × vitesse médiane des footings des 4 dernières semaines.
- Dès la semaine 3 : 4 × 20 s de **lignes droites** (accélérations relâchées, pas un sprint) à la fin d'un footing par semaine, pour la foulée.
- Décharge toutes les 4 semaines (§ 4.9).

**Passage en phase 2**, tous les critères :
- au moins 4 semaines en phase 1 ;
- 3 dernières semaines avec au moins 2 sorties chacune et au moins 80 % des séances prévues faites ;
- une sortie longue d'au moins 50 min, effort ≤ 4 ;
- aucune douleur ≥ 3 depuis 14 jours ;
- si calculable, découplage de la dernière sortie longue < 8 %.

### 4.5 Phase 2 : endurance

La sortie longue passe de 60 à 90 min ; un peu de qualité arrive, prudemment.

- Volume : mêmes règles qu'en phase 1 ; plafond par défaut 4 h par semaine en reprise.
- Sortie longue : `+10 min toutes les 2 semaines` (sans dépasser la règle des 30 jours ni la part du volume), jusqu'à 90 min.
- Qualité : **une séance par semaine au plus**, à partir de la 3e semaine de la phase, dans cet ordre : lignes droites (déjà là), puis fartlek léger, puis côtes courtes. Jamais deux jours de suite avec la sortie longue.
- Répartition : au moins 80 % du temps de course en facile sur 4 semaines ; si moins, la qualité saute la semaine suivante.
- Test aérobie toutes les 4 à 6 semaines (§ 4.10) : il remplace un footing.

**Passage en phase 3** (seulement si l'objectif le demande : 10 km, semi, ou la personne l'active) : au moins 6 semaines en phase 2, sortie longue de 75 min ou plus faite deux fois avec un découplage < 5 %, 3 sorties par semaine régulières sur 6 semaines, pas de douleur ≥ 3 depuis 21 jours.

Objectif « courir plus longtemps » : on reste en phase 2, sortie longue plafonnée à 90 min (puis 120 si la personne le demande), et c'est très bien ainsi.

### 4.6 Phase 3 : développement

- Qualité : 2 séances par semaine au plus (tempo, côtes, fartlek), jamais deux jours de suite, et jamais la veille de la sortie longue.
- Temps en modéré + difficile ≤ 20 % du temps de course.
- Test de Friel proposé (une fois, puis tous les 3 mois) pour mesurer la FCseuil (§ 1.1).
- **Semi-marathon** : au moins 12 semaines entre l'entrée en phase 3 et la date ; sortie longue jusqu'à 1 h 45 – 2 h (2 h 30 au plus), dont une partie à l'allure visée dans les 6 dernières semaines ; dernière semaine à −40 % de volume, la précédente à −20 %. Une date trop proche est refusée avec la première date possible.
- **10 km** : au moins 8 semaines ; sortie longue jusqu'à 75–90 min ; même affûtage sur une semaine.

### 4.7 Combien de sorties par semaine

| Jours disponibles | Phase 0 | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|---|
| 1 | 1 (entretien : on progresse peu ; le dire) | 1 | 1 | — (refus d'objectif chiffré) |
| 2 | 2 | 2 | 2 | 2 (1 qualité au plus) |
| 3 | 3 | 3 | 3 | 3 |
| 4 et plus | 3 | 3 | 4 | 4 (5 si la personne le demande et la phase 2 a été faite à 4) |

Trois sorties est le conseil par défaut : c'est le rythme des programmes débutants qui marchent (NHS) et la fréquence aide plus que la durée de chaque sortie. À une sortie par semaine, la sortie suit quand même la règle des 30 jours et ne grandit que de 5 min toutes les 2 semaines.

### 4.8 S'adapter : règles explicites

Le matin et après chaque séance, Mijote lit les signaux ; chaque règle dit ce qu'elle change. Les signaux uniques d'un jour ne bloquent jamais seuls (sauf la douleur).

**Bande de référence** (FC au repos et variabilité) : moyenne et écart-type des 60 derniers jours, au moins 20 mesures. La variabilité d'Apple est un SDNN (pas le RMSSD des études) : on travaille sur `ln(SDNN)`, moyenne glissante sur 7 jours, au moins 4 mesures dans ces 7 jours, sinon pas de signal. Seuil = **plus petit changement utile** : 0,5 écart-type (Plews et Buchheit ; Javaloyes 2020).

| Signal | Condition | Action |
|---|---|---|
| Séance manquée | une | jamais rattrapée ; la semaine suivante se calcule sur le réalisé |
| Semaine trop courte | moins de la moitié des séances faites | on refait la même semaine |
| Arrêt | 8 jours et plus sans courir | règles de départ du § 4.2 |
| Effort trop haut | footing à effort ≥ 6, ou 2 séances de suite au-dessus de l'effort prévu de 2 points | prochaine séance : footing −30 % ou repos ; pas de qualité pendant 7 jours |
| FC trop haute pour l'effort | footing avec plus de 30 % du temps de course au-dessus de Z2, alors que l'allure était facile | message « ralentir, marcher si besoin » ; si 3 footings de suite : retour d'un niveau (phase 0) ou semaine sans progression |
| Variabilité basse | moyenne 7 j de ln(SDNN) < moyenne de référence − 0,5 écart-type | qualité remplacée par un footing ; volume de la semaine non augmenté |
| FC au repos haute | moyenne 7 j ≥ référence + 5 bpm, ou 2 matins de suite ≥ référence + 7 bpm | idem ; si les deux signaux à la fois : 1 à 2 jours de repos, puis footing court |
| Sommeil court | moins de 6 h deux nuits de suite | pas de qualité le lendemain |
| Fatigue de charge | TSB% < −30 | prochaine séance : footing court ou repos |
| Chaleur | ≥ 25 °C annoncés ou mesurés | consigne : courir tôt, se fier à la FC et non à l'allure, raccourcir ; aucune séance de qualité |
| Malade | la personne le signale (fièvre, symptômes sous le cou) | pas de course ; reprise par un footing court après 2 jours sans symptômes |

**Douleur.** Une question en un geste après chaque course : « une douleur ? » 0 à 10 et où (pied, cheville, tibia, mollet / tendon d'Achille, genou, hanche, autre). Inspiré du modèle de suivi de la douleur de Silbernagel (2007), en plus prudent pour des coureurs qui ne sont pas suivis :

| Douleur | Action |
|---|---|
| 0 à 2, et revenue à l'habitude le lendemain matin | on continue |
| 3 à 4, ou plus forte le lendemain matin | prochaine course remplacée par repos ou natation ; semaine suivante −30 % et sans qualité ; on redemande au matin |
| ≥ 5, boiterie, ou douleur ≥ 3 au même endroit trois fois en 14 jours, ou douleur qui dure plus de 7 jours | **course suspendue** : plan en pause, message « avis d'un professionnel de santé (médecin, kinésithérapeute) » ; la reprise se fait par la personne, qui rouvre le plan (départ selon § 4.2) |

Pas de diagnostic, jamais : Mijote dit quoi faire de la course, pas ce qu'est la douleur.

### 4.9 Semaines de décharge

- **Toutes les 4 semaines** (3 qui montent, 1 qui allège) : volume × 0,70 de la semaine précédente, sortie longue × 0,80, pas de qualité (lignes droites permises). En phase 0, pas de décharge programmée : les niveaux suffisent.
- La semaine après une décharge repart du volume et de la sortie longue d'avant la décharge, pas de ceux de la décharge.
- Décharge avancée si 2 signaux d'adaptation (§ 4.8) dans la même semaine.

### 4.10 Les séances

Chaque séance est une structure en blocs, la même pour l'écran de Mijote et pour la montre :

```json
{
  "kind": "footing",
  "title": "Footing facile 35 min",
  "warmup": { "goal": { "time": 300 }, "alert": null, "label": "Marche rapide puis trot" },
  "blocks": [
    { "iterations": 1, "steps": [
      { "purpose": "work", "goal": { "time": 1500 }, "alert": { "hr": [127, 147] }, "label": "Footing en Z2" }
    ] }
  ],
  "cooldown": { "goal": { "time": 300 }, "alert": null, "label": "Marche" }
}
```

- `goal` : `{ "time": secondes }`, `{ "distance": mètres }` ou `"open"` ;
- `alert` : `null`, `{ "hr": [bas, haut] }` en bpm, `{ "zone": 1..5 }` (zones de la montre, déconseillé), `{ "pace": [plus rapide, plus lente] }` en s/km ;
- `purpose` : `work` ou `recovery` ;
- `iterations` : 1 à 30.

Les types :

| Type | Phase | Blocs | Cible |
|---|---|---|---|
| **Marche-course** | 0 | échauffement 5 min marche ; n × (course t₁, marche t₂) ; retour 5 min marche | course : FC Z1–Z2, effort 3–4 |
| **Footing** | 1+ | échauffement 5 min (marche puis trot) ; 1 × course durée ; retour 5 min | FC Z1 bas → Z2 haut |
| **Footing + lignes droites** | 1+ | footing ; puis 4 à 6 × (20 s vite et relâché, 60–90 s marche) ; retour 5 min | lignes droites sans alerte (trop courtes pour la FC), effort 7 |
| **Sortie longue** | 1+ | échauffement 5 min ; 1 × course durée ; retour 5 min | Z2 ; les 10 dernières minutes peuvent finir en haut de Z2 |
| **Test aérobie** | 1+ | échauffement 10 min ; 30 min à FC fixe (milieu de Z2 ± 3 bpm) ; retour 5 min | sert l'allure en Z2, l'EF et le découplage, à comparer toutes les 4–6 semaines (méthode de Friel) |
| **Fartlek léger** | 2+ | échauffement 10 min ; 6 à 8 × (1 min soutenu, 2 min footing) ; retour 10 min | soutenu : Z3–Z4, effort 6–7 |
| **Côtes courtes** | 2+ | échauffement 15 min ; 6 à 8 × (30–60 s en montée de 5 à 8 %, retour en marchant ou trottinant en descente) ; retour 10 min | effort 7–8 ; pas d'alerte FC (elle arrive après l'effort) ; objectif temps |
| **Tempo** | 3 | échauffement 15 min ; 2 à 3 × (8–10 min, 2–3 min footing) ; retour 10 min | Z3 haut – Z4 bas (90–95 % de la FCseuil), effort 6–7, « confortablement difficile » |
| **Test de Friel** | 3 | échauffement 15 min ; 30 min à fond régulier ; retour 10 min | FCseuil = FC moyenne des 20 dernières min |

Bornes d'une séance (vérifiées pour tout ce que produit le générateur ou l'IA) : 15 à 180 min en tout ; un pas de travail de 10 s à 90 min ; un pas de récupération de 30 s à 10 min ; échauffement et retour de 3 à 20 min.

**Vers la montre (WorkoutKit).** La structure se traduit telle quelle :

| Mijote | WorkoutKit |
|---|---|
| séance | `CustomWorkout(activity: .running, location: .outdoor, displayName:, warmup:, blocks:, cooldown:)` |
| `warmup`, `cooldown` | `WorkoutStep(goal:, alert:, displayName:)` (nom affiché à partir d'iOS 18) |
| bloc | `IntervalBlock(steps:, iterations:)` |
| pas | `IntervalStep(.work)` ou `IntervalStep(.recovery)`, son `step` est un `WorkoutStep` |
| `goal` | `.time(s, .seconds)`, `.distance(m, .meters)`, `.open` |
| `{ "hr": [a, b] }` | `HeartRateRangeAlert(target: a...b)` (bpm) |
| `{ "zone": n }` | `HeartRateZoneAlert(zone: n)` (zones de la montre) |
| `{ "pace": [p1, p2] }` | `SpeedRangeAlert(target: (1000/p2)...(1000/p1) m/s, metric: .average)` (pas d'alerte d'allure : on convertit en vitesse) |

Limites à connaître : un bloc ne s'arrête pas sur une durée totale (on compte les répétitions) ; les alertes se déclenchent quand la valeur sort de la plage, pas avant ; vérifier `CustomWorkout.supportsGoal` et `supportsAlert` pour l'activité ; pour la vitesse, `.average` sur le pas plutôt que `.current` (le GPS est bruité). La planification sur la montre passe par `WorkoutScheduler` dans l'app iPhone.

Plages d'alerte FC : le pas « footing » vise de la borne basse de Z1 + 5 bpm à la borne haute de Z2 ; « soutenu » de Z3 à Z4 ; jamais une plage de moins de 8 bpm (la FC optique varie de quelques bpm).

### 4.11 Placer les séances dans la semaine, avec la natation et la kettlebell

Algorithme déterministe : on place d'abord la sortie longue (jour préféré, sinon le dernier jour disponible de la semaine), puis la qualité, puis les footings, en maximisant l'écart entre deux courses ; à égalité, le jour le plus tôt.

Règles :
- **Pas deux jours de course de suite** en phases 0 et 1 si les disponibilités le permettent ; en phases 2–3, deux jours de suite seulement si l'un est un footing court.
- **Qualité à au moins 48 h** de la sortie longue (avant comme après).
- **Natation** : compatible avec tout, à placer de préférence un jour sans course ou le lendemain de la sortie longue (récupération active, sans impact). Elle compte dans la charge totale, pas dans le volume de course ; c'est aussi l'« autre sport » qui adoucit la perte de forme pendant une pause (table de Daniels).
- **Kettlebell, renforcement** : à garder, c'est le meilleur allié contre les blessures (le renforcement divise par trois environ le risque de blessure sportive dans la méta-analyse de Lauersen 2014, alors que les étirements ne font rien) et il protège la masse musculaire en recomposition. Pas une séance qui charge les jambes la veille de la sortie longue ou d'une séance de qualité. Le même jour qu'une course : seulement avec un footing, course d'abord, au moins 3 h d'écart (l'interférence sur la force explosive n'apparaît que dans la même séance ; Schumann 2022 ne trouve pas d'interférence sur la force maximale ni sur le volume musculaire).
- **Au moins un jour sans rien** par semaine (ou seulement de la natation tranquille).
- Le plan ne déplace jamais une activité fixe de la personne ; s'il ne peut pas tout placer, il enlève d'abord un footing, et le dit.

### 4.12 Garanties du générateur

Tout plan produit, et toute modification (personne ou IA), respecte : la règle des 30 jours (§ 2.6) et une seule sortie record par 7 jours ; la progression de volume (§ 4.4) ; la part de la sortie longue ; le nombre de séances de qualité par phase ; la décharge toutes les 4 semaines au plus ; les bornes de séance (§ 4.10) ; aucun type de séance hors de sa phase ; aucune course pendant une suspension pour douleur. Les tests doivent le vérifier sur des historiques fictifs (débutant, reprise après 5 mois, coureur régulier, 1 sortie par semaine, arrêts de 10, 40 et 90 jours, douleur, signaux du matin).

## 5. Nutrition et récupération

Ce que le module affiche, sans prétention médicale ni promesse de performance ; tout se rattache à ce que Santé sait déjà (cible du jour, protéines, repas prévus).

**Énergie.** Coût de la course : environ 1 kcal par kg et par km, quelle que soit l'allure (Margaria 1963), affiché comme ordre de grandeur. La cible de Santé reste celle de la méthode adaptative (la balance mesure la dépense réelle) : le module ne la change pas. Il propose seulement de **répartir le déficit** : le jour d'une sortie de plus de 75 min, pas de déficit ce jour-là, l'écart est réparti sur les autres jours de la semaine (le total de la semaine ne bouge pas). Garde-fou : déficit visé de plus de 500 kcal par jour et plus de 3 h de course par semaine → message « le déficit est fort pour ce volume ; récupération et progrès risquent d'en pâtir ».

**Glucides.**
- Sortie de moins de 60 min : rien de particulier ; un repas normal dans les 2 à 3 h avant suffit.
- Sortie de 60 à 75 min : facultatif ; un en-cas glucidique avant si le dernier repas date.
- Sortie de plus de 75 min (et toute séance longue de 1 à 2 h 30) : **30 à 60 g de glucides par heure** pendant la sortie (position commune ACSM, Academy of Nutrition and Dietetics, Diététistes du Canada, 2016), à essayer en entraînement, jamais pour la première fois le jour d'une course. Un repas riche en glucides la veille ou le matin.
- Après une sortie longue : un repas avec glucides et protéines dans les 2 h. Mijote peut suggérer de placer ce jour-là un repas du batch plus riche en féculents, s'il y en a un dans la Semaine.

**Protéines.** Rien de nouveau : la cible de Santé (1,6 g/kg par défaut ; jusqu'à 2,2 g/kg utile en recomposition, au-delà pas de gain démontré : Morton 2018 ; les plus maigres en fort déficit peuvent aller plus haut : Helms 2014). Le module rappelle seulement de répartir : 0,3 à 0,4 g/kg par repas (Schoenfeld et Aragon 2018), dont un dans les 2 h après la course ou la kettlebell.

**Hydratation.**
- **Boire selon la soif** : c'est la stratégie la plus sûre avant, pendant et après l'effort (consensus 2015 sur l'hyponatrémie d'effort) ; ne jamais finir une sortie plus lourd qu'au départ.
- Au-delà de 60 min, ou par chaleur : partir avec de l'eau.
- Facultatif, pour les sorties longues : se peser avant et après (sans vêtements mouillés) donne la sudation : `litres/h = (poids avant − poids après + boissons bues) / heures`. Une perte de plus de 2 % du poids dit qu'il faut boire un peu plus la prochaine fois (ACSM 2007). Sel dans la boisson au-delà de 2 h.

**Chaleur.** Courir tôt, ralentir, se fier à la FC ; au-delà de 30 °C, proposer la natation à la place.

**Récupération.** Le sommeil d'abord (signal du § 4.8) ; jours faciles vraiment faciles. Pas de compléments recommandés.

## 6. Ce que l'IA peut proposer, ce que le code vérifie

Les deux conversations existantes (coach de Santé › Objectifs, assistant) peuvent recevoir des outils de course. Elles **lisent** un instantané calculé par le code (zones et leur source, charge, forme, dernières sorties et leurs analyses, phase, plan des 2 prochaines semaines, signaux du matin) et **proposent** des actions typées ; elles n'écrivent rien et ne calculent aucun chiffre affiché.

| Action | Ce que l'IA fournit | Ce que le code vérifie |
|---|---|---|
| `run.plan.create` | objectif, jours disponibles, durée max par jour, jour de sortie longue, date (si objectif chiffré) | champs dans leurs bornes ; le plan est **généré par le code** à partir de ces choix ; date assez lointaine (§ 4.6) |
| `run.session.move` | séance, nouveau jour | jour disponible et dans la semaine en cours ou la suivante ; règles de placement (§ 4.11) |
| `run.session.replace` | séance, nouveau type, durée | type permis dans la phase ; bornes de séance ; règle des 30 jours ; qualité par semaine ; jamais plus dur après un signal du § 4.8 |
| `run.session.shorten` / `skip` | séance, nouvelle durée | toujours permis (alléger est sûr) |
| `run.week.adjust` | semaine, volume visé | ≤ plafond de progression (§ 4.4) et ≥ 50 % du réalisé ; sortie longue recalculée par le code |
| `run.plan.pause` / `resume` | raison | reprise : départ recalculé (§ 4.2) ; après une suspension pour douleur, seulement à la demande de la personne |
| `run.zones.set` | FCmax, FCrepos ou FCseuil saisies par la personne | 120 ≤ FCmax ≤ 230 ; 30 ≤ FCrepos ≤ 100 ; FCrepos + 20 < FCseuil < FCmax ; cohérence avec les observations (écart de plus de 15 bpm → la personne confirme) |
| `run.feedback.note` | effort, douleur, malade, notes | effort 1–10, douleur 0–10, lieu dans la liste |

Invariants pour toute proposition, sinon refus avec la liste des erreurs, renvoyée une fois à l'IA, puis abandon (le même schéma que les figures de l'Entraînement) :
- rien n'augmente (volume, durée, intensité) quand un signal du § 4.8 est actif ou dans les 7 jours qui suivent une douleur ≥ 3 ;
- aucune séance pendant une suspension pour douleur, et l'IA ne lève pas la suspension ;
- aucune sortie au-delà de 1,10 × la plus longue des 30 jours, une seule sortie record par 7 jours ;
- répartition prévue sur 4 semaines : au moins 80 % de temps facile ;
- séances décrites seulement avec les types du § 4.10, alertes FC dans la table de zones en cours, plages d'au moins 8 bpm ;
- dates futures, dans l'horizon du plan (8 semaines) ;
- pas de conseil médical ni de diagnostic dans le texte proposé (le texte est montré tel quel, mais l'action ne contient aucun chiffre libre : les nombres affichés viennent du code).

Ce que l'IA fait bien et à quoi on la réserve : expliquer une analyse en mots simples (« le cœur est monté de 9 bpm sur la fin, la chaleur y est pour beaucoup »), traduire une contrainte de vie (« pas le mercredi, et dimanche je pars ») en déplacements, choisir entre deux variantes permises.

## 7. Graphiques

Pour le tableau de bord Course (une question par graphique) :

| Graphique | Question | Forme |
|---|---|---|
| Volume par semaine | je progresse régulièrement ? | barres de minutes de course empilées par zone (facile, modéré, difficile), trait du volume prévu, semaines de décharge marquées |
| Condition, fatigue, fraîcheur | suis-je trop fatigué ? | deux courbes (CTL, ATL) et, dessous, la fraîcheur en barres colorées par bande (§ 2.4) |
| Sortie la plus longue | la prochaine sortie longue est-elle raisonnable ? | points (sortie la plus longue de chaque semaine) et le plafond « +10 % des 30 jours » en escalier |
| Allure en Z2 | mon cardio progresse ? | points par sortie, médiane glissante, sorties « chaleur » en creux |
| Répartition sur 4 semaines | est-ce que je cours assez lentement ? | une barre 100 % en trois parts, repère à 80 % |
| Régularité | je tiens ? | calendrier des 12 dernières semaines, une case par jour, toutes activités (course, natation, kettlebell) |
| Signaux du matin | je récupère ? | FC au repos et variabilité (7 j) sur leur bande de référence |
| Phase | où j'en suis ? | frise des phases, semaine en cours, critères de passage cochés |
| VO2max | grande tendance | Apple et effective, mensuelles |

Pour une sortie :

| Graphique | Question |
|---|---|
| FC et allure ajustée dans le temps, bandes de zones en fond, marche et arrêts grisés, blocs prévus en surimpression | comment s'est passée la séance, ai-je tenu la consigne ? |
| Temps par zone (barres horizontales) | à quelle intensité ai-je couru ? |
| Temps au km (tableau : allure, allure ajustée, FC, dénivelés, cadence, avec petites barres) | où ai-je ralenti, et pourquoi ? |
| Découplage : les deux moitiés côte à côte (EF), la valeur et sa lecture | mon endurance tient-elle sur cette durée ? |
| Profil d'altitude aligné sur la courbe de FC | la FC monte-t-elle à cause des côtes ? |
| Prévu / réalisé par bloc (cases cochées, temps dans la plage) | ai-je fait la séance ? |

Couleurs : jetons de `cuisine-tokens.css`, une teinte par zone en dégradé (de calme à vif), la même partout (montre exceptée).

## 8. Récapitulatif des constantes

| Constante | Valeur | Source |
|---|---|---|
| FCmax estimée | 208 − 0,7 × âge | Tanaka 2001 |
| FCmax observée | max des moyennes 30 s, confirmé à 5 bpm, 365 j, vers le haut seulement | choix de Mijote |
| FCrepos | médiane 30 j, au moins 7 mesures ; défaut 60 | choix de Mijote |
| FCseuil par défaut | FCrepos + 0,80 × réserve | choix de Mijote |
| Zones | réserve 50/60/70/80/90 % ; Friel 85/90/95/100 % de la FCseuil si mesurée | Karvonen, Apple, Friel |
| TRIMP | homme 0,64 e^(1,92 x), femme 0,86 e^(1,67 x) | Banister 1991 |
| Charge | 100 = 1 h à la FCseuil | TrainingPeaks (hrTSS), HRSS |
| CTL, ATL | 42 j, 7 j, `1 − e^(−1/τ)` | Banister, TrainingPeaks, intervals.icu |
| Bandes de fraîcheur (%) | +20, +5, −10, −30 | intervals.icu |
| Règle des 30 jours | ≤ 1,10 × la plus longue | Frandsen 2025 |
| Progression hebdomadaire | +10 % visé, +20 % au plus (moyenne 2 semaines) ; alerte à +30 % | Buist 2008, Nielsen 2014, choix de Mijote |
| Décharge | 1 semaine sur 4 : × 0,70 volume, × 0,80 sortie longue | usage courant, choix de Mijote |
| Part de la sortie longue | 0,55 / 0,40 / 0,35 (2 / 3 / 4 sorties) | choix de Mijote |
| Répartition | ≥ 80 % facile | Seiler 2010 |
| Découplage | < 5 % bon, > 8 % marqué | Friel, TrainingPeaks |
| Variabilité | ln(SDNN) 7 j < moyenne 60 j − 0,5 écart-type | Plews, Javaloyes 2020 |
| FC au repos | 7 j ≥ référence + 5 bpm | choix de Mijote |
| Glucides | 30–60 g/h au-delà de 75 min | Thomas, Erdman, Burke 2016 |
| Hydratation | selon la soif ; perte < 2 % | Hew-Butler 2015, ACSM 2007 |
| Pente | Minetti 2002, g borné à ±0,20, facteur ≥ 0,80 | Minetti 2002, choix de Mijote |
| Chaleur | ≥ 25 °C : exclue des tendances, pas de qualité | choix de Mijote |

## 9. Références

Zones et intensité
- Tanaka H., Monahan K. D., Seals D. R. *Age-predicted maximal heart rate revisited.* J Am Coll Cardiol 2001;37(1):153-156. [doi:10.1016/S0735-1097(00)01054-8](https://www.jacc.org/doi/10.1016/S0735-1097%2800%2901054-8)
- Swain D. P., Leutholtz B. C. *Heart rate reserve is equivalent to %VO2 reserve, not to %VO2max.* Med Sci Sports Exerc 1997;29(3):410-414. [Semantic Scholar](https://www.semanticscholar.org/paper/Heart-rate-reserve-is-equivalent-to-VO2-reserve,-to-Swain-Leutholtz/ed01c2b1609478ee322211be760645349f1ae2c6)
- Friel J. *Quick guide to setting zones.* [TrainingPeaks](https://www.trainingpeaks.com/learn/articles/joe-friel-s-quick-guide-to-setting-zones/)
- Seiler S. *What is best practice for training intensity and duration distribution in endurance athletes?* Int J Sports Physiol Perform 2010;5:276-291. [PDF](https://umh1617.umh.es/files/2016/05/02-IJSPP_2010_Seiler_0009.pdf) ; Stöggl T., Sperlich B. *The training intensity distribution among well-trained and elite endurance athletes.* Front Physiol 2015. [Frontiers](https://www.frontiersin.org/articles/10.3389/fphys.2015.00295/full)
- Apple. *Zones de fréquence cardiaque sur l'Apple Watch.* [Guide de l'Apple Watch](https://support.apple.com/guide/watch/apd897dccddf/watchos) ; [9to5Mac, méthode de la réserve](https://9to5mac.com/2024/05/23/heart-rate-zones-apple-watch-iphone/)
- Estimations de seuil par les montres : *Validity of smartwatch-derived estimates of lactate threshold heart rate and pace compared to graded exercise testing*, 2025. [PMC12309276](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12309276/)

Charge et forme
- Banister E. W. *Modeling elite athletic performance*, in *Physiological Testing of Elite Athletes*, 1991 ; Morton R. H., Fitz-Clarke J. R., Banister E. W. *Modeling human performance in running.* J Appl Physiol 1990;69(3):1171-1177. Présentation : [Fellrnr, Modeling Human Performance](https://fellrnr.com/wiki/Modeling_Human_Performance)
- TrainingPeaks. *Training Stress Scores (TSS) Explained* (hrTSS). [Aide](https://help.trainingpeaks.com/hc/en-us/articles/204071944-Training-Stress-Scores-TSS-Explained) ; formule HRSS : [forum TrainerRoad](https://www.trainerroad.com/forum/t/formula-to-calculate-hrtss/22982)
- intervals.icu : condition et fatigue (42 j, 7 j), fraîcheur en %, bandes. [Forum](https://forum.intervals.icu/t/form-vs-fatigue-and-how-i-feel/86486)
- Foster C. et al. *A new approach to monitoring exercise training.* J Strength Cond Res 2001;15(1):109-115 ; Foster C. *Monitoring training in athletes with reference to overtraining syndrome.* Med Sci Sports Exerc 1998;30(7):1164-1168 ; Haddad M. et al. *Session-RPE method for training load monitoring: validity, ecological usefulness, and influencing factors.* Front Neurosci 2017. [Frontiers](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2017.00612/full)
- Apple. *Suivre sa charge d'entraînement sur l'Apple Watch.* [Assistance Apple](https://support.apple.com/guide/watch/track-your-training-load-apde4c07a6cf/watchos) ; [DC Rainmaker, effort × durée](https://www.dcrainmaker.com/2024/07/apples-training-load-vitals-watchos11.html)
- Garmin. *Acute Load, Load Ratio* (manuel fēnix 8). [Garmin](https://www8.garmin.com/manuals/webhelp/GUID-EECCAC99-90D6-4AB1-9A3A-EC433D3365E2/EN-US/GUID-AEDB0872-C5A1-4378-86D5-2239734B59E8.html)
- Impellizzeri F. M. et al. *Acute:Chronic Workload Ratio: Conceptual Issues and Fundamental Pitfalls.* Int J Sports Physiol Perform 2020;15(6):907-913. [ResearchGate](https://www.researchgate.net/publication/341936245_AcuteChronic_Workload_Ratio_Conceptual_Issues_and_Fundamental_Pitfalls) ; Impellizzeri F. M. et al. *What role do chronic workloads play in the ACWR? Time to dismiss ACWR and its underlying theory.* Sports Med 2021;51:581-592.
- Lolli L. et al. *Mathematical coupling causes spurious correlation within the conventional acute-to-chronic workload ratio calculations.* Br J Sports Med 2019;53:921. [ResearchGate](https://www.researchgate.net/publication/320847733_Mathematical_coupling_causes_spurious_correlation_within_the_conventional_acute-to-chronic_workload_ratio_calculations)

Blessures et progression
- Frandsen J. S. B., Hulme A., Parner E. T. et al. *How much running is too much? Identifying high-risk running sessions in a 5200-person cohort study.* Br J Sports Med 2025;59(17):1203-1210. [doi:10.1136/bjsports-2024-109380](https://doi.org/10.1136/bjsports-2024-109380) ; [communiqué de l'université d'Aarhus](https://health.au.dk/en/display/artikel/everything-we-thought-about-running-injury-development-was-wrong-study-shows)
- Buist I. et al. *No effect of a graded training program on the number of running-related injuries in novice runners: a randomized controlled trial.* Am J Sports Med 2008;36(1):33-39. [PubMed 17940147](https://pubmed.ncbi.nlm.nih.gov/17940147/)
- Nielsen R. O. et al. *Excessive progression in weekly running distance and risk of running-related injuries.* J Orthop Sports Phys Ther 2014;44(10):739-747. [JOSPT](https://www.jospt.org/doi/10.2519/jospt.2014.5164)
- Damsted C. et al. *Is there evidence for an association between changes in training load and running-related injuries? A systematic review.* Int J Sports Phys Ther 2018. [PMC6253751](https://pmc.ncbi.nlm.nih.gov/articles/PMC6253751/)
- Videbæk S. et al. *Incidence of running-related injuries per 1000 h of running in different types of runners.* Sports Med 2015;45(7):1017-1026. [PMC4473093](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4473093/)
- Lauersen J. B., Bertelsen D. M., Andersen L. B. *The effectiveness of exercise interventions to prevent sports injuries.* Br J Sports Med 2014;48(11):871-877. [ResearchGate](https://www.researchgate.net/publication/257530132_The_effectiveness_of_exercise_interventions_to_prevent_sports_injuries_A_systematic_review_and_meta-analysis_of_randomised_controlled_trials)
- Silbernagel K. G. et al. *Continued sports activity, using a pain-monitoring model, during rehabilitation in patients with Achilles tendinopathy.* Am J Sports Med 2007;35(6):897-906. [ResearchGate](https://www.researchgate.net/publication/6497499_Continued_Sports_Activity_Using_a_Pain-Monitoring_Model_During_Rehabilitation_in_Patients_With_Achilles_Tendinopathy_A_Randomized_Controlled_Study)
- NHS. *Couch to 5K.* [Présentation](https://en.wikipedia.org/wiki/Couch_to_5K) ; [plan semaine par semaine](https://www.aldridgerunningclub.co.uk/uploads/2/6/8/6/26866173/arc_couch25k_details.pdf)

Reprise et désentraînement
- Mujika I., Padilla S. *Detraining: loss of training-induced physiological and performance adaptations.* Part I, Sports Med 2000;30(2):79-87 ; Part II, 2000;30(3):145-154. [ResearchGate](https://www.researchgate.net/publication/12356236_Detraining_Loss_of_Training-Induced_Physiological_and_Performance_Adaptations_Part_I)
- Daniels J. *Daniels' Running Formula* ; VDOT O2, *VDOT adjustments for time off from running*, 2018. [VDOT O2](https://news.vdoto2.com/2018/02/vdot-adjustments-time-off/) ; équations de Daniels et Gilbert (*Oxygen Power*, 1979), reprises par exemple sur [runcalc.app](https://runcalc.app/about)

Analyse d'une sortie
- TrainingPeaks. *Aerobic Decoupling (Pw:Hr and Pa:HR) and Efficiency Factor (EF).* [Aide](https://help.trainingpeaks.com/hc/en-us/articles/204071724-Aerobic-Decoupling-Pw-Hr-and-Pa-HR-and-Efficiency-Factor-EF) ; Friel J. *Efficiency factor and decoupling.* [TrainingPeaks](https://www.trainingpeaks.com/blog/efficiency-factor-and-decoupling/)
- Coyle E. F., González-Alonso J. *Cardiovascular drift during prolonged exercise: new perspectives.* Exerc Sport Sci Rev 2001;29(2):88-92. [PDF](https://www.cibr.es/files/ka/apps/cibr/docs/04_2001_cardiovascular_drift_during_prolonged_exercise_and_the_effects_of_dehydration.pdf)
- Minetti A. E. et al. *Energy cost of walking and running at extreme uphill and downhill slopes.* J Appl Physiol 2002;93(3):1039-1046 ; [rétro-ingénierie de l'allure ajustée de Strava](https://aaron-schroeder.github.io/reverse-engineering/grade-adjusted-pace.html)

Variabilité cardiaque
- Plews D. J., Laursen P. B., Stanley J., Kilding A. E., Buchheit M. *Training adaptation and heart rate variability in elite endurance athletes: opening the door to effective monitoring.* Sports Med 2013;43(9):773-781.
- Javaloyes A. et al. *Training prescription guided by heart rate variability vs. block periodization in well-trained cyclists.* J Strength Cond Res 2020;34(6):1511-1518. [PDF](https://www.alancouzens.com/blog/Training_prescription_guided_by_HRV_in_cycling.pdf)

Entraînement concurrent
- Wilson J. M. et al. *Concurrent training: a meta-analysis examining interference of aerobic and resistance exercises.* J Strength Cond Res 2012;26(8):2293-2307. [JSCR](https://journals.lww.com/nsca-jscr/fulltext/2012/08000/concurrent_training__a_meta_analysis_examining.35.aspx)
- Schumann M. et al. *Compatibility of concurrent aerobic and strength training for skeletal muscle size and function: an updated systematic review and meta-analysis.* Sports Med 2022;52(3):601-612. [PMC8891239](https://pmc.ncbi.nlm.nih.gov/articles/PMC8891239/)

Nutrition et hydratation
- Thomas D. T., Erdman K. A., Burke L. M. *Position of the Academy of Nutrition and Dietetics, Dietitians of Canada, and the American College of Sports Medicine: Nutrition and Athletic Performance.* J Acad Nutr Diet 2016;116(3):501-528 ; Med Sci Sports Exerc 2016;48(3):543-568. [Diététistes du Canada (PDF)](https://www.dietitians.ca/DietitiansOfCanada/media/Documents/Resources/noap-position-paper.pdf?ext=.pdf)
- Kerksick C. M. et al. *International Society of Sports Nutrition position stand: nutrient timing.* J Int Soc Sports Nutr 2017. [PMC5596471](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5596471/)
- Morton R. W. et al. *A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults.* Br J Sports Med 2018;52:376-384. [PDF](http://breathe-edu-downloads.s3.amazonaws.com/Morton-2018.pdf)
- Schoenfeld B. J., Aragon A. A. *How much protein can the body use in a single meal for muscle-building? Implications for daily protein distribution.* J Int Soc Sports Nutr 2018;15:10.
- Margaria R., Cerretelli P., Aghemo P., Sassi G. *Energy cost of running.* J Appl Physiol 1963;18:367-370.
- Helms E. R., Zinn C., Rowlands D. S., Brown S. R. *A systematic review of dietary protein during caloric restriction in resistance trained lean athletes: a case for higher intakes.* Int J Sport Nutr Exerc Metab 2014;24(2):127-138.
- Sawka M. N. et al. *American College of Sports Medicine position stand. Exercise and fluid replacement.* Med Sci Sports Exerc 2007;39(2):377-390. [ResearchGate](https://www.researchgate.net/publication/6526394_American_College_of_Sports_Medicine_position_stand_Exercise_and_Fluid_Replacement)
- Hew-Butler T. et al. *Statement of the Third International Exercise-Associated Hyponatremia Consensus Development Conference, Carlsbad, California, 2015.* Clin J Sport Med 2015;25(4):303-320. [PDF](https://cupola.gettysburg.edu/cgi/viewcontent.cgi?article=1065&context=healthfac)

Apple (données et montre)
- WorkoutKit : [`CustomWorkout`](https://developer.apple.com/documentation/workoutkit/customworkout), [`IntervalBlock`](https://developer.apple.com/documentation/workoutkit/intervalblock), [`IntervalStep`](https://developer.apple.com/documentation/workoutkit/intervalstep), [`WorkoutStep`](https://developer.apple.com/documentation/workoutkit/workoutstep), [`WorkoutGoal`](https://developer.apple.com/documentation/workoutkit/workoutgoal), [`HeartRateRangeAlert`](https://developer.apple.com/documentation/workoutkit/heartraterangealert), [`HeartRateZoneAlert`](https://developer.apple.com/documentation/workoutkit/heartratezonealert), [`SpeedRangeAlert`](https://developer.apple.com/documentation/workoutkit/speedrangealert)
- HealthKit, effort d'une séance (`workoutEffortScore`, `estimatedWorkoutEffortScore`, iOS 18) : [forum Apple](https://developer.apple.com/forums/thread/763539) ; [lecture et écriture](https://sasq.ca/blog/2025/4/28/reading-writing-workout-effort-scores)
