## 2026-11-01 : API de l'app sous le préfixe de l'import, durée d'une répétition
- L'API de l'app répond aussi sous `/api/sante/import/app/v1/` (adresse conseillée) : derrière Cloudflare Access, la règle « Service Auth » de l'import la couvre, sans seconde règle. `/api/app/v1/` reste.
- `cycle` (durée d'une répétition au rythme guidé) dans chaque exercice de l'API ; sans figure, la planche, comme le site (`guideMotion`, partagé par le site et l'API).
