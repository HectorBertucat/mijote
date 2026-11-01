# Système graphique « Carnet de marché » (v3, 31/10/2026)

Refonte complète, à partir de la piste A de [identite/identite.md](identite/identite.md). Ce document fait référence : tout écran, tout composant s'y conforme. Les jetons vivent dans `src/app/cuisine-tokens.css`, les composants dans `src/components/ui/`.

## 1. Audit de la v2 (sans complaisance)

Ce qui faisait « template » ou « généré » dans la version « Plan de travail » :

**Typographie**
- Trois familles (Archivo, Atkinson, Caveat). Le manuscrit Caveat sur rubans est le cliché « fait main » des interfaces générées.
- Pas de vraie hiérarchie : les titres de page plafonnent à 36 px et tout le reste vit entre 13 et 17 px (`text-[13px]`, `[14px]`, `[15px]`, `[17px]` partout). Les écrans se lisent comme un seul bloc gris.
- Petites capitales grises espacées en surtitre de chaque bloc (« CE QUI PÈSE LE PLUS ») : le réflexe de tableau de bord.
- Apostrophes droites et guillemets anglais par endroits.

**Couleur**
- Une pastille de couleur par rubrique dans le menu (six teintes) : menu arc-en-ciel de modèle d'appli.
- Le bleu d'accent partout : chaque bouton principal, chaque lien, chaque onglet, chaque puce sélectionnée. Plus rien ne ressort.
- Soupe de pastilles colorées sur les courses (vert « en stock », orange « vérifié il y a 8 h », vert « au panier ») : chaque ligne crie trois choses.

**Mise en page**
- Tout est une carte blanche arrondie avec trait et ombre, posée sur un fond lin, en grille de deux colonnes. Le même traitement pour une liste de courses, un graphique de poids et une fiche recette.
- Gabarit unique par page : titre, ligne de gris, rangée de puces, cartes. Rien ne varie de rythme.
- Monogrammes « Bu », « Ch », « Co » à la place des plats : l'avatar par défaut.
- L'en-tête porte six rubriques, une recherche, un sélecteur de profil, les réglages et trois boutons de thème.

**Espacements**
- Valeurs à l'œil (`p-3.5`, `gap-2.5`, `px-[18px]`, `mt-1.5`) : aucune échelle tenue.

**Composants**
- Puces partout (étiquettes de recette, « bol A », unités, verdicts) ; boutons à ombre ; cachet « NOUVEAU » décoratif.

**Animation**
- `a:active { scale(.97) }` sur tous les liens et boutons : l'interface entière rebondit. Pop à ressort sur des éléments qui apparaissent souvent.

**Textes**
- Longs paragraphes gris d'explication de calcul sous chaque bloc. Jargon interne à l'écran (« u », « unités », « hors batch »). La voix est bonne quand elle est courte (« Le frigo est plein »), bavarde ailleurs.

## 2. Références, et ce qu'on leur emprunte

| Référence | On emprunte | Pourquoi |
|---|---|---|
| Livres de cuisine éditoriaux, NYT Cooking | La colonne d'ingrédients en tableau : quantité alignée à droite en chiffres serrés, nom à gauche, filet fin entre les lignes. Les numéros d'étape en très grand. | C'est la forme la plus lisible d'une recette depuis cent ans ; elle remplace les puces et les cartes. |
| Linear | Des filets de 1 px plutôt que des boîtes, des gris hiérarchisés, des lignes de liste avec survol précis, le clavier partout. | Le calme d'une interface dense : la hiérarchie vient du texte, pas des contours. |
| Stripe Press, sites éditoriaux primés | Des titres démesurés et une mise en page asymétrique (colonnes 5/7, 4/8), des sections au rythme varié. | La typographie devient l'image ; on casse le gabarit « titre + cartes ». |
| Awwwards, sites culinaires 2026 (La table de Joakim, Mâm Cơm, Slurp) | Le plat en héros, des aplats de couleur pleine page par plat. | Une recette doit donner faim avant d'être lue ; chez nous, la boîte dessinée sur nappe vichy tient ce rôle. |
| Emil Kowalski, Rauno Freiberg | Ease-out, moins de 300 ms, pas d'animation sur les gestes fréquents ni au clavier, tiroirs à 460 ms sur courbe iOS, retour de pression seulement sur les boutons. | Le mouvement doit faire paraître l'appli plus rapide, pas plus vivante. |
| Étiqueteuses Dymo, ardoises de marché | Les étiquettes en capitales serrées, posées de travers sur la couleur de la recette (à la place du manuscrit). | Un geste de cuisine réel, typographique, qui nous appartient. |
| Tendance « fatigue des néo-grotesques » 2026 | Une grotesque à axe de chasse (Archivo) poussée aux extrêmes : très large pour les titres, très serrée pour les chiffres. | Du caractère sans serif à la mode ; une seule famille, deux voix. |

## 3. Direction artistique

> **Le carnet de marché du dimanche : de grandes lettres larges imprimées sur papier, la nappe vichy sous chaque plat, des filets fins plutôt que des cartes, et un seul bleu de cocotte pour ce qu’on fait maintenant.**

### Polices (deux, pas une de plus)

| Police | Rôle |
|---|---|
| **Archivo** (variable, chasse 62–125, graisse 100–900) | Titres en chasse 125, graisse 800, approche −0,04 em. Chiffres, étiquettes, onglets et repères en chasse 75 (serrée), graisse 600–700, chiffres tabulaires. Les étiquettes sont en capitales, approche +0,06 em. |
| **Atkinson Hyperlegible Next** | Tout ce qui se lit : texte courant, consignes d’étape, champs, boutons. Elle est faite pour se lire de loin et en mauvaise lumière, à côté du feu. |

### Échelle typographique

| Nom | Bureau | Téléphone | Interligne | Police |
|---|---|---|---|---|
| `display` | 88 px | 52 px | 0,92 | Archivo 125 / 800 |
| `h1` | 56 px | 38 px | 0,96 | Archivo 125 / 800 |
| `h2` | 32 px | 26 px | 1,05 | Archivo 115 / 750 |
| `h3` | 20 px | 19 px | 1,2 | Archivo 100 / 700 |
| `lead` | 21 px | 19 px | 1,4 | Atkinson 400 |
| `body` | 17 px | 17 px | 1,5 | Atkinson 400 |
| `small` | 14 px | 14 px | 1,45 | Atkinson 400 |
| `label` | 12 px | 12 px | 1,2 | Archivo 75 / 650, capitales, +0,06 em |
| `num-xl` | 72 px | 56 px | 0,9 | Archivo 75 / 750, tabulaires |

Rapport fort entre deux niveaux voisins (au moins ×1,5 entre `h1` et `h2`). Une page a un seul `h1`.

### Palette

| Jeton | Hex | Usage |
|---|---|---|
| `paper` (`--c-bg`) | `#F3F1EC` | Le fond de tout. Un papier légèrement gris, pas crème. |
| `sheet` (`--c-surface`) | `#FFFFFF` | Seulement ce qui se saisit ou flotte : champs, tiroirs, assiettes des boîtes, menus. |
| `hollow` (`--c-surface-2`) | `#E8E5DE` | Creux : piste des curseurs, survol de ligne, zones repliées. |
| `ink` | `#15161A` | Texte, boutons principaux (plein encre), filets forts. |
| `ink-2` | `#4A4E57` | Texte secondaire. |
| `ink-3` | `#696C75` | Repères, légendes ; jamais pour un texte à lire en entier. Assez sombre pour un contraste AA (4,5:1) sur le papier. |
| `rule` (`--c-line`) | `#DCD8CF` | Filets de 1 px entre lignes et sections. |
| `rule-strong` | `#BBB6AB` | Contours de champ, filet sous un titre de section. |
| `cocotte` (`--c-accent`) | `#2342C4` | Parcimonieux : la sélection, l’étape en cours, la progression, le focus, un lien dans un texte. Jamais pour décorer. |
| `tomate` (`--c-hot`) | `#E4572E` | Une seule chose presse par écran : le minuteur qui sonne, une rupture au panier. |
| `ok` / `warn` / `ko` | `#157A3C` / `#A65400` / `#C8322A` | Réservés aux verdicts (cible, fiabilité d’un produit), toujours avec une forme ou un mot. |
| `recipe-1…8` | inchangés | L’identité d’un plat : sa nappe vichy, son étiquette, ses bols. Jamais pour un état. |

Le menu n’a plus de couleur par rubrique. La couleur, c’est le plat.

Le thème sombre (session à côté du feu, ou réglage) garde les mêmes rôles : `paper #111317`, `ink #F2F0EB`, `cocotte #8EA0FF`.

### Espacements

Une seule échelle, en pixels : **4 · 8 · 12 · 16 · 24 · 32 · 48 · 72 · 112**. Classes Tailwind correspondantes : `1 · 2 · 3 · 4 · 6 · 8 · 12 · 18 · 28`. Aucune autre valeur.
- Entre deux sections d’une page : 72 (bureau), 48 (téléphone).
- Entre un titre de section et son contenu : 24.
- Dans une ligne de liste : 16 vertical, 0 horizontal (le filet va d’un bord à l’autre de la colonne).

### Rayons

`4` (étiquettes) · `8` (boutons, champs) · `14` (tiroirs, assiette d’une boîte, panneaux flottants). Rien d’autre. Les sections de page n’ont **pas** de bord arrondi : elles sont délimitées par des filets et de l’air.

### Ombres

Une seule : `--sh-float` (`0 1px 0 rgb(21 22 26 / .04), 0 16px 40px -16px rgb(21 22 26 / .28)`), réservée à ce qui flotte au-dessus de la page (tiroir, barre d’action collante, toast, menu). Pas d’ombre sur ce qui est posé.

### Grille

- Bureau : 12 colonnes, largeur max 1240 px, marges 40, gouttière 24. Mises en page asymétriques assumées : 5/7 (fiche recette : ingrédients / étapes), 4/8 (semaine : choix / bibliothèque), 7/5 (accueil).
- Téléphone : une colonne, marges 20. La barre d’onglets en bas.

### Ton

- Tutoiement, phrases courtes, des chiffres plutôt que des adjectifs : « 3 plats, 28 repas, 2 h 40 dimanche », pas « Votre semaine est prête ! ».
- On nomme ce qu’on fait : « Cuisiner dimanche », « Ranger 6 boîtes », « Je la mange ».
- Aucune formule creuse (« simplifiez », « optimisez », « découvrez »). Aucun point d’exclamation sauf à la fin d’une session.
- Micro-typographie : apostrophe ’, guillemets « » avec espaces fines insécables, espace insécable avant « : ; ? ! », « kcal », « g », « min » et « € » séparés du nombre par une espace insécable.
- Les explications de calcul quittent l’écran : elles passent derrière un « Comment c’est calculé » replié.

### Mouvement

| Jeton | Durée | Courbe | Pour |
|---|---|---|---|
| `--dur-1` | 120 ms | `--ease-out` | survol, pression, focus |
| `--dur-2` | 200 ms | `--ease-out` | apparition et disparition d’un élément d’interface |
| `--dur-3` | 280 ms | `--ease-out` | contenu d’une page qui arrive, changement d’onglet |
| `--dur-sheet` | 460 ms | `--ease-sheet` | tiroirs (courbe iOS) |

- `--ease-out: cubic-bezier(.23, 1, .32, 1)` ; `--ease-sheet: cubic-bezier(.32, .72, 0, 1)`. Jamais `linear`, jamais `ease-in` pour l’interface.
- Retour de pression (`scale .98`) seulement sur les boutons, pas sur les liens ni les lignes.
- Entrée des listes au premier affichage : glissement de 8 px et fondu, décalés de 30 ms, huit éléments au plus, jamais rejoué sur une action.
- Pas d’animation pour un geste fréquent (cocher un article) au-delà du retour d’état, ni pour une action au clavier.
- `prefers-reduced-motion` : plus de déplacement, seulement des fondus de 120 ms.
- Changement de page : l’ancienne s’efface (`--dur-1`), la nouvelle arrive en fondu (`--dur-2`) avec 6 px de glissement ; en-tête et barre d’onglets ne bougent pas (`PageTransition`, transitions de vue). Pendant le chargement, un squelette fidèle à la page (`PageSkeleton`), qui pulse lentement et s’efface sous le contenu.
- Onglets : l’état actif suit le tap, pas l’arrivée de la page ; le trait glisse d’un onglet à l’autre (`--dur-3`).

### Signatures

- **La nappe vichy** : le motif de la couleur du plat sous chaque boîte, et en bande plein cadre en haut de la fiche.
- **La boîte** (`DishBox`) : la boîte de verre dessinée à partir des ingrédients ; elle remplace le monogramme partout.
- **L’étiquette** : capitales Archivo serrées sur la couleur du plat, légèrement de travers (−1,5°), comme sortie d’une étiqueteuse.
- **Le cachet** : gardé pour trois moments seulement (semaine prête, courses faites, session finie).
- **Le mot-symbole** « mij**o**te », où le **o** est une cocotte bleue à couvercle tomate.

## 4. Règles anti-« générique »

- Pas de dégradé violet ou bleu, pas de fond sombre à néons, pas de crème avec terracotta.
- Pas d’emoji comme icône ; une icône seulement quand elle aide à reconnaître une action ou un état.
- Pas de héros centré avec titre, sous-titre, deux boutons et trois cartes identiques.
- Pas de verre dépoli, pas d’ombre floue sur ce qui est posé, pas de coins arrondis par défaut.
- L’accent cocotte n’apparaît que là où l’on agit maintenant.
- États survol, focus (anneau cocotte de 2 px, décalé de 2 px), actif et désactivé soignés sur tout ce qui se touche.
