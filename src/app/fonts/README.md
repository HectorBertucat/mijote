# Polices

Servies par l'appli avec `next/font/local` (`src/app/layout.tsx`), pour que le build et le déploiement
ne dépendent pas d'un réseau. Polices variables, sous-ensemble latin (celui de Google Fonts : latin de
base, Latin-1, œ, ponctuation typographique dont l'espace fine insécable, €).

| Fichier | Police | Axes | Licence |
|---|---|---|---|
| `archivo-latin.woff2` | Archivo | `wght` 100–900, `wdth` 62–125 | SIL OFL 1.1, `OFL-Archivo.txt` |
| `atkinson-hyperlegible-next-latin.woff2` | Atkinson Hyperlegible Next | `wght` 200–800 | SIL OFL 1.1, `OFL-AtkinsonHyperlegibleNext.txt` |

Récupérées depuis Google Fonts (`css2?family=Archivo:wdth,wght@62..125,100..900&family=Atkinson+Hyperlegible+Next:wght@200..800`, bloc `/* latin */`).
