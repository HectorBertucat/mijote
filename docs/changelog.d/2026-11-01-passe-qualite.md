## 2026-11-01 : passe qualité (hors Santé)
- Contraste AA : `ink-3` passe à `#696C75` (4,6:1 sur le papier), `ok` et `warn` assombris d'un cran ; en sombre, `ink-3` éclairci. Les onglets inactifs, légendes et statuts se lisent.
- Pages 404 et d'erreur en français, dans la coque de l'appli (au lieu de la page anglaise de Next sur fond blanc).
- Connexion et mise en route : plus d'onglets ni de recherche (ils y ramenaient), seulement le thème.
- Courses sans catalogue : noms d'articles sans la préparation (« Oignons », pas « Oignons, émincés »), rayon deviné sur ce nom (le gingembre râpé n'est plus en Crèmerie), plus de « 0,00 € » ni de bloc « 10 manques », ticket avec les poids et cachet « Acheté », « Courses validées », « Copier la liste », pas de lien vers un placard et des coûts vides.
- Dates : « 1er novembre » partout (`firstOfMonth`, `src/lib/typo.ts`) ; élision « d'Alex » dans les libellés et messages ; « la semoule cuite », « les pâtes cuites » à la pesée (`sideWords`).
- Téléphone : la vue détaillée de session ne déborde plus, l'en-tête de session passe à la ligne, les chiffres de tête d'une fiche et les sections repliées de la Semaine s'alignent, les listes de courses sur deux lignes, le bandeau de démo garde ses deux boutons ensemble.
- Cibles tactiles de 44 px : boutons `sm`, puces, segments, profils, pastille « écran allumé », mot-symbole (zone invisible, même dessin).
- Session : noms courts qui distinguent (« Orzo », « Poulet basquaise » au lieu de « One », « Poulet ») ; pas de « 0 bol à remplir » quand les bols se font pendant la cuisson.
- Mise en route et Réglages : plus de mention de l'IA sans clé ; le tag « poele » devient « poêle ».
