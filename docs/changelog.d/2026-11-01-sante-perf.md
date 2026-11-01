## 2026-11-01 : Santé, vue d'ensemble rapide sur tout l'historique
- « Tout » sur plusieurs années d'Apple Santé : environ dix fois plus rapide, et « 30 j » deux fois.
- Un seul formateur de dates et de nombres par réglage (`todayParis`, `fmt`, `fmtDay`, titres des paquets) : en créer un par appel coûtait ~30 µs, des dizaines de milliers de fois par page.
- Jours civils sans objet Date (`src/lib/days.ts`) pour `addDays`, les axes des graphiques et la date des nuits ; instants des phases de sommeil lus en millisecondes par SQLite.
- Sur plusieurs années (barres au mois), le poids et le cœur passent aussi au mois (moyenne glissante sur 3 mois) au lieu de centaines de semaines ; la tendance du poids n'est plus recalculée.
- Tableau des lecteurs d'écran : une suite de paquets sans mesure tient en une ligne (« février 2019 – avril 2021 »). Barres : leurs classes passent dans `charts.css`.
- Une requête de moins par vue (types reçus et premier jour lus ensemble, `kindsFirst`).
