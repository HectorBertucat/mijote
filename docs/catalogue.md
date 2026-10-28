# Relier un catalogue de produits

Par défaut, Mijote n'est relié à aucun magasin. La liste de courses donne alors les quantités à acheter, rangées par rayon (le rayon est deviné au nom). On coche les lignes en magasin, on peut saisir le prix payé ligne par ligne, et la validation remplit le placard et le coût de chaque recette. C'est suffisant pour un usage normal.

Un **catalogue** ajoute pour chaque ligne un vrai produit : son format, son prix, son stock, le nombre de paquets à prendre et des remplaçants. Mijote n'en contient pas, parce que chaque magasin est différent. Il parle à une petite API HTTP réglée par `CHRONOCATALOG_URL` (le nom vient du premier catalogue écrit pour Mijote, pour un drive). Ce document décrit cette API et la façon d'en écrire une.

## Essayer en deux minutes

Le dépôt contient un catalogue d'exemple qui fonctionne : [`examples/catalogue-csv`](../examples/catalogue-csv), un fichier CSV de produits servi par 150 lignes de TypeScript, sans dépendance.

```bash
npx tsx examples/catalogue-csv/server.ts                     # http://localhost:3020/api/v1
CHRONOCATALOG_URL=http://localhost:3020/api/v1 pnpm dev       # Mijote l'utilise
```

Fais une liste avec le Porc chasseur : chaque ligne a un produit, des paquets et un prix. `tests/catalogue.test.ts` fait la même chose automatiquement.

## L'API attendue

Toutes les routes sont relatives à `CHRONOCATALOG_URL` et répondent en JSON. Les types TypeScript complets sont dans [`src/lib/chronocatalog.ts`](../src/lib/chronocatalog.ts), seul fichier de Mijote qui parle au catalogue.

### `GET /resolve?q=<ligne>&limit=1` (obligatoire)

Une ligne de courses, quantité comprise (« 1,5 kg sauté de porc », « 3 échalotes », « 25 cl vin blanc sec »), donne un type de produit et ses produits, du meilleur au moins bon.

```json
{
  "query": "1,5 kg sauté de porc",
  "source": "csv",
  "matchedTypes": [
    {
      "id": "viande:p-saute-porc",
      "slug": "saute-porc",
      "name": "Sauté de porc",
      "broadCategory": "viande",
      "unit": "g",
      "products": [
        {
          "id": "p-saute-porc",
          "name": "Sauté de porc sans os",
          "slug": "p-saute-porc",
          "productUrl": "",
          "imageUrl": null,
          "brandName": "Boucherie du coin",
          "quantityLabel": "500 g",
          "weightG": 500,
          "isFrozen": false,
          "currentPrice": 5.95,
          "currentPricePerKg": 11.9,
          "promoPriceEur": null,
          "stockStatus": "IN_STOCK",
          "source": "manual",
          "isFavorite": false,
          "availability": { "status": "available", "stockStatus": "IN_STOCK", "label": null, "remainingStock": null, "maxQuantity": null, "isDeliverable": true, "lastCheckedAt": "2026-10-28T09:00:00Z", "ageHours": 0, "stale": false }
        }
      ]
    }
  ],
  "quantity": { "value": 1.5, "unit": "kg", "grams": 1500, "pieces": null, "basis": "ligne" },
  "purchase": { "productId": "p-saute-porc", "packCount": 3, "packs": 3, "orderedQuantity": { "value": 1500, "unit": "g", "grams": 1500 }, "orderedG": 1500, "neededG": 1500, "overbuyG": 0, "totalPrice": 17.85, "pricePerUnit": 5.95, "priceUnit": "piece", "basis": "paquets entiers" },
  "none": null
}
```

Ce qui compte vraiment :
- `matchedTypes[0].products` : les produits candidats. Mijote choisit le premier disponible, sauf si on a accepté ou refusé des produits pour cet ingrédient (onglet « Produits » d'une fiche).
- `broadCategory` donne le rayon : `viande` et `poisson` → Boucherie, `laitier` et `oeuf` → Crèmerie, `legume` et `fruit` → Fruits et légumes, `surgele` → Surgelés, `boisson` et `alcool` → Boissons, le reste → Épicerie.
- `weightG` sert à calculer le nombre de paquets et le reste au placard. `promoPriceEur` remplace `currentPrice` quand il est renseigné.
- `availability.status` : `out_of_stock` ou `unavailable` passent la ligne en rouge, avec un remplaçant proposé. `maxQuantity` et `remainingStock` sont facultatifs. `ageHours` donne la fraîcheur du prix (orange au-delà de 4 h).
- Rien trouvé : `matchedTypes: []` et `none: { "reason": "no_match", "why": "…" }`. Mijote réessaie alors avec des variantes du nom (sans « label rouge », sans « bio »…). Une autre raison que `no_match` (par exemple `"nothing_to_buy"` pour « eau ») range la ligne au placard.

### `GET /search?q=<texte>&limit=<n>` (obligatoire)

Recherche libre, pour « Changer » le produit d'une ligne et pour l'onglet « Produits » d'une fiche.

```json
{ "query": "tomate", "count": 2, "results": [ { "productId": "p-tomates", "name": "Pulpe de tomates concassées", "...": "mêmes champs qu'un produit" } ] }
```

### `POST /live` et `GET /live?ids=` (facultatifs)

Le bouton « Vérifier en direct » demande des prix et stocks frais pour 20 produits au plus : `{ "refresh": ["p-saute-porc", "…"], "waitSeconds": 0 }`. Un catalogue toujours à jour répond tout de suite avec `outcome: "fresh"` et les produits. Un catalogue qui doit aller chercher l'information répond `outcome: "queued"` avec un `requestId`, que Mijote suit ensuite avec `GET /live?ids=…`. L'exemple CSV montre la version la plus simple.

### `/account/*` (facultatif, avancé)

Envoyer la liste dans le vrai panier d'un drive et relire la commande passée, avec un jeton (`CHRONOCATALOG_ACCOUNT_TOKEN`). Sans jeton, ces boutons sont masqués. Les formats sont dans `src/lib/chronocatalog.ts` (`accountJob`, `CartAddResult`, `OrdersResult`). C'est rarement utile pour démarrer.

## Écrire son catalogue

Le plus difficile n'est pas l'API, ce sont les données. Quelques pistes, de la plus simple à la plus complète :

1. **Un fichier tenu à la main.** Les 50 à 100 produits qu'on achète vraiment, avec leur format et leur prix. On le met à jour quand un prix change sur le ticket. C'est l'exemple CSV : copie-le et remplis-le.
2. **Un export de son magasin.** Certaines enseignes permettent d'exporter l'historique de commandes ou une liste de favoris. On le convertit en CSV.
3. **Une base ouverte.** [Open Food Facts](https://world.openfoodfacts.org/data) donne les produits, les marques, les formats et les catégories, mais pas les prix. Le projet [Open Prices](https://prices.openfoodfacts.org/) collecte des prix relevés par des contributeurs.
4. **L'API d'une enseigne.** Quand elle existe et que ses conditions le permettent, c'est la seule façon d'avoir des stocks en direct.

Les sites marchands ne doivent pas être interrogés directement depuis Mijote. Les conditions d'utilisation l'interdisent souvent, les IP sont bloquées et le rythme est limité. Si un catalogue doit aller chercher des données en ligne, il le fait de son côté, à son rythme, et garde un cache. C'est pour ça que le catalogue est un service séparé.

## Vérifier son catalogue

Le test du contrat se lance contre n'importe quel catalogue. Il suffit de remplacer le serveur d'exemple dans `tests/catalogue.test.ts` par l'adresse du sien, puis :

```bash
pnpm test
```

Le test fait une vraie liste de courses : chaque ligne doit avoir un produit, les paquets et le prix doivent être cohérents, les rayons justes, et la validation doit remplir le placard.
