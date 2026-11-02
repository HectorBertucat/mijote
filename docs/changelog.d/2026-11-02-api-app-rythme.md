## 2026-11-02 : API de l'app, le guide du rythme au complet
- Chaque figure (`GET sport/figures`, `GET sport/figures/<id>`) donne `keys`, le nombre de poses clés : l'app place la bille à la même hauteur que le site (`keyLevel`, `rhythm.ts`).
- Chaque exercice (`program.exercises[]`, `view.exercise`) donne `guideFigure`, la figure qui rythme sa série : la sienne, sinon la planche (`jPlank`) ; elle est servie par `GET sport/figures` et comptée dans `figureIds`. `guideFigureId` (`src/lib/training/figures.ts`) la choisit pour le site comme pour l'API.
