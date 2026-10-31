// Client typé de l'API de catalogue (contrat : docs/catalogue.md ; exemple : examples/catalogue-csv).
// On ne type que les champs documentés : un champ absent du contrat s'ajoute côté
// catalogue, jamais en le devinant ici. Mijote n'interroge jamais un site marchand directement.
import { demoEnabled } from "@/lib/demo/core";

export type StockStatus = "HIGH_STOCK" | "IN_STOCK" | "LOW_STOCK" | "NO_STOCK" | "BIENTOT" | null;

export interface Availability {
  status: "available" | "low_stock" | "out_of_stock" | "unavailable" | "unknown";
  stockStatus: StockStatus;
  label: string | null;
  remainingStock: number | null;
  maxQuantity: number | null;
  isDeliverable: boolean | null;
  lastCheckedAt: string | null;
  ageHours: number | null;
  stale: boolean;
}

export interface ResolvedProduct {
  id: string;
  name: string;
  slug: string;
  productUrl: string;
  imageUrl: string | null;
  brandName: string | null;
  quantityLabel: string | null;
  weightG: number | null;
  isFrozen: boolean;
  currentPrice: number | null; // prix de référence (barré si promo)
  currentPricePerKg: number | null;
  promoPriceEur: number | null; // prix effectif quand non nul
  promoDiscountRate?: number | null;
  promoValidUntil?: string | null;
  stockStatus: StockStatus;
  source: "chronodrive" | "manual";
  isFavorite: boolean;
  availability?: Availability;
}

export interface MatchedType {
  id: string;
  slug: string;
  name: string;
  broadCategory: string;
  unit: string;
  products: ResolvedProduct[];
}

export interface LineQuantity {
  value: number;
  unit: string;
  grams: number | null;
  pieces: number | null;
  basis: string;
}

export interface Purchase {
  productId: string;
  packCount: number;
  packs: number;
  orderedQuantity: { value: number; unit: "g" | "ml" | "piece"; grams: number | null };
  orderedG: number | null;
  neededG: number | null;
  overbuyG: number | null;
  totalPrice: number | null;
  pricePerUnit: number | null;
  priceUnit: "kg" | "L" | "piece" | null;
  basis: string;
}

export interface ResolveResponse {
  query: string;
  source: string;
  totalProducts?: number;
  matchedTypes: MatchedType[];
  // Champs « ligne » (q avec quantité), documentés dans docs/catalogue.md
  parsed?: { item: string; prefix: string | null; alternatives: string[]; attributes: Record<string, unknown> };
  quantity?: LineQuantity | null;
  purchase?: Purchase | null;
  none?: { reason: string; why: string } | null;
  confidence?: number;
  dataVersion?: number;
}

export interface BasketIngredient {
  query: string;
  quantityG?: number;
  quantityL?: number;
  units?: number;
}

export interface BasketItem {
  query: string;
  canonicalType?: { slug: string; name: string; broadCategory: string };
  selected?: {
    product: ResolvedProduct;
    quantity: { amount: number; unit: string };
    estimatedUnitPrice: number;
    estimatedTotalPrice: number;
    warnings?: string[]; // not_available:*, over_max_quantity:N>M, over_remaining_stock:N>M, stale_price:Xh
  };
  alternatives?: ResolvedProduct[];
  notFound?: unknown;
}

export interface BasketResponse {
  items: BasketItem[];
  totalEur: number;
  budgetEur?: number;
  overBudget?: boolean;
  summary: string;
}

export interface SearchResult {
  id: string;
  slug: string;
  name: string;
  brandName: string | null;
  currentPrice: number | null;
  currentPricePerKg: number | null;
  stockStatus: StockStatus;
  isAvailable: boolean;
  isFavorite: boolean;
  source: "chronodrive" | "manual";
  availability?: Availability;
}

// Champs que /search peut renvoyer en plus (facultatifs). L'id arrive dans productId.
export interface SearchHit extends Partial<SearchResult> {
  productId?: string;
  name: string;
  imageUrl?: string | null;
  quantityLabel?: string | null;
  weightG?: number | null;
  isFrozen?: boolean;
  promoPriceEur?: number | null;
  typeSlug?: string | null;
}

export interface SearchResponse {
  query: string;
  count: number;
  results: SearchHit[];
}

export interface LiveRequest {
  refresh?: string[]; // id, slug ou P123 ; 20 au plus côté appli (40 en attente côté serveur)
  search?: string;
  force?: boolean;
  waitSeconds?: number; // 0 à 90
}

// refresh[] : un accusé par produit. requestId sert à suivre la demande avec GET /live?ids=….
export interface LiveRefreshAck {
  ref?: string;
  productId?: string | null;
  outcome?: "queued" | "already_queued" | "fresh" | "not_found" | "not_chronodrive" | "rejected" | string;
  requestId?: string | null;
  status?: "pending" | "done" | "failed" | "skipped" | string;
  error?: string | null;
}

export interface LiveRequestState {
  id: string;
  productId: string | null;
  status: "pending" | "done" | "failed" | "expired" | string;
  doneAt: string | null;
  error: string | null;
}

export interface LiveResponse {
  refresh?: LiveRefreshAck[];
  search?: { status?: string; resultCount?: number };
  products?: ResolvedProduct[];
}

export class ChronocatalogError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export const LIVE_REFRESH_MAX = 20;

export function effectivePrice(p: Pick<ResolvedProduct, "promoPriceEur" | "currentPrice">): number | null {
  return p.promoPriceEur ?? p.currentPrice;
}

/**
 * Catalogue relié ? Le catalogue (une instance de chronocatalog, API v1) est facultatif : sans lui,
 * la liste de courses donne les quantités à acheter, sans produits ni prix (les coûts se saisissent
 * à la validation de la liste).
 */
export const catalogEnabled = () => !!process.env.CHRONOCATALOG_URL?.trim() && !demoEnabled();

/** Réponse de /resolve quand aucun catalogue n'est relié : rien trouvé, sans erreur. */
const offlineResolve = (q: string): ResolveResponse => ({ query: q, source: "offline", matchedTypes: [], none: null });

function baseUrl(): string {
  // En démo, jamais d'appel au catalogue, même si l'adresse est réglée.
  const url = demoEnabled() ? "" : process.env.CHRONOCATALOG_URL;
  if (!url) throw new ChronocatalogError("CHRONOCATALOG_URL manquante (voir .env.example)");
  return url.replace(/\/$/, "");
}

async function call<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(init?.timeoutMs ?? 15_000),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ChronocatalogError(body?.error ?? `chronocatalog ${path} : HTTP ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

export function resolve(q: string, opts: { limit?: number; available?: boolean; skipLLM?: boolean } = {}): Promise<ResolveResponse> {
  if (!catalogEnabled()) return Promise.resolve(offlineResolve(q));
  const p = new URLSearchParams({ q });
  if (opts.limit) p.set("limit", String(opts.limit));
  if (opts.available) p.set("available", "true");
  if (opts.skipLLM) p.set("skipLLM", "true");
  return call<ResolveResponse>(`/resolve?${p}`);
}

export function basket(ingredients: BasketIngredient[], opts: { budgetEur?: number; availableOnly?: boolean } = {}) {
  return call<BasketResponse>("/basket", {
    method: "POST",
    body: JSON.stringify({ ingredients, ...opts }),
    timeoutMs: 30_000,
  });
}

export function search(q: string, opts: { limit?: number; available?: boolean; category?: string } = {}): Promise<SearchResponse> {
  if (!catalogEnabled()) return Promise.resolve({ query: q, count: 0, results: [] });
  const p = new URLSearchParams({ q });
  if (opts.limit) p.set("limit", String(opts.limit));
  if (opts.available) p.set("available", "true");
  if (opts.category) p.set("category", opts.category);
  return call<SearchResponse>(`/search?${p}`);
}

export function live(req: LiveRequest) {
  if (req.refresh && req.refresh.length > LIVE_REFRESH_MAX) {
    throw new ChronocatalogError(`/live : ${LIVE_REFRESH_MAX} produits au plus par demande`);
  }
  const wait = Math.min(Math.max(req.waitSeconds ?? 0, 0), 90);
  return call<LiveResponse>("/live", {
    method: "POST",
    body: JSON.stringify({ ...req, waitSeconds: wait }),
    timeoutMs: (wait + 15) * 1000,
  });
}

/** GET /live?ids=… : l'état des demandes live (pas de requête vers Chronodrive). */
export function liveRequests(ids: string[]) {
  const p = new URLSearchParams({ ids: ids.slice(0, 50).join(",") });
  return call<{ requests: LiveRequestState[] }>(`/live?${p}`);
}

// ─── Compte Chronodrive (panier, commandes ; facultatif) : /api/v1/account/* ───
// Tâches exécutées par le worker de chronocatalog (seul à détenir les identifiants), au rythme
// habituel ; jeton dédié CHRONOCATALOG_ACCOUNT_TOKEN. Voir docs/catalogue.md, « /account ».

export type AccountJobKind = "cart_add" | "cart_read" | "orders";

export interface AccountJob<R = unknown> {
  id: string;
  kind: AccountJobKind;
  status: "pending" | "done" | "failed";
  requestedAt: string;
  startedAt: string | null;
  doneAt: string | null;
  result: R | null;
  error: string | null;
}

export type CartLineOutcome = "added" | "already" | "partial" | "unavailable" | "failed";

export interface CartAddResult {
  cartId: string;
  totalCartAmount: number | null;
  lines: {
    chronoId: string;
    refs: string[];
    wanted: number;
    before: number;
    sent: number;
    after: number;
    outcome: CartLineOutcome;
    label: string | null;
    unitPrice: number | null;
    stock: string | null;
    remainingStock: number | null;
    maxCartQuantity: number | null;
    error?: string;
  }[];
  summary: Record<CartLineOutcome, number>;
  skipped?: { ref: string; reason: string }[];
}

export interface ChronoOrder {
  id: string;
  status: string;
  mode: string | null;
  createdAt: string | null;
  withdrawalDate: string | null;
  total: number | null;
  discount: number | null;
  items: { chronoId: string; quantity: number; totalAmount: number | null; unitPrice: number | null; label: string | null; brand: string | null; unitQuantityLabel: string | null }[];
}

export interface OrdersResult {
  recent: (Omit<ChronoOrder, "items" | "discount"> & { itemNumber: number | null })[];
  orders: ChronoOrder[];
}

export const accountEnabled = () => !!process.env.CHRONOCATALOG_ACCOUNT_TOKEN?.trim() && !demoEnabled();

const accountHeaders = () => {
  const token = process.env.CHRONOCATALOG_ACCOUNT_TOKEN?.trim();
  if (!token) throw new ChronocatalogError("Compte Chronodrive non relié : CHRONOCATALOG_ACCOUNT_TOKEN manquant (voir .env.example).");
  return { "x-account-token": token };
};

export function accountJob<R = unknown>(kind: AccountJobKind, payload: unknown = {}, waitSeconds = 0) {
  const wait = Math.min(Math.max(waitSeconds, 0), 30);
  return call<{ outcome: "queued" | "reused"; job: AccountJob<R> }>("/account/jobs", {
    method: "POST",
    headers: accountHeaders(),
    body: JSON.stringify({ kind, payload, waitSeconds: wait, requester: "cuisine" }),
    timeoutMs: (wait + 15) * 1000,
  });
}

export function accountJobs(ids: string[]) {
  const p = new URLSearchParams({ ids: ids.slice(0, 20).join(",") });
  return call<{ jobs: AccountJob[] }>(`/account/jobs?${p}`, { headers: accountHeaders() });
}
