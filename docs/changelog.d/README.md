# Fragments du journal

Une PR qui change le comportement, le schéma ou une commande ajoute ici **un fichier** au lieu d'écrire en tête de `docs/CHANGELOG.md` : deux PR ouvertes en même temps n'entrent plus en conflit.

- Nom : `AAAA-MM-JJ-sujet.md` (minuscules, chiffres, tirets), par exemple `2026-10-31-ci-plus-rapide.md`.
- Contenu : comme une entrée du journal, un titre `## AAAA-MM-JJ : titre` (la même date que le nom) puis des lignes `- …`.
- `pnpm changelog` vérifie les fragments (les tests le font aussi) et affiche le journal complet, le plus récent en tête.
- De temps en temps, sur `main` et dans un commit à part : `pnpm changelog --fold` les verse en tête de `docs/CHANGELOG.md` et les supprime.
