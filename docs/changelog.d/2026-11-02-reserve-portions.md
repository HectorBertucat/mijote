## 2026-11-02 : Nos plats, la réserve du batch

- Plus de jour fixe pour les plats : ce qui est fixe, c'est qui mange combien de portions de quel plat. La Semaine reste un prévisionnel (« Jour par jour (indicatif) » sur l'accueil).
- Une portion est faite de groupes servis à part (le plat et sa sauce, le riz, les haricots verts), déduits des étapes de la fiche (`src/lib/reserve/groups.ts`) ou déclarés par `serve` (couscous, poulet au paprika). La répartition plat + féculent des boîtes est généralisée à N groupes (`src/lib/reserve/core.ts`).
- Fin de session : un calculateur par marmite, une pesée par groupe, les portions de chacun (modifiables) et celles qui partent en boîtes au congélo ; « Ranger » met la marmite en réserve. La fiche recette a la même calculette (« En portions »).
- Nouvelle page **Nos plats** (`/plats`, l'onglet Frigo devient Plats, `/frigo` y renvoie) : pour chacun, chaque plat avec ses portions restantes (« 2 sur 4 ») et les grammes de sa prochaine portion ; « J'ai mangé une portion » d'un geste, plusieurs fois par jour, annulable ; la réserve se recalcule sur ce qui reste. La fiche d'un plat donne en grand les grammes de chaque groupe, la part de l'autre, « J'ai pris autre chose », Réajuster (nouvelle pesée, portions de chacun), les boîtes et « C'est fini ».
- Accueil : « Que manger ? » avec ce qui reste au profil actif.
- Journal de Santé : une portion mangée y écrit ses kcal et protéines ; retirer la ligne annule la portion (et remet une boîte mangée au frigo).
- Les boîtes déjà rangées deviennent des portions d'une réserve, sans rien perdre ; « Je la mange » passe par la réserve.
- API de l'app iPhone : `GET plats`, `POST plats/manger`, `plats/annuler`, `plats/reglage` (`features` : `plats`), docs/api-app.md.
- Schéma : migration 0011 (`reserves`, `reserve_servings`, `meal_boxes.reserve_id` et `portion_json`, `recipes.serve_json`).
- Démo : un batch en cours, des portions déjà mangées (le midi du jour compris), des boîtes au congélo.
