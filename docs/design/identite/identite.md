# Identité de Mijote

Proposition du 30 octobre 2026, pour discussion. Le document ne change rien dans l'appli : il propose une direction et un ordre de travail.

## Positionnement

> **Mijote, c'est le dimanche en cuisine qui nourrit toute la semaine : on choisit ses plats, l'appli s'occupe des grammes, des feux et des boîtes.**

## Ce qu'on voit aujourd'hui

Captures de l'appli avec deux recettes et une session de démonstration :

- **Le texte passe avant le plat.** Une recette, c'est un monogramme (« Ch », « Co ») puis du texte. Rien ne fait saliver avant la fiche.
- **Tout est au même niveau.** Les listes, les puces, les étiquettes et les chiffres ont le même poids, et on ne voit pas l'action principale de l'écran.
- **Les atouts sont cachés.** Les dessins d'aliments, les rubans et les cachets sont réussis, mais petits et rares.

## Principes

1. **Simple d'abord.** Un écran sert une seule chose et a un seul gros bouton. Ce qui presse est en tomate, et une seule chose presse par écran (règle déjà dans les jetons).
2. **Détail sur demande.** Les chiffres viennent en trois grosses valeurs (temps, kcal de la personne, prix de la part). Le reste (macros, coût détaillé, variantes) attend derrière un onglet ou un « plus ». Le code calcule tout, mais l'écran n'a pas à tout montrer.
3. **Téléphone d'abord.** On conçoit à 390 px avec le pouce. Le bureau, c'est la même chose en colonnes, pas une autre appli. La session reste lisible à un mètre, dans le thème sombre de cuisine.
4. **Le plat se voit.** Une recette se reconnaît d'abord à sa boîte (§5), ensuite à son nom.
5. **Les fêtes sont rares.** Un plein écran de transition marque seulement trois moments : la semaine validée, les courses faites, la session finie.

## Trois pistes

Maquettes autonomes, chacune en téléphone puis en bureau, avec les écrans Accueil, Semaine, Fiche recette, Session, Frigo et l'écran de transition :
[piste A](piste-a-marche.html) · [piste B](piste-b-riso.html) · [piste C](piste-c-epicerie.html). Aperçus : [A](apercus/piste-a-marche.jpg), [B](apercus/piste-b-riso.jpg), [C](apercus/piste-c-epicerie.jpg).

Les trois pistes gardent les dessins de `art.ts` tels quels, les rubans en Caveat, les cachets, le thème sombre de la session et les couleurs réservées `ok/warn/ko`.

| | **A · Marché du dimanche** | **B · Affiche riso** | **C · Épicerie de quartier** |
|---|---|---|---|
| Idée | L'appli actuelle, plus généreuse : la nappe vichy sous les plats, la boîte en vedette | Une affiche en risographie : aplats francs, contours d'encre, ombres décalées | Une étiquette de bocal et un torchon rayé : serif chaleureux, papier crème |
| Palette (jetons) | Jetons actuels inchangés : `bg #f6f4f0`, `accent #2342c4`, `hot #e4572e`, `sec-*`, `recipe-1…8`. En plus : le motif vichy (`color-mix` de la couleur de la recette) | `bg #fbf5e9` papier, `ink #16181d`, `accent #2f55e4`, `hot #ff5b2e`, jaune `#ffc928`, rose `#ff5fa2`, recettes plus claires (encres) | `bg #f3ecdf`, `surface #fffaf0`, `ink #2a2018`, `accent #1f5c45` vert bouteille, `hot #d9472b`, moutarde `#d9a21b` |
| Titres | Archivo large 112 %, 800 (déjà chargée) | Bricolage Grotesque étroite 85 %, 800 | Fraunces « soft », 700 |
| Texte, chiffres | Atkinson Hyperlegible Next ; chiffres en Archivo étroite | Atkinson | Atkinson partout, y compris pour les chiffres |
| Formes | Cartes 26 px sans bord, ombres douces, boutons pilule | Bord d'encre de 2,5 px, ombre pleine décalée de 4 px, pilules | Cartes 14 px, double filet d'étiquette, boutons 14 px |
| Iconographie | Dessins `art.ts`, boîte de verre, cachets à l'encre | Les mêmes, sur aplats à trame de points | Les mêmes, sur torchon rayé |
| Ton | Complice et concret : « Qu'est-ce qu'on cuisine ? », « C'est fait » | Direct et joueur : « Tu cuisines quoi ? », « On y va », « Rangé. Bravo. » | Posé et artisan : « Le menu de la semaine », « Le garde-manger est plein. » |
| Marque | « mij**o**te » : le **o** est une cocotte bleue au couvercle tomate qui fume. L'icône d'appli : la cocotte sur le vichy | « mijote » imprimé deux fois, bleu sur rose, avec un léger décalage. L'icône : deux ronds superposés | « Mijote » en italique dans un ovale d'étiquette, sous-titre « batch cooking maison » |
| Risque | Rester trop sage si l'on n'agrandit pas vraiment les plats | Fatigue au quotidien ; les bords épais alourdissent les écrans denses (courses, nutrition) ; contraste à surveiller en sombre | S'éloigne du bleu et des couleurs vives ; le serif se lit moins bien de loin (exclu de la session) ; air de marque de confiture |

Polices toutes libres (SIL OFL) et déjà servies par `next/font/google` pour celles de la piste A : Archivo, Atkinson Hyperlegible Next, Caveat. Bricolage Grotesque et Fraunces sont libres aussi.

## Recommandation : la piste A, avec un emprunt à B

**A**, parce que :

- **Elle ne casse rien.** Les jetons existants restent, on ajoute surtout des usages. Aucun composant du kit ne change de sens, et les règles de `cuisine-tokens.css` (une seule chose chaude par écran, `ok/warn/ko` réservés) restent valables.
- **Elle a du cachet.** On ne change pas les couleurs. On change l'échelle : la boîte en grand, le vichy sous chaque plat, la marque à la cocotte.
- **Elle reste lisible** au doigt, au téléphone, à un mètre de la plaque (Atkinson, chiffres étroits, session sombre), et dans les deux thèmes, puisqu'elle s'appuie sur les jetons à variante sombre.
- **Elle se distingue du concurrent grand public.** Pas de photos de plats retouchées ni de catégories marketing (« Protéinées », « Gourmandes ») : nos catégories disent comment on cuisine (« Une cocotte », « Au four », « Express », « Se congèle », « Plein de légumes »), et nos chiffres sont calculés pour chaque personne. On lui prend ce qui marche : les grandes cartes, les gros boutons, la sélection par coche et le frigo où l'on coche ses repas.

**L'emprunt à B**, c'est l'énergie des écrans de transition : un aplat de couleur de rubrique en plein écran et un cachet qui se pose une fois. On le garde aux trois moments du principe 5.

### Ordre d'adoption (une PR par point)

1. **Marque** : wordmark à la cocotte et icône (`src/app/icon.svg`, `apple-icon.tsx`, manifeste).
2. **Composant `DishBox`** (§5), pur et testé. Il remplace le monogramme dans les listes et fait le haut de la fiche.
3. **Cartes de recette** : grandes cartes à boîte sur vichy, sélection par coche, barre d'action en bas (Semaine, Recettes).
4. **Fiche recette** : trois grosses valeurs, onglets Ingrédients / Étapes / Nutrition, le détail repliable.
5. **Accueil** : un vrai tableau de bord (la semaine, le frigo, les courses), au lieu de la redirection vers `/recettes`.
6. **Frigo** : une rubrique ou une vue de la Semaine, bâtie sur le journal des repas de Santé et le nombre de jours au frigo déjà calculé. À cadrer côté données avant de dessiner plus.
7. **Transitions** : semaine validée, courses faites, session finie.

Les jetons à ajouter seraient peu nombreux : un motif `--pattern-vichy` (calculé depuis la couleur de la recette), `--radius-3xl: 26px` pour les grandes cartes, `--text-hero`. Le reste existe déjà.

## Visuels de plats sans photos

Une photo de plat en boîte fait envie, mais Mijote n'en a pas, et l'appli n'appelle jamais de service extérieur sans qu'on l'ait réglé. Voici trois voies, de la plus sûre à la moins sûre.

### 1. La boîte composée en code (recommandé)

C'est ce que montrent les maquettes. Une boîte de verre vue de trois quarts, avec son couvercle bleu, contient le plat dessiné à partir de ses ingrédients et des dessins existants :

- **sauce** : une couleur `--i-*` tirée du liquide ou de la base (tomate, crème, curry, fromage gratiné) ;
- **garniture principale** : les 2 ou 3 ingrédients les plus lourds en grammes, avec leur dessin (`foodArt`) ;
- **accompagnement** : le féculent servi à part (riz, semoule) dans un second compartiment ;
- **touche finale** : l'herbe ou l'aromate du dressage.

C'est une fonction pure, `dishArt(recipe) → layers`, déterministe et testée comme `resolve.ts` : même recette, même boîte. Elle suit les variantes (« sans brocoli » enlève le brocoli). Elle ne coûte rien, marche sans clé d'API, dans les deux thèmes, et peut s'animer (vapeur à la sortie de session).

**Limites.** Ce n'est pas une photo. Deux plats en sauce tomate se ressemblent ; le nom écrit sur le ruban et la couleur de la recette les départagent. Un plat sans dessin propre retombe sur le générique de sa famille, d'où l'intérêt de `pnpm illus:coverage` et du bouton « Dessiner avec l'IA ». Les gratins et les plats mixés se rendent mal : il faudra quelques modèles, comme « gratiné » ou « velouté », à la place des morceaux posés.

### 2. La photo maison, après « J'ai cuisiné »

Une photo prise par le foyer, réduite et gardée sur l'instance, remplace la boîte sur la fiche. C'est honnête, puisque c'est le vrai plat, et c'est gratuit.

**Limites.** Il faut qu'on pense à la prendre, et la qualité varie. Cela ajoute du stockage et une sauvegarde à prévoir. La boîte reste le visuel par défaut.

### 3. Images générées, côté administrateur seulement (déconseillé pour l'instant)

Un bouton dans Réglages, réservé à l'administrateur, générerait une image par recette avec un style imposé : illustration plate, boîte de verre, fond vichy, jamais de photoréalisme. L'image serait relue avant d'être publiée, puis stockée sur l'instance.

**Limites.**

- L'API utilisée par Mijote ne produit pas d'images. Il faudrait un second fournisseur, une nouvelle clé et une exception à la règle « tout appel IA passe par `src/lib/ai/` » (ou l'y faire entrer, avec son journal et son plafond).
- Le style dérive d'une image à l'autre, malgré le prompt.
- L'image montre un plat idéalisé qui ne correspond pas aux grammes calculés.
- Coût par image, licences et conditions d'usage à vérifier selon le fournisseur.
- Rien de cela n'est vérifiable par le code, contrairement aux dessins SVG passés à la liste blanche.

Si on le fait un jour : désactivé par défaut, déclenché à la main, jamais côté utilisateur, et la boîte reste le repli.

**En résumé** : on fait la voie 1 maintenant (étape 2 de l'ordre d'adoption), la voie 2 plus tard si le foyer la demande, et la voie 3 seulement si les deux premières ne suffisent pas.

## Fichiers

- `identite.md` : ce document.
- `piste-a-marche.html`, `piste-b-riso.html`, `piste-c-epicerie.html` : maquettes autonomes (un fichier chacune). Les polices viennent de Google Fonts, avec des polices système en repli. Les dessins sont copiés de `src/lib/illus/art.ts`.
- `apercus/` : une image par piste, pour lire la PR sans ouvrir le HTML.
- Données fictives (foyer « Alex et Sam », chiffres inventés).
