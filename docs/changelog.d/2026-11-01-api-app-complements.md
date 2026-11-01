## 2026-11-01 : API de l'app, compléments demandés par l'app
- L'import annonce `app_v1` dans `features` quand l'API de l'app existe.
- Toutes les réponses : `generatedAt`, plus de `null` dans les objets (clé absente), `actionId` sur tout `POST` (un renvoi ne refait pas l'action).
- `GET sante` : `series`, les courbes à plat (`{ unit, grain, mode, points: [{ date, value }] }`) pour les graphiques natifs.
- Figures : `GET sport/figures/<id>`, `version` (cache), `loop`, `cues` (débuts de phase), `accessories` (le matériel à plat), rôle des muscles ; `figureIds` par séance et dans la séance en cours.
- Séance : `state` (phase, fin de phase à l'heure du serveur, révision, automatique), gestes nommés (`POST sport/seance/<id>/action` : start, pause, resume, next, previous, log…) avec révision vérifiée (409), attente longue `?since=<révision>`.
- Course : `GET course/sorties?before=&limit=`, les sorties par pages avec l'uuid HealthKit de chaque séance.
