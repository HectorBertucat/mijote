# Guide

Mijote suit une semaine de batch cooking : on choisit, on achète, on cuisine en une session, on mange juste toute la semaine.

## L'accueil

Le mot-symbole mène à l'accueil : la semaine en chiffres (plats, repas, temps de session et son jour), et le bouton bleu de ce qu'il y a à faire maintenant (choisir les plats, faire la liste, faire les courses, cuisiner, reprendre une session). À côté : tes repas du jour, les boîtes du frigo à manger en premier, l'état des courses ; en bas, la période jour par jour.

## 1. Mise en route (une fois)

À la première ouverture, `/bienvenue` demande :
- **Le foyer** : un prénom et une taille de part (petite, moyenne, grande) par personne. Le reste (sexe, âge, taille, poids, activité, objectif) est facultatif ici et se complète dans Santé.
- **La cuisine**, pas à pas, une question par écran (pensé pour le téléphone) :
  1. la plaque (induction, gaz, vitrocéramique, électrique) ;
  2. les foyers : un préréglage courant (3 foyers dont un grand de 28 cm, 4 foyers, 2 foyers, 5 foyers ; au gaz, 2 à 5 feux) ou le diamètre de chacun, avec « comment mesurer », et les niveaux de puissance ;
  3. le four : gradins, chaleur tournante ;
  4. les poêles : matière (inox, fonte, antiadhésive) et diamètre ; la plus grande en inox ou en fonte sert à saisir ;
  5. les casseroles (diamètre, contenance) et le faitout ;
  6. la cocotte en fonte (contenance, passe au four ou non) et les plats à four ;
  7. les appareils : air fryer (contenance du panier), mixeur plongeant, blender, petit hachoir, robot, et le reste ; si on cuisine parfois à deux (deuxième planche, deuxième grand couteau).

  Chaque étape a un choix par défaut et un bouton **Je ne sais pas** : la valeur courante sert et la rubrique est marquée « à vérifier » au récapitulatif. Le planificateur de session n'utilise que ce qui est décrit : un récipient va sur les foyers de sa taille, la cocotte finit au four si elle y passe, et l'air fryer cuit à côté du four.
- **La maison et les courses** : un nom (facultatif) et le magasin (« le drive Leclerc de Rennes ») : l'IA s'en sert pour proposer des produits qu'on trouve vraiment.

Tout se retrouve dans **Réglages** (icône curseurs, en haut).

En haut à droite, le **sélecteur de profil** dit qui utilise cet appareil : la part montrée sur les fiches, le journal de Santé et le sport sont les siens.

## 2. Le profil de chacun (Santé › Démarrer)

Pour une part juste, chacun donne sa taille, son poids, son objectif, et ce qu'il mange hors batch (petit-déjeuner, en-cas). Le plus juste : noter ses **habitudes** dans Santé › Hors batch (un shaker du lundi au vendredi, un petit-déjeuner le week-end…), composées d'aliments ; leurs calories et protéines sont calculées, et une carte dit s'il manque des protéines ou des calories une fois mangés les repas du batch (« un shaker le matin les couvre »), ou qu'aucun complément n'est utile. Sans rien noter, un petit-déjeuner moyen est compté. Mijote estime la dépense (formule), puis la **mesure** dès qu'il y a assez de pesées et de journées notées : la cible s'ajuste chaque lundi. La part de chaque recette en découle, au demi-« unité » près.

En cuisine, on ne compte pas en unités : en fin de session, on pèse la marmite et l'appli dit combien de grammes mettre dans la boîte de chacun.

## 3. Recettes

La bibliothèque est une liste : pour chaque plat, sa boîte dessinée, ses aliments, le temps actif, les calories de ta part (verdict de ta cible : dans la cible, sous, au-dessus) et deux repères au plus (jamais cuisinée, à relire, notes, se congèle…). On filtre par étiquette ou on cherche un plat, un ingrédient. Une fiche se lit comme une page de livre de cuisine. En tête, la boîte du plat, puis trois chiffres : temps actif, calories de ta part, prix de la part (ou le nombre de repas tant qu'il n'y a pas de prix). Puis :
- les **ingrédients**, regroupés par **bol de prep** (A, B, C…) : tout est épluché et coupé avant de cuire ; le placard est replié en bas ;
- les **étapes** avec récipient, foyer, niveau, durée et repère visuel ; les étapes de cuisson sont découpées en **sous-étapes chronométrées** ;
- la **nutrition** par part et ce qui pèse le plus ; le détail (ce qui ne se mange pas, la méthode) est sous « Comment c’est calculé » ;
- le **coût** par part, la calculette **En boîtes** et les variantes ;
- les **notes**, un tap pendant ou après la cuisson.

**Ajuster** (avec l'IA) propose une variante : −150 kcal, +15 g de protéines, plus de légumes, sans ce qu'une personne n'aime pas… La proposition est vérifiée en code (nutrition, équipement, catalogue) et s'affiche en « avant → après » ; on la garde comme variante ou on l'ignore.

**Atelier** (avec l'IA) crée une recette à partir d'une envie, en évitant les doublons de la bibliothèque.

Ajouter ses propres recettes en fichier : voir [recettes.md](recettes.md).

## 4. Semaine

On coche seulement ses plats (1 à 4, avec des filtres : one pot, rapide, four, se congèle, aimés, à essayer). Mijote calcule les quantités à cuire (jusqu'au double de la fiche) et répartit les repas de chacun : durée au frigo respectée, le reste au congélateur si la recette le supporte, goûts de chacun. « Compléter pour moi » ajoute ce qui manque sans toucher aux recettes choisies. Le résumé dit les repas couverts et le temps en cuisine, et n'avertit que si besoin (repas non couverts, part mal calée, récipient partagé). La barre en bas de l'écran dit où on en est (« 2 plats · 24 repas sur 28 ») et porte l'action suivante : **faire la liste de courses**, puis la voir, puis cuisiner une fois les courses commandées.

Par défaut, tout le monde mange à tous les repas ; les absences et le détail (menu, unités, nutrition) sont repliés en bas de la page.

**Changer la période** : une semaine va du lundi au dimanche, mais on peut choisir « du … au … », de 1 à 14 jours, avec des raccourcis (1 semaine, 10 jours, 2 semaines). La session de cuisine a lieu la veille du premier jour. Les recettes choisies et les absences restent ; les quantités se recalent (au-delà de la durée au frigo, le congélateur prend le relais). Les flèches passent à la période d'avant ou d'après, de même longueur.

Le **Composer** fait la même chose sans la semaine : choisis 2 à 4 recettes, vois la durée de session estimée et les associations qui vont bien ensemble.

## 5. Courses

La liste est rangée par rayon (boucherie, crèmerie, fruits et légumes, épicerie, surgelés, boissons), puis ce qu'il faut vérifier au placard. On coche en magasin. À la validation, les achats deviennent des **lots** du placard : leur prix sert au coût réel des recettes, et les restes peuvent servir ailleurs.

Avec un catalogue relié (avancé, [catalogue.md](catalogue.md)) : produit, prix, stock et remplaçants pour chaque ligne.

## 6. Session de cuisine

Lance-la depuis la liste validée ou le Composer. **Mode** : seul, à deux (chacun son fil), prep la veille, ou reprise à deux.

Par défaut, la session se suit sur le téléphone, en trois temps plein écran, une barre de progression en haut et un gros bouton en bas (la barre espace au clavier) :
1. **Prépare** : tout sur le plan de travail, bol par bol, avec les dessins des aliments et les quantités ; on touche un bol quand il est prêt.
2. **Cuisine** : une consigne à la fois, en grand, avec son dessin, le foyer et son niveau, le minuteur en pastille (+1 min) et « Suivant ». Les sous-étapes s'enchaînent seules. « Ça sonne bientôt » montre ce qui tourne en fond ; quand une attente sonne (l'eau bout), son étape revient au premier plan. La flèche « retour » défait le dernier pas.
3. **Range** : chaque recette en boîtes (une boîte par repas du foyer, durée au frigo, congélation), puis une confirmation de fin et le frigo plein.

Un écran sobre annonce chaque temps. À deux, chacun ouvre son fil sur son téléphone ; sur grand écran, les deux fils sont côte à côte (touches A et B). Le menu (en haut à droite) ouvre la **vue détaillée** : le fil complet, tous les minuteurs, le schéma des foyers et du four, les QR codes pour les autres écrans.

Les durées réelles sont mesurées et corrigent les estimations des sessions suivantes.

**En boîtes** : à la fin, pèse chaque marmite cuite (récipient plein moins récipient vide), et le riz ou la semoule à part s'ils ont cuit séparément. L'appli dit combien de boîtes pour chacun et combien de grammes dans chacune (plat et riz réglés pour viser les calories et les protéines de chacun). « Ranger les boîtes » les met dans le **Frigo** : au frigo pour les repas des prochains jours, au congélo pour la fin de semaine et la marge. La fiche recette a la même calculette.

## 6 bis. Frigo

L'onglet **Frigo** liste les boîtes du frigo et du congélo, la plus pressée d'abord, avec sa date limite (jours au frigo de la recette, trois mois au congélo, le lendemain une fois sortie). Une faim : on pioche ici avant de commander. **Je la mange** note la boîte au journal de Santé de la personne de l'appareil (macros de la boîte) ; **Au congélo**, **Sortir au frigo** et **Jetée** d'un tap.

## 6 ter. Assistant

Le bouton en forme de bulle, en haut (⌘I au clavier, ou « Demander » dans ⌘K), ouvre l'assistant. On lui parle avec ses mots : « dois-je prendre un shaker ? », « quelle recette cette semaine pour plus de protéines ? », « quelle boîte manger ce soir ? ». Il lit les objectifs de chacun, la semaine, le frigo et les recettes, et sait quelle page est ouverte. Quand il propose d'agir (ajouter une recette, un shaker, marquer une boîte mangée, lancer les courses), une carte montre ce qui change, chiffré par l'appli : **Appliquer** ou **Annuler**. Une proposition que l'appli refuse est montrée avec sa raison. **Repartir de zéro** efface la conversation. Sans clé d'API, le bouton n'apparaît pas.

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
