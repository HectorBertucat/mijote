## 2026-11-02 : le bilan du batch, la pesée plus tard

- Une session finie sans pesée met quand même ses plats en réserve : chaque groupe (le plat, le riz, les légumes) est estimé d'après le cru de la session, les portions de chacun viennent de la Semaine, et tout est marqué « estimé » (≈) jusqu'à la pesée. Une session test, ou terminée sans rien cuire, ne crée rien ; une recette déjà en réserve ne l'est pas deux fois (`src/lib/reserve/batch.ts`).
- Nouvelle page **le bilan du batch** (`/plats/batch/<session>`, « Le batch du 1er novembre ») : chaque plat cuit, ses groupes, les portions de chacun, pesé ou estimé ; on y pèse plus tard, même après un repas (la pesée de ce qui reste, kcal gardées). On y arrive par la fin de session (« Le bilan du batch », « Peser plus tard »), l'accueil, la Semaine de la période et le bandeau en tête de Nos plats. Le bilan prévu / réel des durées devient « Prévu et réel ».
- Accueil : un seul bloc « Que manger ? », la réserve de chacun plat par plat (le profil de l'appareil d'abord, l'autre d'un geste), « J'ai mangé une portion » et Annuler, ce qui a été mangé aujourd'hui ; sans rien de cuit, les portions prévues. Il remplace « Aujourd'hui » et « Le frigo ».
- Accueil : « Ignorer » sur les repas sans plat, retenu pour la période ; l'avertissement revient si d'autres repas se retrouvent sans plat ; « Rétablir » sur l'accueil et dans la Semaine.
- Premiers pas : « Peser et ranger » mène au bilan du batch en attente de pesée, et n'est fait qu'une fois un plat pesé en entier (ou des boîtes rangées avant la réserve).
- API de l'app iPhone (additif) : `dishes[].estimated` et `sessionId`, `batch` dans `GET plats` (docs/api-app.md).
- Démo : le dernier plat de la semaine en cours n'est pas encore pesé (portions estimées).
- Schéma : migration 0012 (`week_plans.missing_ignored`).
