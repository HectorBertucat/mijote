// Catalogue de produits minimal pour Mijote, sans dépendance : un fichier CSV de produits (prix, formats)
// servi avec l'API attendue par Mijote (docs/catalogue.md). Point de départ pour brancher son magasin :
// remplacer la lecture du CSV par son propre catalogue (export du drive, base, API d'une enseigne…).
//   npx tsx examples/catalogue-csv/server.ts                  → http://localhost:3020/api/v1
//   CHRONOCATALOG_URL=http://localhost:3020/api/v1 pnpm dev   → Mijote utilise ce catalogue
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface CsvProduct {
  id: string;
  nom: string;
  marque: string;
  format: string;
  poidsG: number | null;
  prix: number | null;
  categorie: string;
  mots: string[];
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim();
const words = (s: string) => norm(s).split(/\s+/).filter((w) => w.length >= 3);
const singular = (w: string) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);

export function loadCsv(file: string): CsvProduct[] {
  const [, ...lines] = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  return lines.map((l) => {
    const [id, nom, marque, format, poids, prix, categorie, mots] = l.split(";");
    return { id, nom, marque, format, poidsG: poids ? Number(poids) : null, prix: prix ? Number(prix) : null, categorie, mots: words(`${nom} ${mots}`).map(singular) };
  });
}

/** Quantité en tête de ligne : « 500 g », « 1,5 kg », « 25 cl », « 3 » (pièces). */
export function parseQuantity(q: string): { value: number; unit: string; grams: number | null; pieces: number | null; rest: string } | null {
  const m = q.trim().match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|l|cl|ml)?\b\s*(?:de |d')?(.*)$/i);
  if (!m) return null;
  const value = Number(m[1].replace(",", "."));
  const unit = (m[2] ?? "").toLowerCase();
  const k = { kg: 1000, g: 1, l: 1000, cl: 10, ml: 1 }[unit as "g"];
  return { value, unit: unit || "piece", grams: k ? value * k : null, pieces: k ? null : value, rest: m[3] };
}

/** Score de correspondance : mots de la ligne retrouvés dans le produit. */
function score(p: CsvProduct, q: string[]): number {
  const hit = q.filter((w) => p.mots.includes(singular(w))).length;
  return q.length ? hit / q.length : 0;
}

const STAMP = new Date().toISOString();

/** Un produit du CSV au format ResolvedProduct de Mijote. */
export function toProduct(p: CsvProduct) {
  return {
    id: p.id,
    name: p.nom,
    slug: p.id,
    productUrl: "",
    imageUrl: null,
    brandName: p.marque || null,
    quantityLabel: p.format || null,
    weightG: p.poidsG,
    isFrozen: p.categorie === "surgele",
    currentPrice: p.prix,
    currentPricePerKg: p.prix != null && p.poidsG ? Math.round((p.prix / p.poidsG) * 100000) / 100 : null,
    promoPriceEur: null,
    stockStatus: "IN_STOCK",
    source: "manual",
    isFavorite: false,
    availability: { status: "available", stockStatus: "IN_STOCK", label: null, remainingStock: null, maxQuantity: null, isDeliverable: true, lastCheckedAt: STAMP, ageHours: 0, stale: false },
  };
}

export function resolve(products: CsvProduct[], q: string) {
  const qty = parseQuantity(q);
  const text = qty ? qty.rest : q;
  const terms = words(text);
  const ranked = products
    .map((p) => ({ p, s: score(p, terms) }))
    .filter((x) => x.s >= 0.5)
    .sort((a, b) => b.s - a.s || (a.p.prix ?? 99) - (b.p.prix ?? 99));
  if (!ranked.length) return { query: q, source: "csv", matchedTypes: [], quantity: qty ? { value: qty.value, unit: qty.unit, grams: qty.grams, pieces: qty.pieces, basis: "ligne" } : null, none: { reason: "no_match", why: "aucun produit du CSV ne correspond" } };
  const best = ranked[0].p;
  const neededG = qty?.grams ?? null;
  const packs = neededG && best.poidsG ? Math.max(1, Math.ceil(neededG / best.poidsG - 0.05)) : 1;
  return {
    query: q,
    source: "csv",
    matchedTypes: [{ id: best.categorie + ":" + best.id, slug: best.id, name: best.nom, broadCategory: best.categorie, unit: "g", products: ranked.slice(0, 5).map((x) => toProduct(x.p)) }],
    parsed: { item: text, prefix: null, alternatives: [], attributes: {} },
    quantity: qty ? { value: qty.value, unit: qty.unit, grams: qty.grams, pieces: qty.pieces, basis: "ligne" } : null,
    purchase: {
      productId: best.id,
      packCount: packs,
      packs,
      orderedQuantity: { value: packs * (best.poidsG ?? 1), unit: best.poidsG ? "g" : "piece", grams: best.poidsG ? packs * best.poidsG : null },
      orderedG: best.poidsG ? packs * best.poidsG : null,
      neededG,
      overbuyG: neededG && best.poidsG ? packs * best.poidsG - neededG : null,
      totalPrice: best.prix != null ? Math.round(best.prix * packs * 100) / 100 : null,
      pricePerUnit: best.prix,
      priceUnit: "piece",
      basis: "paquets entiers",
    },
    none: null,
    confidence: ranked[0].s,
  };
}

export function search(products: CsvProduct[], q: string, limit = 20) {
  const terms = words(q);
  const results = products
    .map((p) => ({ p, s: score(p, terms) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ p }) => ({ ...toProduct(p), productId: p.id, isAvailable: true }));
  return { query: q, count: results.length, results };
}

export function createServer(products: CsvProduct[]) {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const route = url.pathname.replace(/^\/api\/v1/, "");
    if (req.method === "GET" && route === "/resolve") return send(200, resolve(products, url.searchParams.get("q") ?? ""));
    if (req.method === "GET" && route === "/search") return send(200, search(products, url.searchParams.get("q") ?? "", Number(url.searchParams.get("limit") ?? 20)));
    // Vérification « en direct » : un CSV est toujours à jour, chaque produit est rendu tel quel.
    if (req.method === "POST" && route === "/live") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const ids: string[] = (JSON.parse(raw || "{}").refresh ?? []).slice(0, 20);
        const found = ids.map((id) => products.find((p) => p.id === id));
        send(200, { refresh: ids.map((id, i) => ({ ref: id, productId: found[i]?.id ?? null, outcome: found[i] ? "fresh" : "not_found", requestId: null, status: "done" })), products: found.filter(Boolean).map((p) => toProduct(p!)) });
      });
      return;
    }
    if (req.method === "GET" && route === "/live") return send(200, { requests: [] });
    send(404, { error: `route inconnue : ${req.method} ${url.pathname}` });
  });
}

// Lancé directement : sert produits.csv (ou le fichier passé en argument).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const file = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "produits.csv");
  const port = Number(process.env.PORT ?? 3020);
  const products = loadCsv(file);
  createServer(products).listen(port, () => console.log(`Catalogue CSV : ${products.length} produits sur http://localhost:${port}/api/v1`));
}
