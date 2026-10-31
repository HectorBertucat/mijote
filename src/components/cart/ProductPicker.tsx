"use client";

// Recherche dans le catalogue (GET /search, produits disponibles) pour changer le produit d'une ligne.
import { useEffect, useRef, useState, useTransition } from "react";
import { pickProduct, searchProducts } from "@/app/courses/actions";
import type { CatalogChoice } from "@/lib/shopping/cart";
import { Button, Input } from "@/components/ui";
import { eur } from "./format";

export function ProductPicker({ itemId, initial, onDone, onClose }: { itemId: string; initial: string; onDone: (msg: string, ok: boolean) => void; onClose?: () => void }) {
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<CatalogChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [, start] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    const n = ++seq.current;
    const id = setTimeout(async () => {
      setSearching(true);
      const r = await searchProducts(query);
      if (n !== seq.current) return;
      setSearching(false);
      if (r.ok) {
        setResults(r.results);
        setError(null);
      } else setError(r.message);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Input icon="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher dans le catalogue…" aria-label="Chercher dans le catalogue" />
        </div>
        {onClose && (
          <Button variant="quiet" onClick={onClose}>
            Fermer
          </Button>
        )}
      </div>
      {searching && !results && (
        <div className="grid gap-2">
          <div className="skeleton h-12 !rounded-[8px]" />
          <div className="skeleton h-12 !rounded-[8px] opacity-70" />
        </div>
      )}
      {error && <p className="text-small text-ko-ink">{error}</p>}
      {results && results.length === 0 && <p className="text-small text-ink-2">Rien de disponible sous ce nom. Essaie un mot plus court.</p>}
      {results && results.length > 0 && (
        <ul className={`grid border-t border-line transition-opacity duration-[var(--dur-1)] ${searching ? "opacity-60" : ""}`}>
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={choosing != null}
                onClick={() => {
                  setChoosing(c.id);
                  start(async () => {
                    const r = await pickProduct(itemId, c.id, q);
                    setChoosing(null);
                    onDone(r.ok ? (r.message ?? "Produit changé.") : r.message, r.ok);
                  });
                }}
                className="-mx-3 flex w-[calc(100%+24px)] min-w-0 items-center gap-3 rounded-[8px] border-b border-line px-3 py-3 text-left hover:bg-surface-2 disabled:opacity-60"
              >
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.imageUrl} alt="" className="size-11 shrink-0 rounded-[8px] border border-line bg-surface object-contain" loading="lazy" />
                ) : (
                  <span className="size-11 shrink-0 rounded-[8px] bg-surface-2" />
                )}
                <span className="grid min-w-0 flex-1">
                  <span className="truncate font-semibold">{c.name}</span>
                  <span className="num truncate text-small text-ink-2">{[c.quantityLabel, c.brandName, c.pricePerKg != null ? `${eur(c.pricePerKg)}/kg` : null].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="grid shrink-0 justify-items-end gap-1 text-right">
                  {choosing === c.id ? <span className="k-spin text-accent" aria-label="Choix en cours" /> : <b className="num font-semibold">{eur(c.price)}</b>}
                  {c.promo && <span className="label text-ink-2">promo</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
