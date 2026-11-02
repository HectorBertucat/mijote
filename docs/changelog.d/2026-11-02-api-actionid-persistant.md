## 2026-11-02 : API de l'app, des actionId gardés en base

- Les `actionId` des `POST` de l'API de l'app sont gardés en base (table `app_actions`, migration 0012), 30 jours, au lieu des 500 derniers en mémoire : un renvoi après un redémarrage ou un déploiement ne compte plus une deuxième portion. Lu, fait et gardé dans une même transaction : deux renvois simultanés n'en font qu'un.
- Un renvoi reconnu répond `replayed: true` avec le `message` et la `serving` du premier envoi, mais `plats`, `jour`, `live` et `weighIns` recalculés maintenant. Un renvoi de `plats/annuler` répond 200 au lieu de 404.
- Le même `actionId` sur une autre route répond 409 ; un geste refusé n'est pas gardé.
