# Catalogue CSV (exemple)

Un catalogue de produits minimal pour Mijote : un fichier `produits.csv` (nom, format, poids, prix, rayon, mots-clés) servi avec l'API attendue par Mijote. Aucune dépendance.

```bash
npx tsx examples/catalogue-csv/server.ts                      # http://localhost:3020/api/v1
CHRONOCATALOG_URL=http://localhost:3020/api/v1 pnpm dev        # Mijote l'utilise
```

La liste de courses propose alors un produit par ligne, le nombre de paquets à prendre, le prix, et des remplaçants. C'est le point de départ pour brancher son propre magasin : garder les routes, remplacer la lecture du CSV. Le contrat complet est dans [docs/catalogue.md](../../docs/catalogue.md), et `tests/catalogue.test.ts` fait une liste de courses contre ce serveur.
