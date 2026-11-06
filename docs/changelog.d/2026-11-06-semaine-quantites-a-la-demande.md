## 2026-11-06 : Semaine, les plats choisis se partagent toute la période
- Les quantités à cuire ne bornent plus la semaine : `autoSize` répartit d'abord les repas entre les plats choisis comme si chacun était illimité (`assign` « à la demande », parts égales au prorata de la fiche, frigo, congélateur et goûts respectés), puis chaque plat cuit ce que mangent ses repas. Une passe comble un repas resté vide, une autre retire l'excédent.
- Multiplicateur calculé au vingtième de la fiche (×1,35), jusqu'au triple (au lieu de pas de ×0,25 jusqu'au double, qui laissaient des repas vides).
- Un repas pris ensemble se partage quand une personne préfère un plat qu'un autre convive ne mange pas (goûts) : ce plat sert alors aussi aux repas communs, au lieu de ne jamais servir.
