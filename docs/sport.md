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

Une figure inventée par l'IA passe par `motion-check.ts` avant d'être gardée :
- 2 à 6 poses, 2 à 10 étapes de tempo, une répétition de 1 à 15 s, un mouvement qui quitte la pose de départ ;
- toutes les poses gardent le même ancrage ;
- chaque pose résolue : rien sous le sol, dans le cadre, au moins un appui au sol, chaque main ou pied fixé atteint vraiment sa cible.

Une figure refusée repart une fois à l'IA avec la liste des erreurs ; si elle reste fausse, l'exercice est remplacé par un exercice de la bibliothèque de la même famille, et on le dit. Toutes les figures de la bibliothèque passent ce même contrôle (`tests/training.test.ts`).

## Ajouter un exercice à la bibliothèque

1. Sa fiche dans `EXERCISES` (`program.ts`) ou `RENFO_EXERCISES` (`renfo.ts`).
2. Sa figure dans `MOTIONS` (`figures.ts`), même clé.
3. Son matériel, sa famille et son niveau dans `META` (`library.ts`).
4. `pnpm test` : la figure est vérifiée comme celles de l'IA.

## La séance guidée

Plein écran, au tempo de la figure. L'ordinateur (ou une tablette) sert d'écran ; les téléphones de télécommandes (QR code). **À deux**, une colonne par personne, chacun son programme et son rythme. La séance vit sur le serveur (table `training_live`, SSE) : un écran qui se met en veille la retrouve où elle en est.

**Le guide du rythme** accompagne la figure : une courbe défile de droite à gauche, et une bille posée dessus monte et descend au tempo de chaque phase (en haut, la pose de départ ; en bas, la position la plus dure). On voit venir la prochaine descente, le prochain palier et la prochaine remontée, chaque début de phase est marqué avec son mot, et la bille grossit au moment du bip. Elle utilise la même horloge que la figure et les bips (`rhythm.ts`, testé) : sur téléphone comme sur grand écran, tout tombe au même instant.

Le carnet garde les répétitions de chaque série ; quand le haut de la fourchette est atteint sur toutes les séries, l'exercice est « prêt à monter » d'un cran (double progression).
