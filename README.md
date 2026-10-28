# Mijote

Mijote organise le batch cooking d'un foyer, du choix des recettes jusqu'au dernier minuteur.

Le dimanche, on cuisine trois ou quatre plats en même temps pour toute la semaine. Mijote dit quoi couper en premier, quel plat va sur quel feu et à quelle puissance, quand le four doit être chaud, et quel bol prendre à quel moment. L'ordinateur, la tablette et le téléphone posé près des plaques affichent la même session. Les minuteurs sonnent sur tous les écrans.

Le reste de la semaine, chacun mange sa part juste. La part de chaque recette est calculée au gramme pour chaque personne, d'après sa cible, que l'appli ajuste avec ses pesées. La liste de courses est rangée par rayon, et chaque recette a son coût réel par part.

Je l'ai d'abord écrite pour mon foyer, et je m'en sers chaque semaine. Cette version est la même appli, ouverte : le foyer, la cuisine et le magasin se règlent au premier lancement.

## Ce qu'il y a dedans

**Recettes.** Des fiches standardisées : bols de préparation lettrés (A, B, C…), étapes avec le récipient, le feu, la puissance et le signe qui dit que c'est prêt (« croûte brun doré, grésillement franc »), sous-étapes chronométrées. Chaque ingrédient et chaque geste a son petit dessin animé. Six recettes de démonstration sont fournies.

**Semaine.** Une grille midi et soir : on coche qui mange à la maison, au bureau ou ailleurs. Mijote propose deux à quatre recettes qui couvrent la semaine. Il tient compte de ce que chacun n'aime pas, du nombre de jours au frigo (le reste part au congélateur) et des paquets entamés.

**Session de cuisine.** Un planificateur répartit les étapes de plusieurs recettes sur ta plaque, ton four et tes récipients, en évitant les conflits : une seule cocotte, un four à une seule température, une poêle qui ne prend que 500 g de viande à la fois. Il sait cuisiner seul, à deux, ou préparer la veille. Les durées réelles de chaque session corrigent les suivantes.

**Nutrition et parts.** Les kcal et protéines par part sont calculés en code, à partir de la table Ciqual, en comptant ce qui ne se mange pas (os, gras resté dans la poêle). La cible de chacun part d'une formule, puis devient une dépense mesurée dès qu'il y a assez de pesées.

**Courses et coûts.** La liste est rangée par rayon et se coche en magasin. À la validation, les achats deviennent des lots du placard, et le coût de chaque recette en découle : ce qui est mangé, ce qui est payé en paquets entiers, ce qui est jeté.

**Santé et sport.** Poids et tendance, journal des repas en un tap, import d'Apple Santé. Des programmes de renforcement à la maison, guidés par un bonhomme animé qui montre le geste au bon tempo, avec décompte et bips. Ils se jouent sur un écran partagé, à deux si besoin. On peut partir d'un modèle, d'un générateur (matériel, temps, niveau, objectif) ou d'un programme écrit par l'IA.

## L'IA propose, le code vérifie

Mijote n'est pas un chat. L'IA (l'API Claude) intervient derrière des boutons : ajuster une recette (« −150 kcal », « sans brocoli pour Sam »), en créer une, fixer des objectifs avec un coach, écrire un programme de sport, dessiner un aliment qui n'a pas de dessin.

Ce qu'elle rend n'est jamais utilisé tel quel :
- les macros d'une recette sont recalculées depuis les grammes ;
- un objectif trop agressif est ramené dans des bornes sûres ;
- un dessin passe une liste blanche stricte avant d'être affiché ;
- quand l'IA invente un exercice, sa figure est posée sur un squelette, puis vérifiée : rien sous le sol, au moins un appui, des mains qui atteignent vraiment le sol. Une figure fausse est renvoyée une fois avec ses erreurs, puis remplacée par un exercice connu.

Sans clé d'API, tout le reste fonctionne. Avec une clé, compter quelques dollars par mois ; un plafond mensuel coupe l'IA au-delà ([docs/ia.md](docs/ia.md)).

## Installer

Avec Docker :

```bash
git clone https://github.com/HectorBertucat/mijote.git
cd mijote
cp .env.example .env
docker compose up -d --build
```

Puis http://localhost:3010. La mise en route demande qui mange, avec quoi tu cuisines (type de plaque, nombre de feux, four, poêle, cocotte…) et où tu fais tes courses. Ça prend deux minutes, et tout se change ensuite dans Réglages.

Dans `.env`, tout est facultatif :

| Variable | Rôle |
|---|---|
| `MIJOTE_PASSWORD` | Mot de passe de l'appli. À mettre dès qu'elle est joignable depuis Internet. |
| `ANTHROPIC_API_KEY` | Active les fonctions IA. |
| `AI_MONTHLY_CAP_USD` | Plafond de dépense IA par mois (10 $ par défaut). |
| `CHRONOCATALOG_URL` | Un catalogue de produits, pour avoir des prix et des stocks ([docs/catalogue.md](docs/catalogue.md)). |

Toutes les données tiennent dans un fichier SQLite. Sauvegardes, HTTPS, Raspberry Pi, installation sans Docker : [docs/installation.md](docs/installation.md).

Pour développer (Node 22 et pnpm) :

```bash
pnpm install
cp .env.example .env.local     # MIJOTE_AI_MOCK=1 simule l'IA, sans clé ni coût
pnpm dev                       # http://localhost:3010
```

## Limites

Mieux vaut les connaître avant d'installer :

- **En français seulement.** L'interface, les recettes et les consignes sont en français.
- **Un foyer par instance.** Pas de comptes séparés : chacun choisit son profil sur son appareil, et tout le monde voit tout. Pour deux foyers, il faut deux instances.
- **Aucun magasin branché par défaut.** Sans catalogue, la liste de courses donne les quantités par rayon, sans prix (on peut saisir le prix payé). Un catalogue demande de fournir ses propres données : l'exemple fourni lit un CSV.
- **Une table nutritionnelle courte** : 44 aliments courants. Un ingrédient absent n'est pas compté, et la fiche affiche la part couverte.
- **Six recettes de démonstration, toutes au porc.** C'était la base de mon foyer. L'Atelier en crée d'autres, et le format de fiche est documenté.
- **Pas un outil médical.** Les cibles et le coach suivent des repères grand public (rythme de perte prudent, protéines, IMC). Ils ne remplacent pas un avis médical.
- **Apple Santé uniquement**, via un Raccourci iOS. Rien pour Android pour l'instant.
- **Une web app**, pas une application native. Elle s'installe sur l'écran d'accueil. Garder l'écran allumé pendant la cuisine et installer le Raccourci demandent HTTPS.
- **Le sport est du renforcement à la maison** : figures de profil en 2D, 25 exercices dans la bibliothèque, pas de cardio guidé.

## Documentation

- [Installation](docs/installation.md) : Docker, serveur, HTTPS, sauvegardes, mises à jour
- [Guide](docs/guide.md) : la semaine type, écran par écran
- [Architecture](docs/architecture.md) : les modules et ce qui est vérifié en code
- [Recettes](docs/recettes.md) : le format des fiches
- [Sport](docs/sport.md) : programmes, générateur, figures animées
- [IA](docs/ia.md) : fonctions, vérifications, coûts mesurés
- [Catalogue](docs/catalogue.md) : brancher un magasin
- [Modèle de données](docs/schema.md)

## Technique

Next.js 16, React 19, TypeScript, SQLite avec Drizzle, Tailwind CSS 4, SDK Anthropic. Un seul process et un fichier de base, aucun service externe obligatoire.

Tout ce qui doit être juste est écrit en modules purs et testés : quantités, macros, coûts, planning de session, proposition de la semaine, vérification de ce que rend l'IA. Les tests passent à chaque commit, en trois niveaux :

```bash
pnpm test          # 227 tests unitaires et de parcours, sans réseau
pnpm test:smoke    # l'appli construite, sur une base vide, toutes les pages (après pnpm build)
pnpm test:ai       # chaque fonction IA en vrai (clé nécessaire, ~0,40 $)
```

La CI construit aussi l'image Docker et vérifie qu'elle démarre.

## Contribuer

Les idées, issues et pull requests sont bienvenues : [CONTRIBUTING.md](CONTRIBUTING.md) et [la feuille de route](docs/roadmap.md).

## Licence

[MIT](LICENSE)

---

### In English

Mijote is a self-hosted web app for household batch cooking. It schedules several recipes at once on your actual hobs, oven and pots, and runs the cooking session across synced screens with shared timers. It computes each person's portion and macros in code, builds the shopping list by aisle, and tracks the real cost per portion. A home workout module plays animated stick-figure exercises at the right tempo. AI (Claude API) is optional, sits behind buttons, and everything it returns is checked by code before use. The interface is in French. Quick start: `cp .env.example .env && docker compose up -d --build`, then open http://localhost:3010.
