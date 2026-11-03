## 2026-11-03 : créer une recette d'après des recettes publiées

- Atelier › Créer : une envie, une recherche web bornée (3 recherches, 2 pages lues), des sources résumées et citées avec leur lien, puis deux propositions pour le foyer (une troisième à la demande), retouchables (« plus de sauce »), ajoutées « à essayer » avec leurs sources.
- Vérification en code avant d'afficher et avant d'enregistrer : aliments connus, récipients de la cuisine (rechanges et air fryer compris), four et plaque, durées, quantités, doublons ; garnitures à part reconnues par le code ; chiffres d'une part pour chacun calculés par l'appli. « Corriger » renvoie les défauts à l'IA.
- Coût borné et affiché avant chaque appel, refus clair près du plafond du mois, recherche gardée en cache 30 jours pour la même envie. Mesuré : 0,23 $ la création, 0,07 $ la retouche.
- `research()` dans `src/lib/ai/` : outils serveur web_search et web_fetch, rapport par outil strict, coût des recherches journalisé dans `ai_calls`.
- Nouvelle table `recipe_creations` (migration 0015). `pnpm test:ai creer`.
- Sans clé, pas d'entrée ; en démo, la page explique.
