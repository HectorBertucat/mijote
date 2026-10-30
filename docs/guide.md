# Guide

Mijote suit une semaine de batch cooking : on choisit, on achète, on cuisine en une session, on mange juste toute la semaine.

## 1. Mise en route (une fois)

À la première ouverture, `/bienvenue` demande :
- **Le foyer** : un prénom et une taille de part (petite, moyenne, grande) par personne. Le reste (sexe, âge, taille, poids, activité, objectif) est facultatif ici et se complète dans Santé.
- **La cuisine** : type de plaque, nombre de foyers et de niveaux, four et ses niveaux, poêle, cocotte, faitout, casseroles, plats à four, et si on cuisine parfois à deux (deuxième planche, deuxième grand couteau). Le planificateur de session n'utilise que ce qui est coché.
- **La maison et les courses** : un nom (facultatif) et le magasin (« le drive Leclerc de Rennes ») : l'IA s'en sert pour proposer des produits qu'on trouve vraiment.

Tout se retrouve dans **Réglages** (icône curseurs, en haut).

En haut à droite, le **sélecteur de profil** dit qui utilise cet appareil : la part montrée sur les fiches, le journal de Santé et le sport sont les siens.

## 2. Le profil de chacun (Santé › Démarrer)

Pour une part juste, chacun donne sa taille, son poids, son objectif, et ce qu'il mange hors batch (petit-déjeuner, en-cas). Le plus juste : noter ses **habitudes** dans Santé › Hors batch (un shaker du lundi au vendredi, un petit-déjeuner le week-end…), composées d'aliments ; leurs calories et protéines sont calculées, et une carte dit s'il manque des protéines ou des calories une fois mangés les repas du batch (« un shaker le matin les couvre »), ou qu'aucun complément n'est utile. Sans rien noter, un petit-déjeuner moyen est compté. Mijote estime la dépense (formule), puis la **mesure** dès qu'il y a assez de pesées et de journées notées : la cible s'ajuste chaque lundi. La part de chaque recette en découle, au demi-« unité » près.

En cuisine, on ne compte pas en unités : en fin de session, on pèse la marmite et l'appli dit combien de grammes mettre dans la boîte de chacun.

## 3. Recettes

La bibliothèque montre pour chaque recette la part de chacun, colorée selon sa cible (vert : dans la cible). Une fiche donne :
- les **bols de prep** (A, B, C…) : tout est épluché et coupé avant de cuire ;
- les **étapes** avec récipient, foyer, niveau, durée et repère visuel ; les étapes de cuisson sont découpées en **sous-étapes chronométrées** ;
- la **nutrition** par part, ce qui pèse le plus, ce qui ne se mange pas (parures, gras resté dans la poêle) ;
- le **coût** par part ;
- les **notes**, un tap pendant ou après la cuisson.

**Ajuster** (avec l'IA) propose une variante : −150 kcal, +15 g de protéines, plus de légumes, sans ce qu'une personne n'aime pas… La proposition est vérifiée en code (nutrition, équipement, catalogue) et s'affiche en « avant → après » ; on la garde comme variante ou on l'ignore.

**Atelier** (avec l'IA) crée une recette à partir d'une envie, en évitant les doublons de la bibliothèque.

Ajouter ses propres recettes en fichier : voir [recettes.md](recettes.md).

## 4. Semaine

On choisit seulement ses recettes (1 à 4, avec des filtres : one pot, rapide, four, congèle, aimées, à essayer). Mijote calcule les quantités à cuire (jusqu'au double de la fiche) et répartit les repas de chacun : durée au frigo respectée, le reste au congélateur si la recette le supporte, goûts de chacun. « Compléter pour moi » ajoute ce qui manque sans toucher aux recettes choisies. Le résumé dit les repas couverts et le temps en cuisine, et n'avertit que si besoin (repas non couverts, part mal calée, récipient partagé). Puis **faire la liste de courses**.

Par défaut, tout le monde mange à tous les repas ; les absences et le détail (menu, unités, nutrition) sont repliés en bas de la page.

Le **Composer** fait la même chose sans la semaine : choisis 2 à 4 recettes, vois la durée de session estimée et les associations qui vont bien ensemble.

## 5. Courses

La liste est rangée par rayon (boucherie, crèmerie, fruits et légumes, épicerie, surgelés, boissons), puis ce qu'il faut vérifier au placard. On coche en magasin. À la validation, les achats deviennent des **lots** du placard : leur prix sert au coût réel des recettes, et les restes peuvent servir ailleurs.

Avec un catalogue relié (avancé, [catalogue.md](catalogue.md)) : produit, prix, stock et remplaçants pour chaque ligne.

## 6. Session de cuisine

Le centre de contrôle. Lance-la depuis la liste validée ou le Composer :
- **Mode** : seul, à deux (chacun sa colonne de gestes), prep la veille, ou reprise à deux.
- **Prep** : les gestes regroupés (« émince les 5 oignons »), répartis dans les bols ; un bol se coche une fois rempli.
- **Cuisson** : le fil des étapes, avec le foyer et le niveau, le four, les minuteurs (une alerte sur tous les écrans), le schéma des foyers occupés.
- **Plusieurs écrans** : ordinateur (vue complète, barre espace pour avancer), tablette (gros boutons), téléphone posé près du feu (écran sombre, toujours allumé). Un QR code ouvre la session sur un autre appareil.

Les durées réelles sont mesurées et corrigent les estimations des sessions suivantes.

**En boîtes** : à la fin, pèse chaque marmite cuite (récipient plein moins récipient vide), et le riz ou la semoule à part s'ils ont cuit séparément. L'appli dit combien de boîtes pour chacun et combien de grammes dans chacune (plat et riz réglés pour viser les calories et les protéines de chacun). « Ranger les boîtes » les met dans le **Frigo** : au frigo pour les repas des prochains jours, au congélo pour la fin de semaine et la marge. La fiche recette a la même calculette.

## 6 bis. Frigo

L'onglet **Frigo** liste les boîtes du frigo et du congélo, la plus pressée d'abord, avec sa date limite (jours au frigo de la recette, trois mois au congélo, le lendemain une fois sortie). Une faim : on pioche ici avant de commander. **Je la mange** note la boîte au journal de Santé de la personne de l'appareil (macros de la boîte) ; **Au congélo**, **Sortir au frigo** et **Jetée** d'un tap.

## 7. Santé

- **Vue d'ensemble** : poids et tendance lissée, rythme, cible de la semaine expliquée.
- **Aujourd'hui** : les repas prévus de la semaine et les habitudes du jour se cochent en un tap ; « Autre chose » pour un écart (estimé par l'IA si besoin).
- **Hors batch** : les habitudes (shaker, petit-déjeuner, en-cas) et leurs jours ; elles font la part de chaque recette.
- **Objectifs** : un coach (IA) aide à fixer poids visé, rythme, protéines et sport réaliste ; chaque proposition est vérifiée (rythme sûr, jamais sous le métabolisme de base, IMC sain) avant d'être appliquée.
- **Apple Santé** : un Raccourci iOS envoie pesées, pas et séances (page Santé › Apple Santé, pas à pas).

## 8. Sport

Santé › Entraînement :
- **Choisir un programme** : un modèle (renfo maison débutant, kettlebell), le **générateur** (matériel, séances par semaine, durée, niveau, objectif) ou un programme **sur mesure par l'IA**, qui tient compte des contraintes en clair (« genou fragile », « rien au sol ») et peut inventer un exercice avec sa figure animée. Voir [sport.md](sport.md).
- **Séance guidée** : échauffement, supersets, repos, la figure qui montre le geste au bon tempo avec le décompte et les bips. L'ordinateur sert d'écran, les téléphones de télécommandes ; **à deux**, une colonne par personne.
- **Carnet** : chaque séance, et « prêt à monter » quand le haut de la fourchette est atteint sur toutes les séries (double progression).
