# Installation

Mijote est un seul process Node.js et une base SQLite. Il tourne partout où Docker tourne : un ordinateur, un NAS (Synology, Unraid…), un Raspberry Pi 4/5, un petit serveur (VPS à 4 €/mois).

## 1. Avec Docker (conseillé)

```bash
git clone https://github.com/HectorBertucat/mijote.git
cd mijote
cp .env.example .env
```

Ouvre `.env` et règle au moins :
- `MIJOTE_PASSWORD` si l'appli sera joignable depuis Internet ;
- `ANTHROPIC_API_KEY` si tu veux les fonctions IA (sinon, laisse vide).

Puis :

```bash
docker compose up -d --build
```

L'appli est sur http://localhost:3010 (ou `http://<ip-de-la-machine>:3010` depuis le téléphone, sur le même réseau). Au premier lancement, la base est créée, les 6 recettes de démonstration sont importées, et l'appli ouvre la **mise en route**.

Changer de port : `MIJOTE_PORT=8080` dans `.env`.

### Mettre à jour

```bash
git pull
docker compose up -d --build
```

Les migrations de la base s'appliquent au démarrage. Les recettes de démonstration mises à jour sont réimportées (tes notes sont gardées).

Construis depuis `main` : chaque commit de `main` a passé la CI (types, tests, build, image). Le build lui-même ne revérifie pas les types (`next.config.ts`) ; si tu construis une branche à toi, lance `pnpm typecheck` avant.

### Sauvegarder

Toutes les données sont dans le volume `mijote-data`, un seul fichier `mijote.db` (plus ses fichiers `-wal` et `-shm`). Pour une copie cohérente pendant que l'appli tourne :

```bash
docker compose exec mijote node -e "require('better-sqlite3')('/data/mijote.db').backup('/data/sauvegarde.db').then(() => console.log('ok'))"
docker compose cp mijote:/data/sauvegarde.db ./mijote-$(date +%F).db
```

Restaurer : arrêter l'appli, remplacer `/data/mijote.db` par la sauvegarde (et supprimer les `-wal`/`-shm`), relancer.

## 2. Sans Docker

Il faut Node.js 22+ et pnpm 10 (`corepack enable`).

```bash
pnpm install
cp .env.example .env.local
pnpm build
MIJOTE_DATA_DIR=/chemin/vers/donnees pnpm start
```

Pour un service qui redémarre seul (Linux, systemd) :

```ini
# /etc/systemd/system/mijote.service
[Unit]
Description=Mijote
After=network.target

[Service]
WorkingDirectory=/opt/mijote
EnvironmentFile=/opt/mijote/.env.local
Environment=MIJOTE_DATA_DIR=/var/lib/mijote
ExecStart=/usr/bin/env pnpm start
Restart=always
User=mijote

[Install]
WantedBy=multi-user.target
```

## 3. Accès depuis l'extérieur et HTTPS

Le Wake Lock (écran qui reste allumé en cuisine), l'installation sur l'écran d'accueil et le Raccourci Apple Santé demandent **HTTPS**. Trois façons simples :

1. **Tailscale** (le plus simple, rien d'ouvert sur Internet) : installe Tailscale sur le serveur et les téléphones, puis `tailscale serve --bg 3010` donne une adresse `https://<machine>.<tailnet>.ts.net`.
2. **Cloudflare Tunnel** : `cloudflared tunnel --url http://localhost:3010`, puis un nom de domaine ; ajoute Cloudflare Access pour la connexion (dans ce cas `MIJOTE_PASSWORD` peut rester vide).
3. **Caddy** en reverse proxy, certificat automatique :

```
cuisine.exemple.fr {
  reverse_proxy localhost:3010
}
```

Les flux temps réel (session de cuisine, séance de sport) sont en SSE : ils passent tels quels par ces trois solutions.

> **Sécurité.** Sans `MIJOTE_PASSWORD` et sans proxy qui protège l'accès, n'importe qui qui atteint l'adresse peut lire et modifier les données, et utiliser ta clé IA (dans la limite du plafond mensuel). Le chemin `/api/sante/import` est le seul ouvert sans mot de passe : il exige la clé secrète de la personne.

## 4. Premiers pas

Voir le [guide](guide.md). En bref :
1. **Mise en route** : qui mange, la cuisine, le magasin.
2. **Santé › Démarrer** pour chacun : taille, poids, objectif, ce qui est mangé hors batch, ce qu'on n'aime pas. La part de chaque recette en découle.
3. **Semaine** : coche qui mange où, garde la proposition, fais la liste de courses.
4. **Session** : le dimanche, lance la session depuis la liste ou le Composer, ouvre-la aussi sur le téléphone (QR).

## Dépannage

| Symptôme | Piste |
|---|---|
| « ANTHROPIC_API_KEY manquante » | Mets la clé dans `.env` (Docker) ou `.env.local` (dev), puis relance. |
| « Plafond IA atteint » | `AI_MONTHLY_CAP_USD` ; la page Coûts montre la dépense du mois. |
| La liste de courses n'a pas de prix | Normal sans catalogue relié : les quantités sont par rayon, les prix se saisissent à la validation. |
| `better-sqlite3` ne compile pas (sans Docker) | Installe les outils de compilation (`build-essential`, `python3`) puis `pnpm rebuild better-sqlite3`. |
| L'appli redemande la mise en route | La base n'est pas persistée : vérifie le volume `/data` ou `MIJOTE_DATA_DIR`. |
