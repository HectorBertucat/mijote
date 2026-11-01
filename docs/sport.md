# Sport

Santé › Entraînement : des programmes de renforcement à la maison, une séance guidée par une figure animée au bon tempo, un carnet.

## Les programmes

Un programme (`Program`, `src/lib/training/program.ts`) : 2 ou 3 séances alternées (A, B, C) faites de blocs en superset, un échauffement, une semaine type et des principes. Chaque personne a son programme en cours (table `training_programs`) ; en changer archive l'ancien, le carnet reste.

Trois façons d'en avoir un :

| | Comment | Où |
|---|---|---|
| **Modèle** | « Renfo maison » (débutant, peu de matériel) ou « Kettlebell maison » | `renfo.ts`, `program.ts` |
| **Générateur** | matériel, séances par semaine, durée, niveau, objectif → deux séances A/B en supersets (une famille du bas avec une du haut), sans IA | `generate.ts` (pur, testé) |
| **IA** | la même demande, plus des contraintes en clair (« genou fragile », « rien au sol ») ; l'IA choisit dans la bibliothèque et peut **inventer un exercice avec sa figure** | `ai.ts` |

## La bibliothèque

25 exercices (`library.ts`), chacun avec : sa fiche (consignes, erreurs, échelle de progression, guide pas à pas), le matériel qu'il demande (`kettlebell`, `halteres`, `bande`, `miniBande`, `chaise`, `canape`, ou rien), sa famille de mouvement (squat, fente, charnière, fessiers, tirage, poussée, épaules, bras, gainage, cardio), son niveau, et sa figure animée.

## Les figures animées

Un bonhomme de profil (`skeleton.ts`) : des segments de longueur fixe (buste, cuisses, tibias, bras…). Une **pose** = des angles par segment, une articulation d'ancrage posée à un point (la cheville d'appui, la hanche au sol…) et, au besoin, des extrémités fixées (mains au sol, pieds à plat) dont le coude ou le genou est calculé par cinématique inverse. Une **figure** (`motion.ts`) = 2 à 4 poses clés et le tempo d'une répétition (« Descends » 3 s, « Tiens » 1 s, « Remonte » 1 s). On interpole les angles, jamais les points : les membres gardent leur longueur et les pieds restent posés. La même horloge pilote la figure, le libellé, le décompte, les bips et le compteur de répétitions.

Le dessin (`draw.ts`, pur) rend des tracés et leur « peinture » : membres galbés, côté éloigné en retrait, ombre au sol, tapis pour les exercices au sol, et le matériel. Matériel tenu : la kettlebell des poses (`bell`), ou `gear` sur la figure (`dumbbell` pour des haltères dans une ou deux mains, `band` tendu d'un appui aux mains, `miniband` aux genoux). Matériel posé : `props` (`bench`, `chair`, `sofa`, `counter`, dossier à gauche ou à droite).

Une figure inventée par l'IA passe par `motion-check.ts` avant d'être gardée :
- 2 à 6 poses, 2 à 10 étapes de tempo, une répétition de 1 à 15 s, un mouvement qui quitte la pose de départ ;
- toutes les poses gardent le même ancrage ;
- chaque pose résolue : rien sous le sol, dans le cadre, au moins un appui au sol, chaque main ou pied fixé atteint vraiment sa cible.

Une figure refusée repart une fois à l'IA avec la liste des erreurs ; si elle reste fausse, l'exercice est remplacé par un exercice de la bibliothèque de la même famille, et on le dit. Toutes les figures de la bibliothèque passent ce même contrôle (`tests/training.test.ts`).

## Ajouter un exercice à la bibliothèque

1. Sa fiche dans `EXERCISES` (`program.ts`) ou `RENFO_EXERCISES` (`renfo.ts`).
2. Sa figure dans `MOTIONS` (`figures.ts`), même clé.
3. Son matériel, sa famille et son niveau dans `META` (`library.ts`), ses muscles dans `EXERCISE_MUSCLES` (`muscles.ts`).
4. `pnpm test` : la figure est vérifiée comme celles de l'IA.

## La séance guidée

Plein écran, au tempo de la figure. L'ordinateur (ou une tablette) sert d'écran ; les téléphones de télécommandes (QR code). **À deux**, une colonne par personne, chacun son programme et son rythme. La séance vit sur le serveur (table `training_live`, SSE) : un écran qui se met en veille la retrouve où elle en est.

**Le guide du rythme** accompagne la figure : une courbe défile de droite à gauche, et une bille posée dessus monte et descend au tempo de chaque phase (en haut, la pose de départ ; en bas, la position la plus dure). On voit venir la prochaine descente, le prochain palier et la prochaine remontée, chaque début de phase est marqué avec son mot, et la bille grossit au moment du bip. Elle utilise la même horloge que la figure et les bips (`rhythm.ts`, testé) : sur téléphone comme sur grand écran, tout tombe au même instant.

**La mise en place.** Le rythme guidé démarre après un décompte (5 s par défaut, réglable de 0 à 30 s) : la figure attend en pose de départ, la courbe montre les répétitions qui arrivent, trois bips avant le départ. « Go » part tout de suite, « + 5 s » allonge. Quand on enchaîne deux exercices différents sans repos (un superset), le décompte prend le temps de changement d'exercice (10 s par défaut, de 0 à 90 s).

**La pause.** « Pause » (touche P) fige l'étape : rythme, repos ou finisher. La reprise décale leurs horloges du temps passé en pause ; tous les écrans le voient.

**Le mode automatique.** Activable par personne (bouton Auto, touche A) : chaque série démarre seule après la mise en place et se note à la fin, le repos défile, la suivante démarre. Les réglages du rythme (automatique, mise en place, changement d'exercice) sont gardés avec la personne (`people.training_guide`) et copiés dans chaque séance (`Live.opts`) ; à deux, chacun les siens. Logique pure : `live.ts` (`leadFor`, actions `pause`, `resume`, `lead+`, `opts`).

**La carte des muscles.** Sur grand écran, à côté ou sous la figure : le corps de face et de dos, la cible en plein, ce qui aide en demi-teinte, ce qui stabilise en léger ; la cible s'allume au tempo (le même effort que la bille du rythme). Les exercices de la bibliothèque ont leur liste (`muscles.ts`, `EXERCISE_MUSCLES`) ; un exercice inventé la tire de son texte « muscles ». Une recette de nouvel exercice ajoute donc aussi sa ligne dans `EXERCISE_MUSCLES`.

Le carnet garde les répétitions de chaque série ; quand le haut de la fourchette est atteint sur toutes les séries, l'exercice est « prêt à monter » d'un cran (double progression).
