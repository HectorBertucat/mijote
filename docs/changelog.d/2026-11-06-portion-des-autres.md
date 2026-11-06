## 2026-11-06 : Nos plats, prendre la portion d'un autre
- Plus de portion pour soi : « manger » sert la portion suivante d'un autre telle quelle (grand récipient d'abord, sinon sa boîte), sans recalcul ; une portion passe de son total au sien. Sans portion chez personne, la portion à sa mesure d'avant.
- Portions interverties : sur la fiche d'un plat, la part de l'autre a « C'est moi qui l'ai mangée ». « Annuler » rend la portion à son propriétaire.
- Migration `0014_portion-empruntee` : `reserve_servings.borrowed_from`.
- API de l'app : `people[].borrow` (la portion qu'on prendrait), `POST plats/manger` accepte `from` (personId), `eaten[].borrowedFrom`.
